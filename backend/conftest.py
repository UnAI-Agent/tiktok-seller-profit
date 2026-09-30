"""Route recorder and a local-only environment.

load_dotenv() does not override variables that are already set, so these
assignments run before the app is imported. Pytest must not touch Neon,
Stripe, or a real mailbox.
"""

from __future__ import annotations

import json
import os
import secrets
from collections import Counter
from pathlib import Path

os.environ["ENV"] = "development"
os.environ["APP_ENV"] = "local"
os.environ["DATABASE_URL"] = ""
os.environ["DATABASE_URL_UNPOOLED"] = ""
os.environ["STRIPE_SECRET_KEY"] = ""
os.environ["STRIPE_WEBHOOK_SECRET"] = "whsec_e2e_" + secrets.token_hex(8)
os.environ["SMTP_HOST"] = "127.0.0.1"
os.environ["SMTP_PORT"] = "1025"
os.environ["SMTP_USER"] = ""
os.environ["SMTP_PASSWORD"] = ""
os.environ["SMTP_FROM"] = "noreply@e2e.test"
os.environ["SUPPORT_INBOX"] = "support@e2e.test"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] = ""
os.environ["JWT_SECRET"] = secrets.token_hex(32)
os.environ["ADMIN_KEY"] = secrets.token_hex(32)
os.environ["TELEMETRY_READ_KEY"] = secrets.token_hex(32)
for _name in (
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "FACEBOOK_APP_ID",
    "FACEBOOK_APP_SECRET",
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_SECRET",
    "STRIPE_PRICE_PRO_MONTHLY",
    "STRIPE_PRICE_PRO_YEARLY",
    "STRIPE_PRICE_DIAMOND_MONTHLY",
    "STRIPE_PRICE_DIAMOND_YEARLY",
    "STRIPE_PRICE_TIKTOK_SELLER",
    "STRIPE_PRICE_TIKTOK_SELLER_YEARLY",
):
    os.environ[_name] = ""

import starlette.routing

_HITS: Counter[tuple[str, str]] = Counter()
_ORIGINAL_HANDLE = starlette.routing.Route.handle


async def _recording_handle(self, scope, receive, send):
    method = scope.get("method") or ""
    _HITS[(method, self.path)] += 1
    return await _ORIGINAL_HANDLE(self, scope, receive, send)


starlette.routing.Route.handle = _recording_handle


def _api_routes():
    from fastapi.routing import APIRoute
    import marginmark_app

    found = []

    def walk(routes):
        for route in routes:
            if isinstance(route, APIRoute):
                found.append(route)
            nested = getattr(route, "routes", None)
            if nested:
                walk(nested)

    walk(marginmark_app.app.routes)
    return found


def pytest_sessionfinish(session, exitstatus):
    routes = []
    try:
        routes = _api_routes()
    except Exception as exc:
        print(f"route recorder could not list routes: {exc}")
        session.exitstatus = 1
        return
    missing = []
    report = {}
    for route in routes:
        for method in sorted(route.methods or []):
            if method in ("HEAD", "OPTIONS"):
                continue
            key = f"{method} {route.path}"
            count = int(_HITS[(method, route.path)])
            report[key] = count
            if count == 0:
                missing.append(key)
    out = Path(__file__).resolve().parent / ".route-coverage.json"
    out.write_text(json.dumps({"hits": report, "missing": missing}, indent=2), encoding="utf-8")
    if missing:
        print("UNTESTED ROUTES:")
        for item in missing:
            print(f"  {item}")
        if session.exitstatus == 0:
            session.exitstatus = 1
