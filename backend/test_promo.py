import unittest
from datetime import datetime, timedelta, timezone

from promo import (
    CODE_RE,
    effective_sub_status,
    normalize_code,
    promo_expires_iso,
)


class PromoTests(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual(normalize_code("  launch-30 "), "LAUNCH-30")
        self.assertTrue(CODE_RE.match("FREE30"))
        self.assertFalse(CODE_RE.match("ab"))

    def test_stripe_active_ignores_expired_promo(self):
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        row = {
            "status": "active",
            "stripe_sub_id": "sub_123",
            "promo_expires_at": past,
        }
        self.assertEqual(effective_sub_status(row), "active")

    def test_promo_expires(self):
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        row = {"status": "active", "stripe_sub_id": None, "promo_expires_at": past}
        self.assertEqual(effective_sub_status(row), "free")

    def test_promo_valid(self):
        future = promo_expires_iso(30)
        row = {"status": "active", "stripe_sub_id": None, "promo_expires_at": future}
        self.assertEqual(effective_sub_status(row), "active")

    def test_manual_grant_without_stripe_or_promo_is_active(self):
        # Ops console "active (Pro)" writes this row. It must read as Pro, or the
        # database and the extension disagree (owner-reported bug, v1.4).
        row = {"status": "active", "stripe_sub_id": None, "promo_expires_at": None}
        self.assertEqual(effective_sub_status(row), "active")

    def test_free_row_stays_free(self):
        row = {"status": "free", "stripe_sub_id": None, "promo_expires_at": None}
        self.assertEqual(effective_sub_status(row), "free")


if __name__ == "__main__":
    unittest.main()
