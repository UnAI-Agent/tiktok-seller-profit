import unittest

from billing_env import assert_database_isolation, assert_stripe_keys_match_env, checkout_extra


class StripeEnvTests(unittest.TestCase):
    def test_lle_rejects_live(self):
        with self.assertRaises(RuntimeError):
            assert_stripe_keys_match_env("lle", "sk_live_abc")

    def test_prod_rejects_test(self):
        with self.assertRaises(RuntimeError):
            assert_stripe_keys_match_env("prod", "sk_test_abc")

    def test_lle_allows_test(self):
        assert_stripe_keys_match_env("lle", "sk_test_abc")

    def test_unset_ok(self):
        assert_stripe_keys_match_env("lle", "")
        assert_stripe_keys_match_env("local", "sk_test_abc")

    def test_lle_without_database_refuses(self):
        with self.assertRaises(RuntimeError):
            assert_database_isolation("lle", "")
        with self.assertRaises(RuntimeError):
            assert_database_isolation("prod", "")

    def test_expected_host_must_match(self):
        url = "postgresql://user:secret@ep-dev-pooler.neon.tech/db"
        assert_database_isolation("lle", url, "ep-dev-pooler.neon.tech")
        with self.assertRaises(RuntimeError):
            assert_database_isolation("lle", url, "ep-prod-pooler.neon.tech")

    def test_local_refuses_lle_or_prod_host(self):
        url = "postgresql://user:secret@ep-lle-pooler.neon.tech/db"
        with self.assertRaises(RuntimeError):
            assert_database_isolation("local", url, "", "ep-lle-pooler.neon.tech", "")
        assert_database_isolation("local", url, "", "", "")

    def test_trial_is_tiktok_only(self):
        self.assertEqual(
            checkout_extra("tiktok-seller-tool"),
            {
                "subscription_data": {
                    "trial_period_days": 7,
                    "metadata": {"service": "tiktok-seller-tool"},
                }
            },
        )
        self.assertEqual(checkout_extra("shop-reply"), {})


if __name__ == "__main__":
    unittest.main()
