"""v1.4: the database, the ops console, and /auth/me must agree on the plan."""

import os
import unittest
import unittest.mock

os.environ.setdefault("ENV", "development")
os.environ.setdefault("APP_ENV", "local")

import admin_db
import db
import marginmark_app
from fastapi.testclient import TestClient
from test_launch_v2 import LaunchDb


class ProSyncTests(unittest.TestCase):
    def setUp(self):
        self.db = LaunchDb()
        self.client = TestClient(marginmark_app.app)

    def tearDown(self):
        self.client.close()
        self.db.close()

    def _user(self, email):
        res = self.client.post(
            "/auth/register",
            headers={"Fly-Client-IP": "203.0.113.40"},
            json={"email": email, "password": "Valid-pass-1"},
        )
        token = res.json()["access_token"]
        conn = db.get_db()
        uid = conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()["id"]
        conn.close()
        return token, int(uid)

    def _me(self, token):
        res = self.client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(res.status_code, 200)
        return res.json()

    def test_PRO1_raw_active_row_without_tier_reads_pro(self):
        token, uid = self._user("legacy@example.com")
        conn = db.get_db()
        conn.execute(
            "INSERT INTO subscriptions (user_id, service, status) VALUES (?,?,?)",
            (uid, marginmark_app.SERVICE, "active"),
        )
        conn.commit()
        conn.close()
        me = self._me(token)
        self.assertTrue(me["is_pro"])
        self.assertEqual(me["tier"], "pro")

    def test_PRO2_ops_console_grant_reads_pro_and_sets_tier(self):
        token, uid = self._user("granted@example.com")
        conn = db.get_db()
        admin_db.upsert_subscription(conn, uid, marginmark_app.SERVICE, status="active")
        row = conn.execute(
            "SELECT tier FROM subscriptions WHERE user_id=?", (uid,)
        ).fetchone()
        conn.close()
        self.assertEqual(row["tier"], "pro")
        self.assertTrue(self._me(token)["is_pro"])

    def test_PRO3_ops_console_revoke_reads_free(self):
        token, uid = self._user("revoked@example.com")
        conn = db.get_db()
        admin_db.upsert_subscription(conn, uid, marginmark_app.SERVICE, status="active")
        admin_db.upsert_subscription(conn, uid, marginmark_app.SERVICE, status="free")
        conn.close()
        me = self._me(token)
        self.assertFalse(me["is_pro"])
        self.assertEqual(me["tier"], "free")

    def test_PRO4_expired_promo_reads_free(self):
        token, uid = self._user("promo@example.com")
        conn = db.get_db()
        conn.execute(
            "INSERT INTO subscriptions (user_id, service, status, promo_expires_at, tier) VALUES (?,?,?,?,?)",
            (uid, marginmark_app.SERVICE, "active", "2020-01-01T00:00:00+00:00", "pro"),
        )
        conn.commit()
        conn.close()
        self.assertFalse(self._me(token)["is_pro"])

    def test_PRO5_admin_users_plan_matches_me(self):
        token, uid = self._user("match@example.com")
        conn = db.get_db()
        conn.execute(
            "INSERT INTO subscriptions (user_id, service, status) VALUES (?,?,?)",
            (uid, marginmark_app.SERVICE, "active"),
        )
        conn.commit()
        conn.close()
        os.environ["ADMIN_API_TOKEN"] = "t" * 32
        try:
            with unittest.mock.patch.object(marginmark_app, "require_admin", lambda request: None):
                res = self.client.get("/admin/users")
        finally:
            os.environ.pop("ADMIN_API_TOKEN", None)
        plans = {u["email"]: u["plan"] for u in res.json()["users"]}
        self.assertEqual(plans["match@example.com"], self._me(token)["tier"])

    def test_PRO6_me_reports_plan_details_additively(self):
        token, uid = self._user("details@example.com")
        conn = db.get_db()
        conn.execute(
            """INSERT INTO subscriptions (user_id, service, status, stripe_sub_id, tier, interval, stripe_status, current_period_end)
               VALUES (?,?,?,?,?,?,?,?)""",
            (uid, marginmark_app.SERVICE, "active", "sub_1", "pro", "year", "trialing", "2027-01-01T00:00:00+00:00"),
        )
        conn.commit()
        conn.close()
        me = self._me(token)
        self.assertEqual(me["plan_interval"], "year")
        self.assertEqual(me["plan_status"], "trialing")
        self.assertEqual(me["current_period_end"], "2027-01-01T00:00:00+00:00")
        self.assertFalse(me["has_oauth"])

    def test_PRO7_email_change_requires_new_verification(self):
        token, uid = self._user("old@example.com")
        conn = db.get_db()
        conn.execute("UPDATE users SET email_verified_at='2026-01-01' WHERE id=?", (uid,))
        conn.commit()
        conn.close()
        res = self.client.post(
            "/auth/profile",
            headers={"Authorization": f"Bearer {token}"},
            json={"email": "new@example.com"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertFalse(self._me(token)["email_verified"])


if __name__ == "__main__":
    unittest.main()


class BrandedPagesTests(unittest.TestCase):
    def setUp(self):
        self.db = LaunchDb()
        self.client = TestClient(marginmark_app.app)

    def tearDown(self):
        self.client.close()
        self.db.close()

    def test_PAGE1_reset_form_is_branded_and_has_confirm_field(self):
        res = self.client.get("/auth/reset?token=abc")
        self.assertEqual(res.status_code, 200)
        self.assertIn("Choose a new password", res.text)
        self.assertIn('name="confirm"', res.text)
        self.assertIn("MarginMark", res.text)
        self.assertNotIn("<script", res.text)  # CSP allows no inline script

    def test_PAGE2_reset_rejects_mismatched_confirmation(self):
        res = self.client.post(
            "/auth/reset",
            content="token=" + "x" * 30 + "&password=Valid-pass-1&confirm=Different-1",
            headers={"content-type": "application/x-www-form-urlencoded"},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("don&#x27;t match", res.text)

    def test_PAGE3_reset_token_is_escaped(self):
        res = self.client.get('/auth/reset?token="><b>x</b>')
        self.assertNotIn("<b>x</b>", res.text)

    def test_PAGE4_billing_done_success_and_cancel(self):
        ok = self.client.get("/billing/done?ok=1")
        self.assertIn("Welcome to MarginMark Pro", ok.text)
        no = self.client.get("/billing/done?ok=0")
        self.assertIn("Checkout cancelled", no.text)

    def test_PAGE5_support_accepts_billing_and_feature_kinds(self):
        for kind in ("billing", "feature", "problem", "support"):
            res = self.client.post(
                "/support/ticket",
                headers={"Fly-Client-IP": f"203.0.113.{60 + len(kind)}"},
                json={"email": "a@example.com", "subject": "Hi", "message": "Hello there", "kind": kind},
            )
            self.assertEqual(res.status_code, 200, kind)


class PasswordChangeTests(unittest.TestCase):
    def setUp(self):
        self.db = LaunchDb()
        self.client = TestClient(marginmark_app.app)

    def tearDown(self):
        self.client.close()
        self.db.close()

    def test_SEC1_password_change_revokes_old_tokens_and_returns_fresh_one(self):
        res = self.client.post(
            "/auth/register",
            headers={"Fly-Client-IP": "203.0.113.70"},
            json={"email": "sec@example.com", "password": "Valid-pass-1"},
        )
        old = res.json()["access_token"]
        changed = self.client.post(
            "/auth/change-password",
            headers={"Authorization": f"Bearer {old}"},
            json={"current_password": "Valid-pass-1", "new_password": "Brand-new-2"},
        )
        self.assertEqual(changed.status_code, 200)
        fresh = changed.json()["access_token"]
        stale = self.client.get("/auth/me", headers={"Authorization": f"Bearer {old}"})
        self.assertEqual(stale.status_code, 401)
        ok = self.client.get("/auth/me", headers={"Authorization": f"Bearer {fresh}"})
        self.assertEqual(ok.status_code, 200)
