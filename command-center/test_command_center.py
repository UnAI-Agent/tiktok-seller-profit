import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient

from app import create_app


class AccessTests(unittest.TestCase):
    def test_missing_cloudflare_jwt_is_rejected(self):
        app = create_app()
        client = TestClient(app)
        with patch.dict(
            os.environ,
            {"CF_ACCESS_AUD": "marginmark", "ENV": "production", "ADMIN_IP_ALLOWLIST": ""},
            clear=False,
        ):
            response = client.get("/api/products")
        self.assertEqual(response.status_code, 401)

    def test_write_requires_webauthn(self):
        app = create_app()
        client = TestClient(app)
        with patch.dict(
            os.environ,
            {
                "WEBAUTHN_TEST_ASSERTION": "assertion-ok",
                "ENV": "development",
                "CF_ACCESS_AUD": "",
                "ADMIN_IP_ALLOWLIST": "",
            },
            clear=False,
        ):
            denied = client.post("/api/audit", json={"action": "flag", "before": None, "after": {"on": True}})
            allowed = client.post(
                "/api/audit",
                headers={"X-WebAuthn-Assertion": "assertion-ok"},
                json={"action": "flag", "before": {"on": False}, "after": {"on": True}},
            )
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(allowed.status_code, 200)
        listed = client.get("/api/audit")
        self.assertEqual(listed.json()["rows"][0]["action"], "flag")
        self.assertNotIn("delete", "".join(route.path for route in app.routes).lower() or "audit")
