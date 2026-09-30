"""Happy path, auth failure, and one validation failure for routes the recorder flagged."""

import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

os.environ.setdefault("ENV", "development")
os.environ.setdefault("APP_ENV", "local")

import db
import marginmark_app
import oauth
from fastapi.testclient import TestClient
from test_launch_v2 import LaunchDb

WEEK_A = "a" * 64
WEEK_B = "b" * 64
MODEL = '{"topComplaint":"thin fabric","topPraise":"soft","flags":["size"]}'


class GapRouteTests(unittest.TestCase):
    def setUp(self):
        self.db = LaunchDb()
        self.client = TestClient(marginmark_app.app)
        self.n = 0

    def tearDown(self):
        self.client.close()
        self.db.close()

    def _ip(self) -> str:
        self.n += 1
        return f"203.0.113.{self.n}"

    def _admin_headers(self) -> dict:
        return {"X-Admin-Key": marginmark_app.ADMIN_KEY, "Fly-Client-IP": self._ip()}

    def _telemetry_headers(self) -> dict:
        return {"X-Telemetry-Key": marginmark_app.TELEMETRY_READ_KEY, "Fly-Client-IP": self._ip()}

    def _register(self, email: str, password: str = "Valid-pass-1") -> str:
        response = self.client.post(
            "/auth/register",
            headers={"Fly-Client-IP": self._ip()},
            json={"email": email, "password": password},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["access_token"]

    def _uid(self, email: str) -> int:
        conn = db.get_db()
        row = conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
        conn.close()
        return int(row["id"])

    def _auth(self, token: str) -> dict:
        return {"Authorization": f"Bearer {token}", "Fly-Client-IP": self._ip()}

    def test_admin_reads_and_writes(self):
        """@F-ADMIN-DB @F-ADMIN-PROMO @F-ADMIN-USERS"""
        bare = self.client.get("/admin/overview", headers={"Fly-Client-IP": self._ip()})
        self.assertEqual(bare.status_code, 401)
        overview = self.client.get("/admin/overview", headers=self._admin_headers())
        self.assertEqual(overview.status_code, 200, overview.text)
        self.assertIn("users", overview.json())
        summary = self.client.get("/admin/metrics/summary", headers=self._admin_headers())
        self.assertEqual(summary.status_code, 200, summary.text)
        tables = self.client.get("/admin/db/tables", headers=self._admin_headers())
        self.assertEqual(tables.status_code, 200, tables.text)
        self.assertTrue(tables.json()["tables"])
        bad_table = self.client.get(
            "/admin/db/rows",
            headers=self._admin_headers(),
            params={"table": "not_a_table"},
        )
        self.assertGreaterEqual(bad_table.status_code, 400)
        self.assertLess(bad_table.status_code, 500)
        rows = self.client.get(
            "/admin/db/rows",
            headers=self._admin_headers(),
            params={"table": "users"},
        )
        self.assertEqual(rows.status_code, 200, rows.text)
        inserted = self.client.post(
            "/admin/db/rows",
            headers=self._admin_headers(),
            json={
                "table": "users",
                "values": {"email": "rowinsert@e2e.test", "password_hash": "Valid-pass-1"},
            },
        )
        self.assertEqual(inserted.status_code, 200, inserted.text)
        listed = self.client.get(
            "/admin/db/rows",
            headers=self._admin_headers(),
            params={"table": "users", "q": "rowinsert@e2e.test"},
        )
        uid = listed.json()["rows"][0]["id"]
        updated = self.client.put(
            "/admin/db/rows",
            headers=self._admin_headers(),
            json={"table": "users", "pk": {"id": uid}, "values": {"display_name": "Row"}},
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        missing_pk = self.client.put(
            "/admin/db/rows",
            headers=self._admin_headers(),
            json={"table": "users", "values": {"display_name": "No"}},
        )
        self.assertEqual(missing_pk.status_code, 400, missing_pk.text)
        removed = self.client.post(
            "/admin/db/rows/delete",
            headers=self._admin_headers(),
            json={"table": "users", "pk": {"id": uid}},
        )
        self.assertEqual(removed.status_code, 200, removed.text)
        created = self.client.post(
            "/admin/promos",
            headers=self._admin_headers(),
            json={"code": "SAVE20", "duration_days": 14},
        )
        self.assertEqual(created.status_code, 200, created.text)
        listed_promos = self.client.get("/admin/promos", headers=self._admin_headers())
        self.assertEqual(listed_promos.status_code, 200, listed_promos.text)
        self.assertTrue(any(row["code"] == "SAVE20" for row in listed_promos.json()["promos"]))
        toggled = self.client.post("/admin/promos/SAVE20/toggle", headers=self._admin_headers())
        self.assertEqual(toggled.status_code, 200, toggled.text)
        bad_promo = self.client.post(
            "/admin/promos",
            headers=self._admin_headers(),
            json={"code": "x"},
        )
        self.assertEqual(bad_promo.status_code, 422, bad_promo.text)
        email = "patch-me@e2e.test"
        self._register(email)
        user_id = self._uid(email)
        patched = self.client.patch(
            f"/admin/users/{user_id}",
            headers=self._admin_headers(),
            json={"stripe_customer_id": "cus_patch"},
        )
        self.assertEqual(patched.status_code, 200, patched.text)
        reset = self.client.post(
            f"/admin/users/{user_id}/reset-password",
            headers=self._admin_headers(),
        )
        self.assertEqual(reset.status_code, 200, reset.text)
        self.assertTrue(reset.json()["temporary_password"])
        configured = self.client.put(
            "/admin/config",
            headers=self._admin_headers(),
            json={"key": "banner", "value": "hello"},
        )
        self.assertEqual(configured.status_code, 200, configured.text)
        bad_config = self.client.put(
            "/admin/config",
            headers=self._admin_headers(),
            json={"key": "", "value": "x"},
        )
        self.assertEqual(bad_config.status_code, 422, bad_config.text)

    def test_admin_delete_cancels_stripe(self):
        """@F-ADMIN-DELETE delete_user cancels the subscription and deletes the customer."""
        email = "stripe-delete@e2e.test"
        self._register(email)
        user_id = self._uid(email)
        conn = db.get_db()
        conn.execute(
            "UPDATE users SET stripe_customer_id=? WHERE id=?",
            ("cus_delete", user_id),
        )
        conn.execute(
            "INSERT INTO subscriptions (user_id, service, status, stripe_sub_id) VALUES (?,?,?,?)",
            (user_id, "tiktok-seller-tool", "active", "sub_delete"),
        )
        conn.commit()
        conn.close()
        missing = self.client.post(
            f"/admin/users/{user_id}/delete",
            headers={"Fly-Client-IP": self._ip()},
        )
        self.assertEqual(missing.status_code, 401)
        with patch.object(marginmark_app.stripe, "api_key", "sk_test_x"), patch.object(
            marginmark_app.stripe.Subscription, "cancel"
        ) as cancel, patch.object(marginmark_app.stripe.Customer, "delete") as delete:
            response = self.client.post(
                f"/admin/users/{user_id}/delete",
                headers=self._admin_headers(),
            )
        self.assertEqual(response.status_code, 200, response.text)
        cancel.assert_called_once_with("sub_delete")
        delete.assert_called_once_with("cus_delete")
        unknown = self.client.post("/admin/users/999999/delete", headers=self._admin_headers())
        self.assertEqual(unknown.status_code, 404, unknown.text)

    def test_admin_production_ip_is_403(self):
        """@F-ADMIN-IP"""
        with patch.object(marginmark_app, "ENV", "production"), patch.object(
            marginmark_app, "ADMIN_IP_ALLOWLIST", {"203.0.113.9"}
        ):
            response = self.client.get(
                "/admin/overview",
                headers={"X-Admin-Key": marginmark_app.ADMIN_KEY, "Fly-Client-IP": "203.0.113.8"},
            )
        self.assertEqual(response.status_code, 403, response.text)

    def test_telemetry_scrubs_secrets(self):
        """@F-TELEM-SCRUB Stored payloads drop emails, URLs, and tokens."""
        denied = self.client.get("/admin/telemetry/events", headers={"Fly-Client-IP": self._ip()})
        self.assertEqual(denied.status_code, 401)
        posted = self.client.post(
            "/telemetry/event",
            headers={"Fly-Client-IP": self._ip()},
            json={
                "event": "overlay.shown",
                "properties": {
                    "email": "seller@e2e.test",
                    "page": "https://seller.example/secret",
                    "token": "sekret",
                    "note": "hello",
                },
            },
        )
        self.assertEqual(posted.status_code, 200, posted.text)
        bad = self.client.post(
            "/telemetry/event",
            headers={"Fly-Client-IP": self._ip()},
            json={"event": "not-a-real-event"},
        )
        self.assertEqual(bad.status_code, 400, bad.text)
        events = self.client.get("/admin/telemetry/events", headers=self._telemetry_headers())
        self.assertEqual(events.status_code, 200, events.text)
        props = events.json()["events"][0]["properties"]
        self.assertEqual(props.get("note"), "hello")
        self.assertNotIn("email", props)
        self.assertNotIn("page", props)
        self.assertNotIn("token", props)
        summary = self.client.get("/admin/telemetry/summary", headers=self._telemetry_headers())
        self.assertEqual(summary.status_code, 200, summary.text)
        bad_days = self.client.get(
            "/admin/telemetry/summary",
            headers=self._telemetry_headers(),
            params={"days": "nope"},
        )
        self.assertGreaterEqual(bad_days.status_code, 400)
        self.assertLess(bad_days.status_code, 500)
        err = self.client.post(
            "/telemetry/error",
            headers={"Fly-Client-IP": self._ip()},
            json={"extVersion": "1.4.0", "surface": "overlay", "errorCode": "scrape", "messageHash": "abc"},
        )
        self.assertEqual(err.status_code, 200, err.text)
        parse = self.client.post(
            "/telemetry/parse-failure",
            headers={"Fly-Client-IP": self._ip()},
            json={"surface": "edit", "field": "price", "selectorVersion": "1"},
        )
        self.assertEqual(parse.status_code, 200, parse.text)
        bad_parse = self.client.post(
            "/telemetry/parse-failure",
            headers={"Fly-Client-IP": self._ip()},
            json={"surface": "x" * 80, "field": "price", "selectorVersion": "1"},
        )
        self.assertEqual(bad_parse.status_code, 422, bad_parse.text)

    def test_v1_admin_override_and_disabled(self):
        """@F-ADMIN-V1"""
        os.environ["ADMIN_API_ENABLED"] = ""
        hidden = self.client.get(
            "/admin/v1/metrics/summary",
            headers={"Authorization": "Bearer " + ("a" * 32), "Fly-Client-IP": self._ip()},
        )
        self.assertEqual(hidden.status_code, 404, hidden.text)
        token = "v1" + ("a" * 32)
        os.environ["ADMIN_API_ENABLED"] = "1"
        os.environ["ADMIN_API_TOKEN"] = token
        os.environ["ADMIN_API_ALLOWLIST"] = "203.0.113.77"
        wrong = self.client.get(
            "/admin/v1/metrics/summary",
            headers={"Authorization": "Bearer nope", "Fly-Client-IP": "203.0.113.77"},
        )
        self.assertEqual(wrong.status_code, 401, wrong.text)
        denied_ip = self.client.get(
            "/admin/v1/metrics/summary",
            headers={"Authorization": f"Bearer {token}", "Fly-Client-IP": "203.0.113.78"},
        )
        self.assertEqual(denied_ip.status_code, 403, denied_ip.text)
        short = "short-token"
        os.environ["ADMIN_API_TOKEN"] = short
        short_bearer = self.client.get(
            "/admin/v1/metrics/summary",
            headers={"Authorization": f"Bearer {short}", "Fly-Client-IP": "203.0.113.77"},
        )
        self.assertEqual(short_bearer.status_code, 401, short_bearer.text)
        os.environ["ADMIN_API_TOKEN"] = token
        headers = {"Authorization": f"Bearer {token}", "Fly-Client-IP": "203.0.113.77"}
        summary = self.client.get("/admin/v1/metrics/summary", headers=headers)
        self.assertEqual(summary.status_code, 200, summary.text)
        email = "override@e2e.test"
        self._register(email)
        user_id = self._uid(email)
        granted = self.client.post(
            f"/admin/v1/users/{user_id}/tier-override",
            headers=headers,
            json={"tier": "pro", "expiresAt": "2099-01-01T00:00:00+00:00", "note": "qa"},
        )
        self.assertEqual(granted.status_code, 200, granted.text)
        bad_tier = self.client.post(
            f"/admin/v1/users/{user_id}/tier-override",
            headers=headers,
            json={"tier": "gold", "expiresAt": "2099-01-01", "note": "qa"},
        )
        self.assertEqual(bad_tier.status_code, 422, bad_tier.text)
        reset = self.client.post(
            f"/admin/v1/users/{user_id}/reset-usage",
            headers=headers,
            json={"counter": "ai", "note": "qa reset"},
        )
        self.assertEqual(reset.status_code, 200, reset.text)
        revoked = self.client.post(f"/admin/v1/users/{user_id}/token-revoke", headers=headers)
        self.assertEqual(revoked.status_code, 200, revoked.text)
        noted = self.client.post(
            f"/admin/v1/users/{user_id}/note",
            headers=headers,
            json={"note": "checked"},
        )
        self.assertEqual(noted.status_code, 200, noted.text)
        cleared = self.client.delete(f"/admin/v1/users/{user_id}/tier-override", headers=headers)
        self.assertEqual(cleared.status_code, 200, cleared.text)
        listed = self.client.get("/admin/v1/users", headers=headers, params={"email": email})
        self.assertEqual(listed.status_code, 200, listed.text)
        config = self.client.get("/admin/v1/config", headers=headers)
        self.assertEqual(config.status_code, 200, config.text)
        bad_doc = self.client.put("/admin/v1/config", headers=headers, json={"nope": True})
        self.assertGreaterEqual(bad_doc.status_code, 400)
        self.assertLess(bad_doc.status_code, 500)

    def test_oauth_start_callback_and_ticket(self):
        """@F-OAUTH-FLOW"""
        os.environ["GOOGLE_CLIENT_ID"] = "google-client"
        os.environ["GOOGLE_CLIENT_SECRET"] = "google-secret"
        start = self.client.get("/auth/oauth/google", follow_redirects=False)
        self.assertEqual(start.status_code, 302, start.text)
        location = start.headers["location"]
        self.assertIn("accounts.google.com", location)
        self.assertIn("code_challenge=", location)
        self.assertIn("code_challenge_method=S256", location)
        denied = self.client.get(
            "/auth/oauth/google/callback",
            params={"error": "access_denied"},
            follow_redirects=False,
        )
        self.assertEqual(denied.status_code, 302, denied.text)
        self.assertIn("/auth/oauth/done?error=denied", denied.headers["location"])
        unknown = self.client.get("/auth/oauth/nope", follow_redirects=False)
        self.assertEqual(unknown.status_code, 302)
        self.assertIn("error=invalid", unknown.headers["location"])
        state = location.split("state=")[1].split("&")[0]
        profile = oauth.OAuthProfile("google", "sub-e2e", "oauth-seller@e2e.test")
        with patch.object(oauth, "exchange_code_for_profile", new=AsyncMock(return_value=profile)):
            callback = self.client.get(
                "/auth/oauth/google/callback",
                params={"code": "auth-code", "state": state},
                follow_redirects=False,
            )
        self.assertEqual(callback.status_code, 302, callback.text)
        ticket = callback.headers["location"].split("ticket=")[1].split("&")[0]
        done = self.client.get("/auth/oauth/done", params={"ticket": ticket})
        self.assertEqual(done.status_code, 200, done.text)
        first = self.client.post("/auth/oauth/exchange", json={"ticket": ticket})
        self.assertEqual(first.status_code, 200, first.text)
        self.assertTrue(first.json()["access_token"])
        second = self.client.post("/auth/oauth/exchange", json={"ticket": ticket})
        self.assertEqual(second.status_code, 401, second.text)
        short = self.client.post("/auth/oauth/exchange", json={"ticket": "short"})
        self.assertEqual(short.status_code, 422, short.text)
        self.client.get("/ops")
        self.client.get("/static/oauth-done.js")
        self.client.get("/static/ops.js")
        remote = self.client.get("/config/remote")
        self.assertEqual(remote.status_code, 200, remote.text)
        trends = self.client.get("/public/trends")
        self.assertEqual(trends.status_code, 200, trends.text)

    def test_account_sign_out_and_delete(self):
        """@F-ACCT-SESSION"""
        email = "session@e2e.test"
        token = self._register(email)
        missing = self.client.post("/auth/sign-out-everywhere")
        self.assertIn(missing.status_code, (401, 403))
        signed = self.client.post("/auth/sign-out-everywhere", headers=self._auth(token))
        self.assertEqual(signed.status_code, 200, signed.text)
        me = self.client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(me.status_code, 401)
        email_b = "delete-me@e2e.test"
        token_b = self._register(email_b)
        bad = self.client.post(
            "/auth/delete-account",
            headers=self._auth(token_b),
            json={"confirm": "no", "password": "Valid-pass-1"},
        )
        self.assertEqual(bad.status_code, 400, bad.text)
        gone = self.client.post(
            "/auth/delete-account",
            headers=self._auth(token_b),
            json={"confirm": "DELETE", "password": "Valid-pass-1"},
        )
        self.assertEqual(gone.status_code, 200, gone.text)
        conn = db.get_db()
        row = conn.execute("SELECT id FROM users WHERE email=?", (email_b,)).fetchone()
        conn.close()
        self.assertIsNone(row)
        resend = self.client.post("/auth/verify-email/resend")
        self.assertIn(resend.status_code, (401, 403))

    def test_billing_portal_and_promo(self):
        """@F-BILL-PORTAL @F-BILL-PROMO"""
        email = "portal-gap@e2e.test"
        token = self._register(email)
        user_id = self._uid(email)
        conn = db.get_db()
        conn.execute("UPDATE users SET stripe_customer_id=? WHERE id=?", ("cus_portal", user_id))
        conn.commit()
        conn.close()
        missing = self.client.post("/billing/portal")
        self.assertIn(missing.status_code, (401, 403))
        with patch.object(marginmark_app, "STRIPE_SECRET_KEY", "sk_test_x"), patch.object(
            marginmark_app.stripe.billing_portal.Session,
            "create",
            return_value=SimpleNamespace(url="https://billing.example/portal"),
        ):
            portal = self.client.post("/billing/portal", headers=self._auth(token))
        self.assertEqual(portal.status_code, 200, portal.text)
        self.assertIn("portal", portal.json()["url"])
        created = self.client.post(
            "/admin/promos",
            headers=self._admin_headers(),
            json={"code": "PROMO1", "duration_days": 7},
        )
        self.assertEqual(created.status_code, 200, created.text)
        redeemed = self.client.post(
            "/billing/promo",
            headers=self._auth(token),
            json={"code": "PROMO1"},
        )
        self.assertEqual(redeemed.status_code, 200, redeemed.text)
        short = self.client.post(
            "/billing/promo",
            headers=self._auth(token),
            json={"code": "x"},
        )
        self.assertEqual(short.status_code, 422, short.text)

    def test_diamond_checkout_is_forbidden_while_the_flag_is_off(self):
        """@F-BILL-DIAMOND"""
        email = "diamond@e2e.test"
        token = self._register(email)
        conn = db.get_db()
        conn.execute("UPDATE users SET email_verified_at=? WHERE email=?", ("2026-01-01T00:00:00+00:00", email))
        conn.commit()
        conn.close()

        class _Customer:
            id = "cus_diamond"

        with patch.object(marginmark_app, "STRIPE_SECRET_KEY", "sk_test_x"), patch.object(
            marginmark_app.stripe.Customer, "create", return_value=_Customer()
        ), patch.object(
            marginmark_app.stripe.Subscription, "list", return_value=SimpleNamespace(data=[])
        ):
            response = self.client.post(
                "/billing/checkout",
                headers=self._auth(token),
                json={"plan": "diamond", "billing_interval": "monthly"},
            )
        self.assertEqual(response.status_code, 403, response.text)
        self.assertIn("Diamond is not available", response.json().get("detail") or response.json().get("error", ""))

    def test_review_summary_branches(self):
        """@F-INSIGHT-SUMMARY pending, ok, cached, and budget_exhausted."""
        email = "insight@e2e.test"
        token = self._register(email)
        user_id = self._uid(email)
        conn = db.get_db()
        conn.execute(
            """INSERT INTO subscriptions
               (user_id, service, status, tier_override, tier_override_expires_at)
               VALUES (?,?,?,?,?)""",
            (user_id, "tiktok-seller-tool", "free", "pro", "2099-01-01T00:00:00+00:00"),
        )
        conn.commit()
        conn.close()
        body = {
            "productId": "sku-insight",
            "reviewCount": 20,
            "rating": 4.5,
            "weekToken": WEEK_A,
            "reviews": [{"text": "Nice mug", "stars": 5}],
        }
        denied = self.client.post("/insights/review-summary", json=body)
        self.assertIn(denied.status_code, (401, 403))
        headers = self._auth(token)
        with patch("v1_routes._model_text", return_value=MODEL):
            pending = self.client.post("/insights/review-summary", headers=headers, json=body)
            self.assertEqual(pending.status_code, 200, pending.text)
            self.assertEqual(pending.json()["status"], "pending")
            body["weekToken"] = WEEK_B
            ok = self.client.post("/insights/review-summary", headers=headers, json=body)
            self.assertEqual(ok.status_code, 200, ok.text)
            self.assertEqual(ok.json()["status"], "ok")
            cached = self.client.post("/insights/review-summary", headers=headers, json=body)
            self.assertEqual(cached.status_code, 200, cached.text)
            self.assertTrue(cached.json().get("cached"))
        with patch("v1_routes._spent_today", return_value=999.0):
            exhausted = self.client.post(
                "/insights/review-summary",
                headers=headers,
                json={
                    "productId": "sku-budget",
                    "reviewCount": 10,
                    "rating": 4.0,
                    "weekToken": WEEK_A,
                    "reviews": [{"text": "Ok", "stars": 4}],
                },
            )
        self.assertEqual(exhausted.status_code, 200, exhausted.text)
        self.assertEqual(exhausted.json()["status"], "budget_exhausted")
        invalid = self.client.post(
            "/insights/review-summary",
            headers=headers,
            json={"productId": "bad id", "reviewCount": 1, "rating": 1, "weekToken": WEEK_A, "reviews": []},
        )
        self.assertEqual(invalid.status_code, 422, invalid.text)
