"""Stripe key vs APP_ENV — LLE never charges real cards; prod never uses test keys."""

from __future__ import annotations

from urllib.parse import urlparse


def database_host(database_url: str) -> str:
    return (urlparse(database_url or "").hostname or "").lower()


def assert_database_isolation(
    app_env: str,
    database_url: str,
    expected_host: str = "",
    expected_lle_host: str = "",
    expected_prod_host: str = "",
) -> None:
    """Refuse to boot when an environment points at the wrong database."""
    env = (app_env or "local").lower()
    url = (database_url or "").strip()
    host = database_host(url)
    if env in ("lle", "prod") and not url:
        raise RuntimeError(f"APP_ENV={env} refuses to start without DATABASE_URL")
    expected = (expected_host or "").strip().lower()
    if expected and host != expected:
        raise RuntimeError("DATABASE_URL host does not match EXPECTED_DB_HOST")
    blocked = {
        item.strip().lower()
        for item in (expected_lle_host, expected_prod_host)
        if item and item.strip()
    }
    if env == "local" and host and host in blocked:
        raise RuntimeError("APP_ENV=local refuses the LLE or prod database host")


def assert_stripe_keys_match_env(app_env: str, secret: str | None) -> None:
    env = (app_env or "local").lower()
    key = (secret or "").strip()
    if not key:
        return
    if env == "lle" and key.startswith("sk_live"):
        raise RuntimeError("APP_ENV=lle forbids Stripe live keys — use sk_test_")
    if env == "prod" and key.startswith("sk_test"):
        raise RuntimeError("APP_ENV=prod forbids Stripe test keys — use sk_live_")


TIKTOK_SERVICE = "tiktok-seller-tool"


def trial_allowed(trial_used: int, prior_subscriptions: int) -> bool:
    return trial_used == 0 and prior_subscriptions == 0


def checkout_extra(service: str, *, trial_allowed: bool = True) -> dict:
    """7-day trial once per user and Stripe customer. Other services stay unchanged."""
    if service == TIKTOK_SERVICE and trial_allowed:
        return {
            "subscription_data": {
                "trial_period_days": 7,
                "metadata": {"service": TIKTOK_SERVICE},
            }
        }
    return {}


def price_amount_matches(unit_amount: int, interval: str, usd: float, expected_interval: str) -> bool:
    return int(unit_amount) == int(round(usd * 100)) and interval == expected_interval
