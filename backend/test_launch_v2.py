"""Launch-blocker tests. IDs match the v2 audit prompt."""

import json
import os
import tempfile
import time
import unittest
from unittest.mock import patch

os.environ.setdefault("ENV", "development")
os.environ.setdefault("APP_ENV", "local")

import db
import marginmark_app
import oauth
import support_mail
from fastapi.testclient import TestClient
from security.passwords import hash_password


class LaunchDb:
    def __init__(self):
        handle = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.path = handle.name
        handle.close()
        self.patches = [
            patch.object(db, "USE_POSTGRES", False),
            patch.object(db, "DB_PATH", self.path),
            patch.object(marginmark_app, "JWT_SECRET", "unit-test-secret-value"),
            patch.object(marginmark_app, "STRIPE_SECRET_KEY", ""),
        ]
        for item in self.patches:
            item.start()
        db.init_db()

    def close(self):
        for item in reversed(self.patches):
            item.stop()
        os.unlink(self.path)


class LaunchTests(unittest.TestCase):
    def setUp(self):
        self.db = LaunchDb()
        self.client = TestClient(marginmark_app.app)
        self.mail = {}

        def send(to, subject, body):
            self.mail["to"] = to
            self.mail["subject"] = subject
            self.mail["body"] = body
            return True

        self.send = patch.object(support_mail, "send_transactional", send)
        self.ready = patch.object(support_mail, "smtp_ready", return_value=True)
        self.send.start()
        self.ready.start()

    def tearDown(self):
        self.ready.stop()
        self.send.stop()
        self.client.close()
        self.db.close()

    def _register(self, email="seller@example.com", password="Valid-pass-1"):
        return self.client.post(
            "/auth/register",
            headers={"Fly-Client-IP": "203.0.113.10"},
            json={"email": email, "password": password},
        )

    def test_L1_no_smtp_returns_503(self):
        self.ready.stop()
        off = patch.object(support_mail, "smtp_ready", return_value=False)
        off.start()
        self.addCleanup(off.stop)
        response = self.client.post(
            "/auth/forgot-password",
            headers={"Fly-Client-IP": "203.0.113.11"},
            json={"email": "seller@example.com"},
        )
        self.assertEqual(response.status_code, 503)
        self.assertIn("not available yet", response.json()["detail"])
        self.assertNotIn("body", self.mail)

    def test_L1_reset_token_single_use(self):
        self._register()
        forgot = self.client.post(
            "/auth/forgot-password",
            headers={"Fly-Client-IP": "203.0.113.12"},
            json={"email": "seller@example.com"},
        )
        self.assertEqual(forgot.status_code, 200)
        token = self.mail["body"].split("token=")[1].split()[0]
        first = self.client.post(
            "/auth/reset",
            headers={"Fly-Client-IP": "203.0.113.12"},
            json={"token": token, "password": "Next-pass-2"},
        )
        self.assertEqual(first.status_code, 200)
        second = self.client.post(
            "/auth/reset",
            headers={"Fly-Client-IP": "203.0.113.13"},
            json={"token": token, "password": "Next-pass-3"},
        )
        self.assertEqual(second.status_code, 400)

    def test_L1_reset_expires(self):
        self._register("old@example.com")
        conn = db.get_db()
        user = conn.execute("SELECT id FROM users WHERE email=?", ("old@example.com",)).fetchone()
        conn.execute(
            "INSERT INTO password_resets (token_hash, user_id, expires_at, used_at) VALUES (?,?,?,NULL)",
            (marginmark_app.account_flow.hash_secret("expired-token-value-0001"), user["id"], int(time.time()) - 10),
        )
        conn.commit()
        conn.close()
        response = self.client.post(
            "/auth/reset",
            headers={"Fly-Client-IP": "203.0.113.14"},
            json={"token": "expired-token-value-0001", "password": "Next-pass-2"},
        )
        self.assertEqual(response.status_code, 400)

    def test_L1_reset_bumps_token_version(self):
        registered = self._register("bump@example.com")
        token = registered.json()["access_token"]
        self.client.post(
            "/auth/forgot-password",
            headers={"Fly-Client-IP": "203.0.113.15"},
            json={"email": "bump@example.com"},
        )
        reset_token = self.mail["body"].split("token=")[1].split()[0]
        saved = self.client.post(
            "/auth/reset",
            headers={"Fly-Client-IP": "203.0.113.15"},
            json={"token": reset_token, "password": "Next-pass-2"},
        )
        self.assertEqual(saved.status_code, 200)
        me = self.client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(me.status_code, 401)

    def test_L2_checkout_requires_verified_email(self):
        registered = self._register("pay@example.com")
        token = registered.json()["access_token"]
        response = self.client.post(
            "/billing/checkout",
            headers={"Authorization": f"Bearer {token}", "Fly-Client-IP": "203.0.113.16"},
            json={"billing_interval": "monthly"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertIn("Verify your email", response.json()["detail"])

    def test_L2_code_attempt_limit(self):
        registered = self._register("code@example.com")
        token = registered.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}", "Fly-Client-IP": "203.0.113.17"}
        for _ in range(4):
            bad = self.client.post("/auth/verify-email", headers=headers, json={"code": "000000"})
            self.assertEqual(bad.status_code, 400)
        locked = self.client.post("/auth/verify-email", headers=headers, json={"code": "000000"})
        self.assertEqual(locked.status_code, 429)

    def test_L2_oauth_google_verified(self):
        uid, created = oauth.find_or_create_oauth_user(
            oauth.OAuthProfile("google", "google-sub", "google@example.com")
        )
        self.assertTrue(created)
        conn = db.get_db()
        row = conn.execute("SELECT email_verified_at FROM users WHERE id=?", (uid,)).fetchone()
        conn.close()
        self.assertTrue(row["email_verified_at"])

    def test_L3_no_customer_lookup_by_email(self):
        registered = self._register("stripe@example.com")
        token = registered.json()["access_token"]
        with patch.object(marginmark_app.stripe.Customer, "list", side_effect=AssertionError("email lookup")):
            response = self.client.get(
                "/auth/me",
                headers={"Authorization": f"Bearer {token}"},
            )
        self.assertEqual(response.status_code, 200)

    def test_L3_me_skips_stripe_when_no_pending_checkout(self):
        registered = self._register("quiet@example.com")
        token = registered.json()["access_token"]
        with patch.object(marginmark_app, "STRIPE_SECRET_KEY", "sk_test_x"), patch.object(
            marginmark_app.stripe.Subscription, "list", side_effect=AssertionError("stripe")
        ):
            response = self.client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["is_pro"])
        self.assertEqual(response.json()["tier"], "free")

    def test_L3_plan_change_updates_tier(self):
        conn = db.get_db()
        conn.execute(
            "INSERT INTO users (email, password_hash) VALUES (?,?)",
            ("plan@example.com", hash_password("Valid-pass-1")),
        )
        user = conn.execute("SELECT id FROM users WHERE email=?", ("plan@example.com",)).fetchone()
        conn.execute(
            "INSERT INTO subscriptions (user_id, service, status, stripe_sub_id, tier) VALUES (?,?,?,?,?)",
            (user["id"], "tiktok-seller-tool", "active", "sub_plan", "pro"),
        )
        conn.commit()
        with patch.dict(os.environ, {"STRIPE_PRICE_PRO_YEARLY": "price_year"}):
            change = marginmark_app._apply_subscription_event(
                {
                    "id": "sub_plan",
                    "status": "active",
                    "items": {
                        "data": [
                            {
                                "price": {
                                    "id": "price_year",
                                    "unit_amount": 12000,
                                    "recurring": {"interval": "year"},
                                }
                            }
                        ]
                    },
                },
                "active",
                None,
                conn,
            )
        conn.commit()
        row = conn.execute(
            "SELECT tier FROM subscriptions WHERE stripe_sub_id=?",
            ("sub_plan",),
        ).fetchone()
        conn.close()
        self.assertEqual(change["tier"], "pro")
        self.assertEqual(row["tier"], "pro")

    def test_L3_diamond_not_downgraded_by_sync(self):
        conn = db.get_db()
        conn.execute(
            "INSERT INTO users (email, password_hash) VALUES (?,?)",
            ("dia@example.com", hash_password("Valid-pass-1")),
        )
        user = conn.execute("SELECT id FROM users WHERE email=?", ("dia@example.com",)).fetchone()
        conn.execute(
            "INSERT INTO subscriptions (user_id, service, status, stripe_sub_id, tier) VALUES (?,?,?,?,?)",
            (user["id"], "tiktok-seller-tool", "active", "sub_dia", "diamond"),
        )
        conn.commit()
        with patch.dict(os.environ, {"STRIPE_PRICE_PRO_MONTHLY": "price_month"}):
            change = marginmark_app._apply_subscription_event(
                {
                    "id": "sub_dia",
                    "status": "active",
                    "items": {
                        "data": [
                            {
                                "price": {
                                    "id": "price_month",
                                    "unit_amount": 1499,
                                    "recurring": {"interval": "month"},
                                }
                            }
                        ]
                    },
                },
                "active",
                None,
                conn,
            )
        row = conn.execute(
            "SELECT tier FROM subscriptions WHERE stripe_sub_id=?",
            ("sub_dia",),
        ).fetchone()
        conn.close()
        self.assertEqual(change["tier"], "diamond")
        self.assertEqual(row["tier"], "diamond")

    def test_S1_rate_limit_memory_bounded(self):
        self.client.get("/health")
        from starlette.middleware.base import BaseHTTPMiddleware

        mounted = marginmark_app.app.middleware_stack
        found = _find_limiter(mounted)
        self.assertIsNotNone(found)
        now = time.time()
        for index in range(found.max_keys + 1):
            found.hits[f"k{index}"].append(now)
        found.hits["stale"].append(now - 120)
        found.prune_buckets(now)
        self.assertLessEqual(len(found.hits), found.max_keys)
        self.assertNotIn("stale", found.hits)
        self.assertTrue(issubclass(type(found), BaseHTTPMiddleware))

    def test_S4_refresh_issues_a_new_token(self):
        self._register("refresh@example.com")
        conn = db.get_db()
        user = conn.execute(
            "SELECT id, token_version FROM users WHERE email=?",
            ("refresh@example.com",),
        ).fetchone()
        conn.close()
        issued = int(time.time()) - 10 * 86400
        token = marginmark_app.make_token(int(user["id"]), int(user["token_version"]), now=issued)
        refreshed = self.client.post(
            "/auth/refresh",
            headers={"Authorization": f"Bearer {token}", "Fly-Client-IP": "203.0.113.18"},
        )
        self.assertEqual(refreshed.status_code, 200)
        new_token = refreshed.json()["access_token"]
        self.assertNotEqual(new_token, token)
        old_exp = json.loads(marginmark_app._b64_decode(token.split(".", 1)[0]))["exp"]
        new_exp = json.loads(marginmark_app._b64_decode(new_token.split(".", 1)[0]))["exp"]
        self.assertGreater(new_exp, old_exp)
        me = self.client.get("/auth/me", headers={"Authorization": f"Bearer {new_token}"})
        self.assertEqual(me.status_code, 200)

    def test_L5_providers_follow_credentials(self):
        blank = {
            "GOOGLE_CLIENT_ID": "",
            "GOOGLE_CLIENT_SECRET": "",
            "FACEBOOK_APP_ID": "",
            "FACEBOOK_APP_SECRET": "",
            "TIKTOK_CLIENT_KEY": "",
            "TIKTOK_CLIENT_SECRET": "",
        }
        with patch.dict(os.environ, blank, clear=False):
            response = self.client.get("/auth/providers")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["providers"], [])
        with patch.dict(
            os.environ,
            {**blank, "TIKTOK_CLIENT_KEY": "tiktok-key", "TIKTOK_CLIENT_SECRET": "tiktok-secret"},
            clear=False,
        ):
            listed = self.client.get("/auth/providers")
        self.assertEqual(listed.json()["providers"], ["tiktok"])

    def test_profile_keeps_session(self):
        registered = self._register("profile@example.com")
        token = registered.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}", "Fly-Client-IP": "203.0.113.40"}
        saved = self.client.post(
            "/auth/profile",
            headers=headers,
            json={"display_name": "Ada", "email": "ada@example.com"},
        )
        self.assertEqual(saved.status_code, 200)
        me = self.client.get("/auth/me", headers=headers)
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["display_name"], "Ada")
        self.assertEqual(me.json()["email"], "ada@example.com")
        self.assertIn("is_pro", me.json())
        changed = self.client.post(
            "/auth/change-password",
            headers=headers,
            json={"current_password": "Valid-pass-1", "new_password": "Next-pass-2"},
        )
        self.assertEqual(changed.status_code, 200)
        # The old token is revoked (other devices are signed out); this session
        # continues on the fresh token the API returns.
        self.assertEqual(self.client.get("/auth/me", headers=headers).status_code, 401)
        headers = {**headers, "Authorization": f"Bearer {changed.json()['access_token']}"}
        still = self.client.get("/auth/me", headers=headers)
        self.assertEqual(still.status_code, 200)
        wrong = self.client.post(
            "/auth/change-password",
            headers=headers,
            json={"current_password": "nope", "new_password": "Next-pass-3"},
        )
        self.assertEqual(wrong.status_code, 400)

    def test_google_account_can_set_password_without_losing_login(self):
        uid, _created = oauth.find_or_create_oauth_user(
            oauth.OAuthProfile("google", "sub-profile", "google-profile@example.com")
        )
        token = marginmark_app.make_token(uid)
        headers = {"Authorization": f"Bearer {token}"}
        saved = self.client.post(
            "/auth/change-password",
            headers=headers,
            json={"current_password": "", "new_password": "Next-pass-2"},
        )
        self.assertEqual(saved.status_code, 200)
        headers = {"Authorization": f"Bearer {saved.json()['access_token']}"}
        me = self.client.get("/auth/me", headers=headers)
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["email"], "google-profile@example.com")


def _find_limiter(app):
    seen = set()
    stack = [app]
    while stack:
        current = stack.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        if isinstance(current, marginmark_app.RateLimitMiddleware):
            return current
        inner = getattr(current, "app", None)
        if inner is not None:
            stack.append(inner)
    return None


class DeletePiiTests(unittest.TestCase):
    def test_S3_delete_purges_pii(self):
        launch = LaunchDb()
        try:
            conn = db.get_db()
            conn.execute(
                "INSERT INTO users (email, password_hash, stripe_customer_id) VALUES (?,?,?)",
                ("gone@example.com", hash_password("Valid-pass-1"), "cus_test"),
            )
            user = conn.execute("SELECT id FROM users WHERE email=?", ("gone@example.com",)).fetchone()
            uid = user["id"]
            conn.execute(
                "INSERT INTO subscriptions (user_id, service, status, stripe_sub_id) VALUES (?,?,?,?)",
                (uid, "tiktok-seller-tool", "active", "sub_test"),
            )
            conn.execute(
                "INSERT INTO telemetry_events (ts, service, event, user_id, payload_json, source) VALUES (?,?,?,?,?,?)",
                ("2020-01-01T00:00:00+00:00", "tiktok-seller-tool", "overlay.shown", uid, "{}", "extension"),
            )
            conn.execute(
                "INSERT INTO support_tickets (user_id, service, email, subject, message, created_at) VALUES (?,?,?,?,?,?)",
                (uid, "tiktok-seller-tool", "gone@example.com", "old", "note", "2020-01-01T00:00:00+00:00"),
            )
            conn.commit()
            order = []

            def cancel(sub_id):
                order.append(("cancel", sub_id))

            def delete_customer(customer_id):
                order.append(("customer", customer_id))

            with patch.object(marginmark_app.stripe, "api_key", "sk_test_x"), patch.object(
                marginmark_app.stripe.Subscription, "cancel", cancel
            ), patch.object(marginmark_app.stripe.Customer, "delete", delete_customer):
                from admin_db import delete_user

                delete_user(conn, uid)
            event = conn.execute(
                "SELECT user_id FROM telemetry_events WHERE event=?",
                ("overlay.shown",),
            ).fetchone()
            ticket = conn.execute(
                "SELECT id FROM support_tickets WHERE email=?",
                ("gone@example.com",),
            ).fetchone()
            conn.close()
            self.assertIsNone(event["user_id"])
            self.assertIsNone(ticket)
            self.assertEqual(order, [("cancel", "sub_test"), ("customer", "cus_test")])
        finally:
            launch.close()
