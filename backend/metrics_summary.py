"""Business numbers shared by /admin/metrics/summary and the Grafana views."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any


def _cents(row: dict[str, Any]) -> float:
    amount = float(row.get("amount_cents") or 0)
    if row.get("interval") == "year":
        amount /= 12.0
    return amount


def build_summary(db) -> dict[str, Any]:
    subs = db.execute(
        """SELECT user_id, status, tier, stripe_sub_id, stripe_status, amount_cents, interval,
                  current_period_end, promo_expires_at
           FROM subscriptions WHERE service='tiktok-seller-tool'"""
    ).fetchall()
    users = db.execute("SELECT id FROM users").fetchall()
    mrr_cents = 0.0
    paying = 0
    trialing = 0
    ending = 0
    soon = datetime.now(timezone.utc) + timedelta(days=3)
    plans: dict[str, int] = {}
    sub_by_user = {row["user_id"]: row for row in subs}
    for user in users:
        row = sub_by_user.get(user["id"])
        plan = "free"
        if row:
            stripe_status = row.get("stripe_status") or ""
            promo = row.get("promo_expires_at")
            promo_open = bool(promo) and str(promo) > datetime.now(timezone.utc).isoformat()
            paid = stripe_status in ("active", "trialing") or (
                row.get("status") == "active" and not row.get("stripe_sub_id") and promo_open
            )
            if paid:
                named = row.get("tier")
                plan = named if named in ("pro", "diamond") else "free"
            if stripe_status == "active":
                mrr_cents += _cents(row)
                paying += 1
            if stripe_status == "trialing":
                trialing += 1
                end = row.get("current_period_end")
                if end and str(end) < soon.isoformat():
                    ending += 1
        plans[plan] = plans.get(plan, 0) + 1
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    week = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    events = db.execute(
        "SELECT event, user_id, payload_json, ts FROM telemetry_events WHERE ts > ?",
        (cutoff,),
    ).fetchall()
    funnel_names = {
        "user.registered",
        "overlay.shown",
        "cost.first_entered",
        "upgrade.clicked",
        "checkout.created",
        "subscription.state_changed",
        "statement.imported",
        "auth.register",
    }
    funnel: dict[str, set[int]] = {name: set() for name in funnel_names}
    price_hits = 0
    price_total = 0
    versions: dict[str, int] = {}
    for event in events:
        name = event["event"]
        if name in funnel and event.get("user_id") is not None:
            funnel[name].add(int(event["user_id"]))
        if name == "scrape.result":
            price_total += 1
            if '"priceFound":true' in str(event.get("payload_json") or "").replace(" ", ""):
                price_hits += 1
        if str(event.get("ts") or "") > week:
            payload = str(event.get("payload_json") or "")
            marker = '"extVersion":"'
            if marker in payload:
                version = payload.split(marker, 1)[1].split('"', 1)[0]
                versions[version] = versions.get(version, 0) + 1
    verified = 0
    try:
        verified = int(
            db.execute(
                "SELECT COUNT(*) AS n FROM users WHERE email_verified_at IS NOT NULL"
            ).fetchone()["n"]
        )
    except Exception:
        verified = 0
    trial_paid = None
    if trialing + paying:
        trial_paid = round(paying / (trialing + paying), 4)
    return {
        "mrr_usd": round(mrr_cents / 100.0, 2),
        "paying": paying,
        "trialing": trialing,
        "ending_3d": ending,
        "plans": plans,
        "funnel_30d": {name: len(ids) for name, ids in funnel.items()},
        "activation": {
            "install": len(funnel["overlay.shown"]),
            "signup": len(funnel["user.registered"]) + len(funnel["auth.register"]),
            "verified": verified,
            "first_cost": len(funnel["cost.first_entered"]),
            "statement_imported": len(funnel["statement.imported"]),
            "upgrade_clicked": len(funnel["upgrade.clicked"]),
            "paid": paying,
        },
        "trial_to_paid": trial_paid,
        "price_scrape_rate_7d": (price_hits / price_total) if price_total else None,
        "ext_versions_7d": versions,
    }
