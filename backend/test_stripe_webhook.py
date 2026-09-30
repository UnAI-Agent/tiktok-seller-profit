"""Signed /billing/webhook posts against a local SQLite database.

Payloads follow Stripe API 2026-08-26.dahlia: invoice subscription id is
parent.subscription_details.subscription, and current_period_end is on the
subscription item when it is missing on the subscription object.
"""

import hashlib
import hmac
import json
import os
import time
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

os.environ.setdefault("ENV", "development")
os.environ.setdefault("APP_ENV", "local")

import db
import marginmark_app
from fastapi.testclient import TestClient
from security.passwords import hash_password
from test_launch_v2 import LaunchDb

SECRET = "whsec_test_secret"
SUB = "sub_1UL6fDE3nD3vI53424hIg2zG"
PERIOD_END = 1791244800


def _sign(payload: bytes) -> str:
    timestamp = int(time.time())
    signed = f"{timestamp}.{payload.decode('utf-8')}"
    digest = hmac.new(SECRET.encode("utf-8"), signed.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


def _event(event_id: str, event_type: str, obj: dict, created: int) -> dict:
    return {
        "id": event_id,
        "object": "event",
        "api_version": "2026-08-26.dahlia",
        "created": created,
        "type": event_type,
        "livemode": False,
        "data": {"object": obj},
    }


def _subscription(status: str, *, period_on_item: bool = False, cancel_at_period_end: bool = False) -> dict:
    item = {
        "price": {
            "id": "price_pro_month",
            "unit_amount": 1499,
            "recurring": {"interval": "month"},
        }
    }
    body = {
        "id": SUB,
        "object": "subscription",
        "status": status,
        "cancel_at_period_end": cancel_at_period_end,
        "items": {"object": "list", "data": [item]},
    }
    if period_on_item:
        item["current_period_end"] = PERIOD_END
    else:
        body["current_period_end"] = PERIOD_END
    return body


class StripeWebhookTests(unittest.TestCase):
    def setUp(self):
        self.db = LaunchDb()
        self.client = TestClient(marginmark_app.app)
        self.secret = patch.object(marginmark_app, "STRIPE_WEBHOOK_SECRET", SECRET)
        self.secret.start()
        conn = db.get_db()
        conn.execute(
            "INSERT INTO users (email, password_hash) VALUES (?,?)",
            ("test2@gmail.com", hash_password("Valid-pass-1")),
        )
        self.uid = int(conn.execute("SELECT id FROM users WHERE email=?", ("test2@gmail.com",)).fetchone()["id"])
        conn.commit()
        conn.close()

    def tearDown(self):
        self.secret.stop()
        self.client.close()
        self.db.close()

    def _post(self, body: dict):
        raw = json.dumps(body).encode("utf-8")
        return self.client.post(
            "/billing/webhook",
            content=raw,
            headers={"stripe-signature": _sign(raw)},
        )

    def _row(self):
        conn = db.get_db()
        row = conn.execute(
            "SELECT status, tier, stripe_sub_id, stripe_status, current_period_end FROM subscriptions WHERE user_id=?",
            (self.uid,),
        ).fetchone()
        conn.close()
        return dict(row) if row else None

    def _checkout(self):
        response = self._post(
            _event(
                "evt_checkout",
                "checkout.session.completed",
                {
                    "id": "cs_test",
                    "object": "checkout.session",
                    "client_reference_id": str(self.uid),
                    "subscription": SUB,
                    "metadata": {"user_id": str(self.uid), "tier": "pro"},
                },
                100,
            )
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self._row()["status"], "active")

    def test_a_checkout_then_deleted_ends_free(self):
        self._checkout()
        response = self._post(
            _event("evt_deleted", "customer.subscription.deleted", _subscription("canceled"), 300)
        )
        self.assertEqual(response.status_code, 200, response.text)
        row = self._row()
        self.assertIsNotNone(row)
        self.assertEqual(row["status"], "free")
        self.assertEqual(row["stripe_sub_id"], SUB)
        self.assertEqual(row["stripe_status"], "canceled")
        conn = db.get_db()
        used = conn.execute("SELECT trial_used FROM users WHERE id=?", (self.uid,)).fetchone()["trial_used"]
        conn.close()
        self.assertEqual(int(used), 1)

    def test_b_updated_canceled_ends_free(self):
        self._checkout()
        response = self._post(
            _event("evt_canceled", "customer.subscription.updated", _subscription("canceled"), 300)
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self._row()["status"], "free")
        self.assertEqual(self._row()["stripe_status"], "canceled")

    def test_c_trialing_cancel_at_period_end_stays_active(self):
        self._checkout()
        response = self._post(
            _event(
                "evt_trial_end",
                "customer.subscription.updated",
                _subscription("trialing", cancel_at_period_end=True),
                200,
            )
        )
        self.assertEqual(response.status_code, 200, response.text)
        row = self._row()
        self.assertEqual(row["status"], "active")
        self.assertEqual(row["stripe_status"], "trialing")

    def test_d_late_invoice_and_updated_do_not_revive(self):
        self._checkout()
        deleted = self._post(
            _event("evt_deleted", "customer.subscription.deleted", _subscription("canceled"), 300)
        )
        self.assertEqual(deleted.status_code, 200, deleted.text)
        invoice = {
            "id": "in_late",
            "object": "invoice",
            "parent": {"type": "subscription_details", "subscription_details": {"subscription": SUB}},
        }
        paid = self._post(_event("evt_paid_late", "invoice.paid", invoice, 150))
        self.assertEqual(paid.status_code, 200, paid.text)
        self.assertEqual(self._row()["status"], "free")
        updated = self._post(
            _event(
                "evt_old_trial",
                "customer.subscription.updated",
                _subscription("trialing", cancel_at_period_end=True),
                120,
            )
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        failed = self._post(_event("evt_fail_late", "invoice.payment_failed", invoice, 160))
        self.assertEqual(failed.status_code, 200, failed.text)
        self.assertEqual(self._row()["status"], "free")
        self.assertEqual(self._row()["stripe_status"], "canceled")

    def test_d_retrieve_canceled_beats_invoice_paid(self):
        self._checkout()
        live = marginmark_app.stripe.Subscription.construct_from(
            _subscription("canceled", period_on_item=True), "sk_test_x"
        )
        invoice = {
            "id": "in_live",
            "object": "invoice",
            "parent": {"subscription_details": {"subscription": SUB}},
        }
        with patch.object(marginmark_app, "STRIPE_SECRET_KEY", "sk_test_x"), patch.object(
            marginmark_app.stripe.Subscription, "retrieve", return_value=live
        ) as retrieve:
            response = self._post(_event("evt_paid", "invoice.paid", invoice, 400))
        self.assertEqual(response.status_code, 200, response.text)
        retrieve.assert_called_once_with(SUB)
        self.assertEqual(self._row()["status"], "free")
        self.assertEqual(self._row()["stripe_status"], "canceled")

    def test_e_duplicate_event_id_is_ignored(self):
        self._checkout()
        body = _event("evt_same", "customer.subscription.deleted", _subscription("canceled"), 300)
        first = self._post(body)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(self._row()["status"], "free")
        second = self._post(body)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertTrue(second.json().get("duplicate"))
        self.assertEqual(self._row()["status"], "free")

    def test_period_end_is_read_from_subscription_item(self):
        self._checkout()
        response = self._post(
            _event(
                "evt_period",
                "customer.subscription.updated",
                _subscription("trialing", period_on_item=True, cancel_at_period_end=True),
                200,
            )
        )
        self.assertEqual(response.status_code, 200, response.text)
        expected = datetime.fromtimestamp(PERIOD_END, timezone.utc).isoformat()
        self.assertEqual(self._row()["current_period_end"], expected)
        self.assertEqual(self._row()["status"], "active")

    def test_dahlia_invoice_paid_finds_parent_subscription(self):
        self._checkout()
        conn = db.get_db()
        conn.execute(
            "UPDATE subscriptions SET status='past_due', past_due_since=? WHERE stripe_sub_id=?",
            ("2020-01-01T00:00:00+00:00", SUB),
        )
        conn.commit()
        conn.close()
        invoice = {
            "id": "in_parent",
            "object": "invoice",
            "parent": {"subscription_details": {"subscription": SUB}},
        }
        response = self._post(_event("evt_parent_paid", "invoice.paid", invoice, 200))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self._row()["status"], "active")

    def test_deleted_for_unknown_subscription_warns(self):
        with self.assertLogs("marginmark_app", level="WARNING") as logs:
            response = self._post(
                _event("evt_missing", "customer.subscription.deleted", _subscription("canceled"), 300)
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(any("matched zero rows" in line for line in logs.output))
        self.assertIsNone(self._row())

    def test_admin_compare_flags_canceled_stripe_subscription(self):
        self._checkout()
        live = marginmark_app.stripe.Subscription.construct_from(
            _subscription("canceled"), "sk_test_x"
        )
        with patch.object(marginmark_app, "ADMIN_KEY", "k" * 16), patch.object(
            marginmark_app, "STRIPE_SECRET_KEY", "sk_test_x"
        ), patch.object(marginmark_app.stripe.Subscription, "retrieve", return_value=live):
            response = self.client.get(
                "/admin/billing/stripe",
                params={"user_id": self.uid},
                headers={"x-admin-key": "k" * 16},
            )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["local"]["status"], "active")
        self.assertEqual(body["stripe_status"], "canceled")
        self.assertTrue(body["mismatch"])
        self.assertNotIn("email", body)

    def _me(self):
        token = marginmark_app.make_token(self.uid)
        response = self.client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_resubscribe_clears_stale_canceled_columns(self):
        """@F-BILL-RESUB A new subscription must not keep stripe_status=canceled from the old one."""
        sub_b = "sub_resub_B"
        self._checkout()
        deleted = self._post(
            _event("evt_resub_deleted", "customer.subscription.deleted", _subscription("canceled"), 300)
        )
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertEqual(self._row()["stripe_status"], "canceled")
        checkout_b = self._post(
            _event(
                "evt_resub_checkout",
                "checkout.session.completed",
                {
                    "id": "cs_resub",
                    "object": "checkout.session",
                    "client_reference_id": str(self.uid),
                    "subscription": sub_b,
                    "metadata": {"user_id": str(self.uid), "tier": "pro"},
                },
                400,
            )
        )
        self.assertEqual(checkout_b.status_code, 200, checkout_b.text)
        invoice = {
            "id": "in_resub",
            "object": "invoice",
            "parent": {"subscription_details": {"subscription": sub_b}},
        }
        with patch.object(marginmark_app, "STRIPE_SECRET_KEY", "sk_test_x"), patch.object(
            marginmark_app.stripe.Subscription,
            "retrieve",
            side_effect=marginmark_app.stripe.error.StripeError("retrieve down"),
        ):
            paid = self._post(_event("evt_resub_paid", "invoice.paid", invoice, 500))
        self.assertEqual(paid.status_code, 200, paid.text)
        row = self._row()
        self.assertEqual(row["stripe_sub_id"], sub_b)
        self.assertEqual(row["status"], "active")
        self.assertNotEqual(row["stripe_status"], "canceled")
        me = self._me()
        self.assertNotEqual(me["plan_status"], "canceled")
        self.assertTrue(me["is_pro"])

    def test_late_checkout_skips_canceled_and_incomplete_expired(self):
        """@F-BILL-LATECS checkout.session.completed must not revive a dead Stripe subscription."""
        self._checkout()
        deleted = self._post(
            _event("evt_latecs_deleted", "customer.subscription.deleted", _subscription("canceled"), 300)
        )
        self.assertEqual(deleted.status_code, 200, deleted.text)
        canceled = marginmark_app.stripe.Subscription.construct_from(
            _subscription("canceled"), "sk_test_x"
        )
        with patch.object(marginmark_app, "STRIPE_SECRET_KEY", "sk_test_x"), patch.object(
            marginmark_app.stripe.Subscription, "retrieve", return_value=canceled
        ):
            late = self._post(
                _event(
                    "evt_late_checkout",
                    "checkout.session.completed",
                    {
                        "id": "cs_late",
                        "object": "checkout.session",
                        "client_reference_id": str(self.uid),
                        "subscription": SUB,
                        "metadata": {"user_id": str(self.uid), "tier": "pro"},
                    },
                    500,
                )
            )
        self.assertEqual(late.status_code, 200, late.text)
        self.assertEqual(self._row()["status"], "free")
        self.assertEqual(self._row()["stripe_status"], "canceled")

        expired = marginmark_app.stripe.Subscription.construct_from(
            _subscription("incomplete_expired"), "sk_test_x"
        )
        with patch.object(marginmark_app, "STRIPE_SECRET_KEY", "sk_test_x"), patch.object(
            marginmark_app.stripe.Subscription, "retrieve", return_value=expired
        ):
            again = self._post(
                _event(
                    "evt_late_checkout_expired",
                    "checkout.session.completed",
                    {
                        "id": "cs_late_expired",
                        "object": "checkout.session",
                        "client_reference_id": str(self.uid),
                        "subscription": SUB,
                        "metadata": {"user_id": str(self.uid), "tier": "pro"},
                    },
                    600,
                )
            )
        self.assertEqual(again.status_code, 200, again.text)
        self.assertEqual(self._row()["status"], "free")

    def test_retrieve_subscription_converts_non_dict_stripe_object(self):
        """@F-BILL-RETRIEVE Live lookup must not depend on StripeObject subclassing dict."""

        class Remote:
            def to_dict_recursive(self):
                return _subscription("active", period_on_item=True)

        self.assertNotIsInstance(Remote(), dict)
        with patch.object(marginmark_app, "STRIPE_SECRET_KEY", "sk_test_x"), patch.object(
            marginmark_app.stripe.Subscription, "retrieve", return_value=Remote()
        ):
            live = marginmark_app._retrieve_subscription(SUB)
        self.assertIsNotNone(live)
        self.assertEqual(live["status"], "active")
        self.assertEqual(live["id"], SUB)

    def test_lifecycle_me_follows_every_step(self):
        """@F-BILL-LIFE checkout, trial, paid, past_due grace, day 4 free, paid again, deleted."""
        from datetime import timedelta

        real = marginmark_app.datetime

        class Clock(real):
            offset = timedelta(0)

            @classmethod
            def now(cls, tz=None):
                return real.now(tz or timezone.utc) + cls.offset

        def me_is_pro():
            return self._me()["is_pro"]

        with patch.object(marginmark_app, "datetime", Clock):
            self._checkout()
            self.assertTrue(me_is_pro())
            trial = self._post(
                _event("evt_life_trial", "customer.subscription.updated", _subscription("trialing"), 110)
            )
            self.assertEqual(trial.status_code, 200, trial.text)
            self.assertEqual(self._me()["plan_status"], "trialing")
            self.assertTrue(me_is_pro())
            invoice = {
                "id": "in_life",
                "object": "invoice",
                "parent": {"subscription_details": {"subscription": SUB}},
            }
            paid = self._post(_event("evt_life_paid", "invoice.paid", invoice, 120))
            self.assertEqual(paid.status_code, 200, paid.text)
            self.assertTrue(me_is_pro())
            active = self._post(
                _event("evt_life_active", "customer.subscription.updated", _subscription("active"), 130)
            )
            self.assertEqual(active.status_code, 200, active.text)
            self.assertEqual(self._me()["plan_status"], "active")
            failed = self._post(_event("evt_life_fail", "invoice.payment_failed", invoice, 140))
            self.assertEqual(failed.status_code, 200, failed.text)
            self.assertTrue(me_is_pro())
            Clock.offset = timedelta(days=4)
            self.assertFalse(me_is_pro())
            Clock.offset = timedelta(0)
            recovered = self._post(_event("evt_life_recovered", "invoice.paid", {**invoice, "id": "in_life_2"}, 150))
            self.assertEqual(recovered.status_code, 200, recovered.text)
            self.assertTrue(me_is_pro())
            deleted = self._post(
                _event("evt_life_deleted", "customer.subscription.deleted", _subscription("canceled"), 160)
            )
            self.assertEqual(deleted.status_code, 200, deleted.text)
            self.assertFalse(me_is_pro())
            late = self._post(_event("evt_life_late", "invoice.paid", {**invoice, "id": "in_life_late"}, 170))
            self.assertEqual(late.status_code, 200, late.text)
            self.assertFalse(me_is_pro())

    def test_diamond_price_keeps_diamond(self):
        """@F-BILL-DIAMOND-PRICE A Diamond price does not fall back to Pro."""
        os.environ["STRIPE_PRICE_DIAMOND_MONTHLY"] = "price_diamond_month"
        self.addCleanup(lambda: os.environ.pop("STRIPE_PRICE_DIAMOND_MONTHLY", None))
        response = self._post(
            _event(
                "evt_diamond_checkout",
                "checkout.session.completed",
                {
                    "id": "cs_diamond",
                    "object": "checkout.session",
                    "client_reference_id": str(self.uid),
                    "subscription": SUB,
                    "metadata": {
                        "user_id": str(self.uid),
                        "tier": "diamond",
                        "price_id": "price_diamond_month",
                    },
                },
                100,
            )
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = _subscription("active")
        body["items"]["data"][0]["price"]["id"] = "price_diamond_month"
        updated = self._post(_event("evt_diamond_updated", "customer.subscription.updated", body, 110))
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(self._row()["tier"], "diamond")
        self.assertEqual(self._me()["tier"], "diamond")
