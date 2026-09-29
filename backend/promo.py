"""Promo codes: one-month (or N-day) Pro without a live charge. Same Pro gate as Stripe."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{3,31}$")


class PromoError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def normalize_code(raw: str) -> str:
    return re.sub(r"\s+", "", (raw or "").strip().upper())


def parse_iso(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def effective_sub_status(row: Optional[dict], *, now: Optional[datetime] = None) -> str:
    if not row:
        return "free"
    if str(row.get("status") or "") != "active":
        return "free"
    now = now or datetime.now(timezone.utc)
    stripe_id = row.get("stripe_sub_id")
    if stripe_id:
        return "active"
    raw_exp = row.get("promo_expires_at")
    if raw_exp:
        exp = parse_iso(raw_exp)
        return "active" if exp and exp > now else "free"
    # Active with no Stripe id and no promo end date is a manual grant (ops
    # console "active (Pro)" or a direct DB edit). It stays Pro until someone
    # sets it back to free, so the database and the extension always agree.
    return "active"


def promo_expires_iso(days: int, *, now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    return (now + timedelta(days=max(1, int(days)))).isoformat()


def redeem_promo(db: Any, *, user_id: int, service: str, code: str) -> dict:
    normalized = normalize_code(code)
    if not CODE_RE.match(normalized):
        raise PromoError("Enter a valid promo code.")
    promo = db.execute(
        "SELECT * FROM promo_codes WHERE code=?",
        (normalized,),
    ).fetchone()
    if not promo or not int(promo["active"]):
        raise PromoError("That code is not valid.")
    if promo["service"] not in (service, "*"):
        raise PromoError("That code is not valid.")
    max_r = promo["max_redemptions"]
    if max_r is not None and int(promo["redeemed_count"]) >= int(max_r):
        raise PromoError("That code has been fully redeemed.")
    already = db.execute(
        "SELECT 1 FROM promo_redemptions WHERE user_id=? AND code=?",
        (user_id, normalized),
    ).fetchone()
    if already:
        raise PromoError("You already used this code.")
    sub = db.execute(
        "SELECT status, stripe_sub_id, promo_expires_at FROM subscriptions WHERE user_id=? AND service=?",
        (user_id, service),
    ).fetchone()
    if effective_sub_status(sub) == "active" and sub and sub.get("stripe_sub_id"):
        raise PromoError("You already have a paid Pro plan.")
    days = int(promo["duration_days"])
    expires = promo_expires_iso(days)
    db.execute(
        """
        INSERT INTO subscriptions (user_id, service, status, stripe_sub_id, promo_expires_at, tier)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT(user_id, service) DO UPDATE SET
          status=?,
          promo_expires_at=?,
          tier=CASE WHEN subscriptions.tier='diamond' THEN subscriptions.tier ELSE 'pro' END
        """,
        (user_id, service, "active", None, expires, "pro", "active", expires),
    )
    db.execute(
        "INSERT INTO promo_redemptions (user_id, code, service) VALUES (?,?,?)",
        (user_id, normalized, service),
    )
    db.execute(
        "UPDATE promo_codes SET redeemed_count=redeemed_count+1 WHERE code=?",
        (normalized,),
    )
    return {"code": normalized, "pro_days": days, "promo_expires_at": expires}
