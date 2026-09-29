"""Idempotent LLE/local seed. Refuses production."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

APP_ENV = os.getenv("APP_ENV", "local").lower()


def write_products_html(path: Path) -> None:
    rows = []
    for index in range(50):
        price = 0.99 if index == 0 else 999 if index == 1 else 10 + index
        promo = "" if index == 2 else f"<div>Promotion: ${price - 1:.2f}</div>"
        title = ("Screen protector " * 12).strip() if index == 3 else f"Sample product {index}"
        price_html = "" if index == 4 else f"<span>${price:.2f}</span>{promo}"
        rows.append(
            f"<tr><td><a href=\"/product/{1732672081725330000 + index}\">{title}</a>"
            f"<span>ID:{1732672081725330000 + index}</span></td><td>Live</td><td>{price_html}</td></tr>"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "<table><thead><tr><th>Product</th><th>Status</th><th>Price</th></tr></thead><tbody>"
        + "".join(rows)
        + "</tbody></table>",
        encoding="utf-8",
    )


def main() -> None:
    if APP_ENV not in ("local", "lle"):
        raise SystemExit("seed_lle.py refuses to run unless APP_ENV is local or lle")
    repo = ROOT.parent
    write_products_html(repo / "test-fixtures" / "synthetic" / "manage-products-50.html")
    from db import get_db
    from security.passwords import hash_password

    db = get_db()
    password = hash_password("Seed-password-9fY!3jQx")
    states = [
        ("free", "free", None, None, None, None),
        ("trialing", "pro", "trialing", 1499, "month", 7),
        ("pro-month", "pro", "active", 1499, "month", 30),
        ("pro-year", "pro", "active", 12000, "year", 300),
        ("past-due", "pro", "past_due", 1499, "month", 2),
        ("canceled", "free", "canceled", 1499, "month", -1),
        ("promo", "pro", None, None, None, 14),
        ("diamond", "diamond", "active", 3900, "month", 30),
    ]
    now = datetime.now(timezone.utc)
    for index in range(30):
        email = f"seed{index}@example.test"
        kind = states[index % len(states)]
        existing = db.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
        if existing:
            uid = int(existing["id"])
        else:
            cur = db.execute(
                "INSERT INTO users (email, password_hash, trial_used) VALUES (?,?,?)",
                (email, password, 0 if kind[0] == "free" else 1),
            )
            uid = int(cur.lastrowid)
        end = (now + timedelta(days=kind[5] or 0)).isoformat() if kind[5] is not None else None
        db.execute("DELETE FROM subscriptions WHERE user_id=? AND service='tiktok-seller-tool'", (uid,))
        db.execute(
            """INSERT INTO subscriptions
               (user_id, service, status, tier, stripe_status, amount_cents, interval, current_period_end, stripe_sub_id)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                uid,
                "tiktok-seller-tool",
                "active" if kind[0] not in ("free", "canceled") else "free",
                kind[1],
                kind[2],
                kind[3],
                kind[4],
                end,
                None if kind[0] in ("free", "promo") else f"sub_seed_{index}",
            ),
        )
        db.execute(
            """INSERT INTO telemetry_events (ts, service, event, user_id, payload_json, source)
               VALUES (?,?,?,?,?,?)""",
            (
                (now - timedelta(days=index % 30)).isoformat(),
                "tiktok-seller-tool",
                "overlay.shown",
                uid,
                '{"pageType":"productList","extVersion":"1.2.0","priceFound":true}',
                "extension",
            ),
        )
    existing_promo = db.execute("SELECT code FROM promo_codes WHERE code=?", ("BETA90",)).fetchone()
    if not existing_promo:
        db.execute(
            """INSERT INTO promo_codes
               (code, service, duration_days, max_redemptions, redeemed_count, active)
               VALUES (?,?,?,?,?,?)""",
            ("BETA90", "tiktok-seller-tool", 90, 25, 0, 1),
        )
    db.commit()
    db.close()
    print("seeded local/lle users, BETA90, and synthetic product list")


if __name__ == "__main__":
    main()
