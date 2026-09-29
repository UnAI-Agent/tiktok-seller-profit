import os
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch

os.environ.setdefault("ENV", "development")
os.environ.setdefault("APP_ENV", "local")

import marginmark_app
from billing_env import checkout_extra, price_amount_matches, trial_allowed
from db import DbConnection
from fastapi.testclient import TestClient
from metrics_summary import build_summary


class TempDb:
    def __init__(self):
        handle = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.path = handle.name
        handle.close()

    def connect(self) -> DbConnection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return DbConnection(conn, is_postgres=False)


class V12Tests(unittest.TestCase):
    def test_n7_second_checkout_and_existing_customer_have_no_trial(self):
        self.assertFalse(trial_allowed(1, 0))
        self.assertFalse(trial_allowed(0, 1))
        self.assertEqual(checkout_extra("tiktok-seller-tool", trial_allowed=False), {})
        self.assertIn("trial_period_days", str(checkout_extra("tiktok-seller-tool", trial_allowed=True)))

    def test_n21_price_amount_matches_tiers(self):
        self.assertTrue(price_amount_matches(1499, "month", 14.99, "month"))
        self.assertTrue(price_amount_matches(12000, "year", 120, "year"))
        self.assertFalse(price_amount_matches(999, "month", 14.99, "month"))

    def test_n9_webhook_is_not_rate_limited(self):
        temp = TempDb()
        db = temp.connect()
        db.execute(
            """CREATE TABLE stripe_events (
                event_id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL
            )"""
        )
        db.commit()

        def fake_get_db():
            return temp.connect()

        def fake_event(payload, sig, secret):
            return {
                "id": payload.decode(),
                "type": "invoice.paid",
                "data": {"object": {}},
            }

        client = TestClient(marginmark_app.app)
        with patch.object(marginmark_app, "get_db", fake_get_db), patch.object(
            marginmark_app.stripe.Webhook, "construct_event", fake_event
        ), patch.object(marginmark_app, "STRIPE_WEBHOOK_SECRET", "whsec_test"):
            for index in range(30):
                response = client.post(
                    "/billing/webhook",
                    content=f"evt_{index}".encode(),
                    headers={"stripe-signature": "t"},
                )
                self.assertEqual(response.status_code, 200, response.text)

    def test_metrics_yearly_is_ten_dollars_and_trials_are_excluded(self):
        temp = TempDb()
        db = temp.connect()
        db.execute("CREATE TABLE users (id INTEGER PRIMARY KEY)")
        db.execute(
            """CREATE TABLE subscriptions (
                user_id INTEGER, service TEXT, status TEXT, tier TEXT, stripe_sub_id TEXT,
                stripe_status TEXT, amount_cents INTEGER, interval TEXT,
                current_period_end TEXT, promo_expires_at TEXT
            )"""
        )
        db.execute(
            """CREATE TABLE telemetry_events (
                event TEXT, user_id INTEGER, payload_json TEXT, ts TEXT
            )"""
        )
        db.execute("INSERT INTO users (id) VALUES (1),(2)")
        db.execute(
            """INSERT INTO subscriptions
               (user_id, service, status, tier, stripe_sub_id, stripe_status, amount_cents, interval)
               VALUES (1,'tiktok-seller-tool','active','pro','sub_year','active',12000,'year')"""
        )
        db.execute(
            """INSERT INTO subscriptions
               (user_id, service, status, tier, stripe_sub_id, stripe_status, amount_cents, interval)
               VALUES (2,'tiktok-seller-tool','active','pro','sub_trial','trialing',1499,'month')"""
        )
        db.commit()
        summary = build_summary(db)
        db.close()
        self.assertEqual(summary["mrr_usd"], 10)
        self.assertEqual(summary["paying"], 1)
        self.assertEqual(summary["trialing"], 1)

    def test_n10_concurrent_logins_are_not_serial(self):
        from security.passwords import hash_password

        temp = TempDb()
        db = temp.connect()
        db.execute(
            """CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                email TEXT,
                password_hash TEXT,
                token_version INTEGER NOT NULL DEFAULT 0
            )"""
        )
        db.execute(
            """CREATE TABLE telemetry_events (
                ts TEXT, service TEXT, event TEXT, user_id INTEGER, payload_json TEXT, source TEXT
            )"""
        )
        digest = hash_password("Seed-password-9fY!3jQx")
        for index in range(20):
            db.execute(
                "INSERT INTO users (email, password_hash, token_version) VALUES (?,?,0)",
                (f"user{index}@example.test", digest),
            )
        db.commit()

        def fake_get_db():
            return temp.connect()

        import anyio
        from httpx import ASGITransport, AsyncClient

        body = {"email": "user0@example.test", "password": "Seed-password-9fY!3jQx"}

        async def run():
            transport = ASGITransport(app=marginmark_app.app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                started = time.perf_counter()
                one = await client.post("/auth/login", json=body)
                single = time.perf_counter() - started
                self.assertEqual(one.status_code, 200)
                started = time.perf_counter()
                responses = []

                async def hit(index: int) -> None:
                    responses.append(
                        await client.post(
                            "/auth/login",
                            json={"email": f"user{index}@example.test", "password": body["password"]},
                        )
                    )

                async with anyio.create_task_group() as group:
                    for index in range(20):
                        group.start_soon(hit, index)
                many = time.perf_counter() - started
                self.assertTrue(all(item.status_code == 200 for item in responses))
                self.assertLess(many, max(single * 6, 3))

        with patch.object(marginmark_app, "get_db", fake_get_db):
            anyio.run(run)

    def test_checkout_rejects_coupon(self):
        from pydantic import ValidationError

        with self.assertRaises(ValidationError):
            marginmark_app.CheckoutReq(coupon="HALF")

    def test_invoice_subscription_id_reads_parent(self):
        self.assertEqual(marginmark_app.invoice_subscription_id({"subscription": "sub_old"}), "sub_old")
        self.assertEqual(
            marginmark_app.invoice_subscription_id(
                {"parent": {"subscription_details": {"subscription": "sub_new"}}}
            ),
            "sub_new",
        )

    def test_tiers_path_prefers_override(self):
        import tiers

        handle = tempfile.NamedTemporaryFile(suffix=".json", delete=False)
        handle.write(b"{}")
        handle.close()
        with patch.dict(os.environ, {"TIERS_PATH": handle.name}):
            self.assertEqual(str(tiers.resolve_tiers_path()), handle.name)
        os.unlink(handle.name)

    def test_missing_tier_on_active_row_is_pro(self):
        from tiers import effective_tier

        self.assertEqual(effective_tier(None, active=False), "free")
        # Rows paid or granted before the tier column existed have tier NULL.
        self.assertEqual(effective_tier({"status": "active"}, active=True), "pro")
        self.assertEqual(effective_tier({"status": "active", "tier": "free"}, active=True), "pro")
        self.assertEqual(effective_tier({"tier": "pro", "status": "active"}, active=True), "pro")
        self.assertEqual(effective_tier({"tier": "diamond"}, active=True), "diamond")
        self.assertEqual(effective_tier({"tier": "pro"}, active=False), "free")

    def test_support_ticket_is_stored(self):
        temp = TempDb()
        db = temp.connect()
        db.execute(
            """CREATE TABLE support_tickets (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                service TEXT NOT NULL,
                email TEXT NOT NULL,
                subject TEXT NOT NULL,
                message TEXT NOT NULL,
                status TEXT DEFAULT 'open',
                created_at TEXT
            )"""
        )
        db.execute(
            """CREATE TABLE telemetry_events (
                id INTEGER PRIMARY KEY,
                ts TEXT,
                service TEXT,
                event TEXT,
                user_id INTEGER,
                payload_json TEXT,
                source TEXT
            )"""
        )
        db.commit()
        client = TestClient(marginmark_app.app)
        with patch.object(marginmark_app, "get_db", temp.connect), patch.object(
            marginmark_app.support_mail, "send_support_email", return_value=True
        ) as mailed:
            response = client.post(
                "/support/ticket",
                json={
                    "email": "seller@example.com",
                    "subject": "Overlay",
                    "message": "Price did not read",
                },
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["emailed"])
        self.assertEqual(mailed.call_args.kwargs["reply_to"], "seller@example.com")
        self.assertEqual(mailed.call_args.kwargs["subject"], "[support] Overlay")
        saved = temp.connect().execute("SELECT email, subject FROM support_tickets").fetchone()
        self.assertEqual(saved["email"], "seller@example.com")
        self.assertEqual(saved["subject"], "Overlay")

    def test_problem_ticket_is_tagged_and_unknown_kind_is_rejected(self):
        temp = TempDb()
        db = temp.connect()
        db.execute(
            """CREATE TABLE support_tickets (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                service TEXT NOT NULL,
                email TEXT NOT NULL,
                subject TEXT NOT NULL,
                message TEXT NOT NULL,
                status TEXT DEFAULT 'open',
                created_at TEXT
            )"""
        )
        db.commit()
        client = TestClient(marginmark_app.app)
        with patch.object(marginmark_app, "get_db", temp.connect), patch.object(
            marginmark_app.support_mail, "send_support_email", return_value=True
        ) as mailed:
            ok = client.post(
                "/support/ticket",
                json={
                    "email": "seller@example.com",
                    "subject": "Price",
                    "message": "Missing",
                    "kind": "problem",
                },
            )
            rejected = client.post(
                "/support/ticket",
                json={
                    "email": "seller@example.com",
                    "subject": "Price",
                    "message": "Missing",
                    "kind": "not-a-real-kind",
                },
            )
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertEqual(mailed.call_args.kwargs["subject"], "[problem] Price")
        self.assertIn("Kind: problem", mailed.call_args.kwargs["message"])
        self.assertEqual(rejected.status_code, 422, rejected.text)

    def test_support_email_is_addressed_to_the_inbox(self):
        sent = {}

        class FakeSMTP:
            def __init__(self, host, port, timeout=0):
                del host, port, timeout

            def ehlo(self):
                return None

            def starttls(self):
                return None

            def send_message(self, mail):
                sent["to"] = mail["To"]
                sent["reply"] = mail["Reply-To"]

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        with patch.dict(
            os.environ,
            {
                "SMTP_HOST": "smtp.example.com",
                "SMTP_PORT": "587",
                "SUPPORT_INBOX": "hello@example.com",
                "SMTP_FROM": "hello@example.com",
                "SMTP_USER": "",
                "SMTP_PASSWORD": "",
            },
        ), patch("support_mail.smtplib.SMTP", FakeSMTP):
            ok = marginmark_app.support_mail.send_support_email(
                reply_to="seller@example.com",
                subject="Overlay",
                message="Price did not read",
                ticket_id=4,
            )
        self.assertTrue(ok)
        self.assertEqual(sent["to"], "hello@example.com")
        self.assertEqual(sent["reply"], "seller@example.com")


if __name__ == "__main__":
    unittest.main()
