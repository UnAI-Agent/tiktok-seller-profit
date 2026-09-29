"""v1 HTTP routes. Admin routes 404 unless ADMIN_API_ENABLED=1."""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

import insights_logic
import otel_setup
import trends_logic
from config_store import load_published
from remote_doc import validate_config, verify_signature
from tiers import ai_monthly_limit, effective_tier

SERVICE = "tiktok-seller-tool"
router = APIRouter()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReviewIn(StrictModel):
    text: str = Field(max_length=500)
    stars: int = Field(ge=1, le=5)


class InsightReq(StrictModel):
    productId: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    reviewCount: int = Field(ge=0, le=10_000_000)
    rating: float = Field(ge=0, le=5)
    weekToken: str = Field(min_length=64, max_length=64, pattern=r"^[a-f0-9]{64}$")
    reviews: list[ReviewIn] = Field(max_length=50)


class SnapshotIn(StrictModel):
    price: float = Field(ge=0, le=1_000_000)
    soldCountApprox: float = Field(ge=0, le=1_000_000_000)
    rating: float = Field(ge=0, le=5)
    reviewCount: int = Field(ge=0, le=10_000_000)
    categoryPath: Optional[str] = Field(default=None, max_length=120)


class TrendEventIn(StrictModel):
    event: str = Field(pattern=r"^(product_checked|product_added|product_removed)$")
    productId: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    weekToken: str = Field(min_length=64, max_length=64, pattern=r"^[a-f0-9]{64}$")
    day: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    snapshot: SnapshotIn


class TrendBatch(StrictModel):
    events: list[TrendEventIn] = Field(max_length=50)


class ErrorReport(StrictModel):
    extVersion: str = Field(max_length=20)
    surface: str = Field(max_length=40)
    errorCode: str = Field(max_length=40)
    messageHash: str = Field(max_length=64)
    selectorVersion: Optional[str] = Field(default=None, max_length=20)
    configVersion: Optional[int] = None
    browserMajor: Optional[int] = Field(default=None, ge=1, le=999)


class ParseReport(StrictModel):
    surface: str = Field(max_length=40)
    field: str = Field(max_length=40)
    selectorVersion: str = Field(max_length=20)


class TierOverrideReq(StrictModel):
    tier: str = Field(pattern=r"^(free|pro|diamond)$")
    expiresAt: str = Field(max_length=40)
    note: str = Field(min_length=1, max_length=500)


class ResetUsageReq(StrictModel):
    counter: str = Field(pattern=r"^ai$")
    note: str = Field(min_length=1, max_length=500)


class NoteReq(StrictModel):
    note: str = Field(min_length=1, max_length=500)


def _db():
    import db as db_mod

    return db_mod.get_db()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


def _bearer_user(request: Request) -> dict[str, Any]:
    import marginmark_app as mm

    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(401, "Invalid or expired token")
    uid = mm.verify_token(auth[7:])
    if uid is None:
        raise HTTPException(401, "Invalid or expired token")
    db = _db()
    row = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    sub = db.execute(
        """SELECT status, tier, tier_override, tier_override_expires_at, stripe_sub_id,
                  promo_expires_at, past_due_since
           FROM subscriptions WHERE user_id=? AND service=?""",
        (uid, SERVICE),
    ).fetchone()
    db.close()
    if not row:
        raise HTTPException(401, "User not found")
    tier = mm._effective_plan(sub)
    if tier not in ("pro", "diamond"):
        raise HTTPException(403, "Pro required")
    return {"id": row["id"], "tier": tier}


def _require_admin(request: Request) -> None:
    if os.getenv("ADMIN_API_ENABLED") != "1":
        raise HTTPException(404, "Not found")
    expected = os.getenv("ADMIN_API_TOKEN", "")
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    if len(expected.encode("utf-8")) < 32 or not token or not secrets.compare_digest(token, expected):
        raise HTTPException(401, "Invalid admin token")
    allow = {item.strip() for item in os.getenv("ADMIN_API_ALLOWLIST", "").split(",") if item.strip()}
    if _client_ip(request) not in allow:
        raise HTTPException(403, "Admin IP denied")


def _audit(db, action: str, target: str, before: Any, after: Any) -> None:
    db.execute(
        """INSERT INTO admin_audit (id, at, actor, action, target, before_json, after_json)
           VALUES (?,?,?,?,?,?,?)""",
        (
            uuid.uuid4().hex,
            _iso(_now()),
            "admin-api",
            action,
            target,
            json.dumps(before),
            json.dumps(after),
        ),
    )


def _model_text(reviews: list[ReviewIn]) -> str | None:
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return None
    import httpx

    response = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": insights_logic.MODEL,
            "max_tokens": 300,
            "messages": [
                {
                    "role": "user",
                    "content": insights_logic.untrusted_prompt([row.model_dump() for row in reviews]),
                }
            ],
        },
        timeout=20,
    )
    if response.status_code >= 400:
        return None
    payload = response.json()
    parts = payload.get("content") or []
    return parts[0].get("text") if parts else None


def _budget_cap() -> float:
    doc = load_published() or {}
    configured = (doc.get("thresholds") or {}).get("aiDailyBudgetUsd")
    if isinstance(configured, (int, float)):
        return float(configured)
    return float(os.getenv("AI_DAILY_BUDGET_USD", "5"))


def _spent_today(db) -> float:
    row = db.execute("SELECT usd FROM ai_spend WHERE day=?", (_now().date().isoformat(),)).fetchone()
    return float(row["usd"]) if row else 0.0


@router.post("/insights/review-summary")
async def review_summary(req: InsightReq, request: Request):
    body = await request.body()
    if len(body) > 64 * 1024:
        raise HTTPException(413, "Request body too large")
    user = _bearer_user(request)
    db = _db()
    month = _now().strftime("%Y-%m")
    usage = db.execute(
        "SELECT count FROM ai_usage WHERE user_id=? AND month=?",
        (user["id"], month),
    ).fetchone()
    used = int(usage["count"]) if usage else 0
    limit = ai_monthly_limit(user["tier"])
    if used >= limit:
        db.close()
        raise HTTPException(429, "Monthly insight limit reached")
    cached = db.execute(
        "SELECT * FROM product_insights WHERE product_id=?",
        (req.productId,),
    ).fetchone()
    age_days = 999.0
    if cached:
        try:
            refreshed = datetime.fromisoformat(str(cached["refreshed_at"]))
            if refreshed.tzinfo is None:
                refreshed = refreshed.replace(tzinfo=timezone.utc)
            age_days = (_now() - refreshed).total_seconds() / 86400
        except ValueError:
            age_days = 999.0
    if cached and not insights_logic.should_refresh(dict(cached), req.reviewCount, age_days):
        summary = json.loads(cached["summary_json"])
        db.close()
        return {"status": "ok", "summary": summary, "cached": True}
    if _spent_today(db) >= _budget_cap():
        if cached:
            summary = json.loads(cached["summary_json"])
            db.close()
            return {"status": "budget_exhausted", "summary": summary}
        db.close()
        return {"status": "budget_exhausted"}
    db.execute(
        """INSERT INTO insight_submissions (id, product_id, week_token, review_count, rating, created_at)
           VALUES (?,?,?,?,?,?)""",
        (uuid.uuid4().hex, req.productId, req.weekToken, req.reviewCount, req.rating, _iso(_now())),
    )
    subs = db.execute(
        "SELECT week_token, review_count, rating FROM insight_submissions WHERE product_id=?",
        (req.productId,),
    ).fetchall()
    db.commit()
    if insights_logic.agreeing_tokens([dict(row) for row in subs], req.reviewCount, req.rating) < 2:
        db.close()
        return {"status": "pending"}
    summary = insights_logic.parse_model_output(_model_text(req.reviews) or "")
    if summary is None:
        db.close()
        return {"status": "pending"}
    db.execute(
        """INSERT INTO product_insights
             (product_id, summary_json, review_count_at, rating_at, model, created_at, refreshed_at, source_submissions, provisional)
           VALUES (?,?,?,?,?,?,?,?,0)
           ON CONFLICT(product_id) DO UPDATE SET
             summary_json=excluded.summary_json,
             review_count_at=excluded.review_count_at,
             rating_at=excluded.rating_at,
             refreshed_at=excluded.refreshed_at,
             source_submissions=excluded.source_submissions""",
        (
            req.productId,
            json.dumps(summary),
            req.reviewCount,
            req.rating,
            insights_logic.MODEL,
            _iso(_now()),
            _iso(_now()),
            len(subs),
        ),
    )
    db.execute(
        """INSERT INTO ai_usage (user_id, month, count) VALUES (?,?,1)
           ON CONFLICT(user_id, month) DO UPDATE SET count=ai_usage.count+1""",
        (user["id"], month),
    )
    db.execute(
        """INSERT INTO ai_spend (day, usd) VALUES (?,0)
           ON CONFLICT(day) DO NOTHING""",
        (_now().date().isoformat(),),
    )
    db.commit()
    db.close()
    warning = (used + 1) >= int(limit * 0.8)
    return {"status": "ok", "summary": summary, "warning": warning}


@router.post("/trends/events")
async def trend_events(req: TrendBatch, request: Request):
    if request.headers.get("authorization"):
        raise HTTPException(400, "Trends events are anonymous")
    if len(await request.body()) > 64 * 1024:
        raise HTTPException(413, "Request body too large")
    db = _db()
    cutoff = (_now().date() - timedelta(days=90)).isoformat()
    db.execute("DELETE FROM product_events WHERE day < ?", (cutoff,))
    for event in req.events:
        event_id = hashlib.sha256(
            f"{event.weekToken}|{event.event}|{event.productId}|{event.day}".encode("utf-8")
        ).hexdigest()
        db.execute(
            """INSERT INTO product_events
                 (id, event, product_id, week_token, day, price, sold_count, rating, review_count, category_path, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO NOTHING""",
            (
                event_id,
                event.event,
                event.productId,
                event.weekToken,
                event.day,
                event.snapshot.price,
                event.snapshot.soldCountApprox,
                event.snapshot.rating,
                event.snapshot.reviewCount,
                event.snapshot.categoryPath,
                _iso(_now()),
            ),
        )
        db.execute(
            """INSERT INTO product_snapshots (product_id, day, price, sold_count, rating, review_count)
               VALUES (?,?,?,?,?,?)
               ON CONFLICT(product_id, day) DO UPDATE SET
                 price=excluded.price, sold_count=excluded.sold_count, rating=excluded.rating,
                 review_count=excluded.review_count""",
            (
                event.productId,
                event.day,
                event.snapshot.price,
                event.snapshot.soldCountApprox,
                event.snapshot.rating,
                event.snapshot.reviewCount,
            ),
        )
    db.commit()
    db.close()
    return {"ok": True}


def _weekly(db) -> list[dict[str, Any]]:
    rows = db.execute(
        "SELECT event, product_id, week_token, day, price, sold_count FROM product_events"
    ).fetchall()
    events = []
    for row in rows:
        item = dict(row)
        day = datetime.fromisoformat(item["day"])
        year, week, _ = day.isocalendar()
        item["week"] = f"{year}-W{week:02d}"
        events.append(item)
    rolled = trends_logic.rollup(events)
    for row in rolled:
        db.execute(
            """INSERT INTO product_weekly
                 (week, product_id, lookups, distinct_tokens, adds, removes, sold_delta, price_p50)
               VALUES (?,?,?,?,?,?,?,?)
               ON CONFLICT(week, product_id) DO UPDATE SET
                 lookups=excluded.lookups, distinct_tokens=excluded.distinct_tokens,
                 adds=excluded.adds, removes=excluded.removes,
                 sold_delta=excluded.sold_delta, price_p50=excluded.price_p50""",
            (
                row["week"],
                row["product_id"],
                row["lookups"],
                row["distinct_tokens"],
                row["adds"],
                row["removes"],
                row["sold_delta"],
                row["price_p50"],
            ),
        )
    db.commit()
    return rolled


@router.get("/trends/teaser")
async def trends_teaser():
    db = _db()
    rows = trends_logic.visible(_weekly(db), limit=3)
    db.close()
    return {"products": rows}


@router.get("/trends")
async def trends(request: Request):
    user = _bearer_user(request)
    db = _db()
    limit = None if user["tier"] == "diamond" else 10
    rows = trends_logic.visible(_weekly(db), limit=limit)
    db.close()
    return {"products": rows}


@router.get("/public/trends")
async def public_trends():
    db = _db()
    rows = trends_logic.visible(_weekly(db), limit=10)
    db.close()
    return {"products": [{"product_id": row["product_id"], "price_p50": row["price_p50"]} for row in rows]}


@router.post("/telemetry/error")
async def telemetry_error(req: ErrorReport, request: Request):
    if len(await request.body()) > 8 * 1024:
        raise HTTPException(413, "Request body too large")
    otel_setup.emit_error(req.model_dump())
    return {"ok": True}


@router.post("/telemetry/parse-failure")
async def parse_failure(req: ParseReport):
    db = _db()
    db.execute(
        """INSERT INTO parse_failures (day, surface, field, selector_version, count)
           VALUES (?,?,?,?,1)
           ON CONFLICT(day, surface, field, selector_version) DO UPDATE SET count=parse_failures.count+1""",
        (_now().date().isoformat(), req.surface, req.field, req.selectorVersion),
    )
    db.commit()
    db.close()
    return {"ok": True}


@router.get("/admin/v1/config")
async def admin_get_config(request: Request):
    _require_admin(request)
    return load_published() or {"published": False}


@router.put("/admin/v1/config")
async def admin_put_config(request: Request):
    _require_admin(request)
    raw = await request.json()
    try:
        doc = validate_config(raw)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    public_key = os.getenv("CONFIG_PUBLIC_KEY", "")
    if not verify_signature(doc, public_key):
        raise HTTPException(422, "Invalid config signature")
    db = _db()
    current = db.execute(
        "SELECT version, document_json FROM signed_remote_config WHERE service=?",
        (SERVICE,),
    ).fetchone()
    if current and int(doc["version"]) < int(current["version"]):
        db.close()
        raise HTTPException(409, "Config downgrade rejected")
    before = json.loads(current["document_json"]) if current else None
    db.execute(
        """INSERT INTO signed_remote_config (service, version, document_json, updated_at)
           VALUES (?,?,?,?)
           ON CONFLICT(service) DO UPDATE SET
             version=excluded.version, document_json=excluded.document_json, updated_at=excluded.updated_at""",
        (SERVICE, int(doc["version"]), json.dumps(doc), _iso(_now())),
    )
    _audit(db, "config.publish", SERVICE, before, {"version": doc["version"]})
    db.commit()
    db.close()
    return {"ok": True, "version": doc["version"]}


@router.get("/admin/v1/users")
async def admin_users(request: Request, email: str = ""):
    _require_admin(request)
    db = _db()
    rows = db.execute(
        """SELECT u.id, u.email, u.created_at, s.status, s.tier, s.tier_override,
                  s.tier_override_expires_at, s.stripe_sub_id
           FROM users u
           LEFT JOIN subscriptions s ON s.user_id=u.id AND s.service=?
           WHERE u.email=?""",
        (SERVICE, email),
    ).fetchall()
    usage = []
    if rows:
        usage = db.execute(
            "SELECT month, count FROM ai_usage WHERE user_id=?",
            (rows[0]["id"],),
        ).fetchall()
    db.close()
    return {
        "users": [dict(row) for row in rows],
        "fair_use": [dict(row) for row in usage],
    }


@router.post("/admin/v1/users/{user_id}/tier-override")
async def tier_override(user_id: int, req: TierOverrideReq, request: Request):
    _require_admin(request)
    db = _db()
    before = db.execute(
        "SELECT tier_override, tier_override_expires_at FROM subscriptions WHERE user_id=? AND service=?",
        (user_id, SERVICE),
    ).fetchone()
    db.execute(
        """INSERT INTO subscriptions
             (user_id, service, status, tier_override, tier_override_expires_at, tier_override_note)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(user_id, service) DO UPDATE SET
             tier_override=excluded.tier_override,
             tier_override_expires_at=excluded.tier_override_expires_at,
             tier_override_note=excluded.tier_override_note""",
        (user_id, SERVICE, "free", req.tier, req.expiresAt, req.note),
    )
    _audit(db, "tier.override", str(user_id), dict(before) if before else None, req.model_dump())
    db.commit()
    db.close()
    return {"ok": True}


@router.delete("/admin/v1/users/{user_id}/tier-override")
async def clear_tier_override(user_id: int, request: Request):
    _require_admin(request)
    db = _db()
    before = db.execute(
        "SELECT tier_override FROM subscriptions WHERE user_id=? AND service=?",
        (user_id, SERVICE),
    ).fetchone()
    db.execute(
        """UPDATE subscriptions
           SET tier_override=NULL, tier_override_expires_at=NULL, tier_override_note=NULL
           WHERE user_id=? AND service=?""",
        (user_id, SERVICE),
    )
    _audit(db, "tier.override.clear", str(user_id), dict(before) if before else None, None)
    db.commit()
    db.close()
    return {"ok": True}


@router.post("/admin/v1/users/{user_id}/reset-usage")
async def reset_usage(user_id: int, req: ResetUsageReq, request: Request):
    _require_admin(request)
    db = _db()
    before = db.execute("SELECT month, count FROM ai_usage WHERE user_id=?", (user_id,)).fetchall()
    db.execute("UPDATE ai_usage SET count=0 WHERE user_id=?", (user_id,))
    _audit(db, "usage.reset", str(user_id), [dict(row) for row in before], {"note": req.note})
    db.commit()
    db.close()
    return {"ok": True}


@router.post("/admin/v1/users/{user_id}/token-revoke")
async def token_revoke(user_id: int, request: Request):
    _require_admin(request)
    db = _db()
    before = db.execute("SELECT token_version FROM users WHERE id=?", (user_id,)).fetchone()
    db.execute("UPDATE users SET token_version=token_version+1 WHERE id=?", (user_id,))
    _audit(db, "token.revoke", str(user_id), dict(before) if before else None, {"revoked": True})
    db.commit()
    db.close()
    return {"ok": True}


@router.post("/admin/v1/users/{user_id}/note")
async def add_note(user_id: int, req: NoteReq, request: Request):
    _require_admin(request)
    db = _db()
    db.execute(
        "INSERT INTO support_notes (id, user_id, note, at) VALUES (?,?,?,?)",
        (uuid.uuid4().hex, user_id, req.note, _iso(_now())),
    )
    _audit(db, "note.add", str(user_id), None, {"note": req.note})
    db.commit()
    db.close()
    return {"ok": True}


@router.get("/admin/v1/metrics/summary")
async def metrics(request: Request):
    _require_admin(request)
    db = _db()
    from metrics_summary import build_summary

    summary = build_summary(db)
    db.close()
    return summary


def register_v1(app) -> None:
    app.include_router(router)
