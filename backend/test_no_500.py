"""Every route must answer below 500 for empty, garbage, and bad query input."""

import os
import unittest

os.environ.setdefault("ENV", "development")
os.environ.setdefault("APP_ENV", "local")

import marginmark_app
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from test_launch_v2 import LaunchDb


def _concrete(path: str) -> str:
    return (
        path.replace("{user_id}", "1")
        .replace("{code}", "NOTREAL")
        .replace("{provider}", "google")
    )


class No500Tests(unittest.TestCase):
    """Unhandled exceptions must not become Internal server error."""

    def setUp(self):
        self.db = LaunchDb()
        self.client = TestClient(marginmark_app.app)

    def tearDown(self):
        self.client.close()
        self.db.close()

    def test_empty_garbage_and_bad_query_stay_under_500(self):
        """@F-ROUTE-500"""
        failures = []
        for route in marginmark_app.app.routes:
            if not isinstance(route, APIRoute):
                continue
            path = _concrete(route.path)
            for method in sorted(route.methods or []):
                if method in ("HEAD", "OPTIONS"):
                    continue
                cases = (
                    ("empty", {}),
                    ("garbage", {"content": b"{", "headers": {"content-type": "application/json"}}),
                    ("bad-query", {"params": {"limit": "nope", "user_id": "nope", "ok": "nope"}}),
                )
                for name, kwargs in cases:
                    headers = {"Fly-Client-IP": "198.51.100.50"}
                    extra = dict(kwargs)
                    headers.update(extra.pop("headers", {}))
                    response = self.client.request(method, path, headers=headers, **extra)
                    if response.status_code >= 500:
                        failures.append(f"{method} {route.path} {name} -> {response.status_code} {response.text[:180]}")
        self.assertEqual(failures, [])
