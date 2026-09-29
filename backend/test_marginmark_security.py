import ast
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("ENV", "development")

import marginmark_app
from db import DbConnection
from fastapi.testclient import TestClient


class TempDb:
    def __init__(self):
        handle = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.path = handle.name
        handle.close()
        db = self.connect()
        db.execute(
            """CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                email TEXT,
                password_hash TEXT,
                token_version INTEGER NOT NULL DEFAULT 0
            )"""
        )
        db.execute(
            """CREATE TABLE stripe_events (
                event_id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL
            )"""
        )
        db.execute(
            "INSERT INTO users (id,email,password_hash,token_version) VALUES (1,?,?,0)",
            ("seller@example.com", "unused"),
        )
        db.commit()
        db.close()

    def connect(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return DbConnection(conn, is_postgres=False)

    def close(self):
        os.unlink(self.path)


class TokenTests(unittest.TestCase):
    def setUp(self):
        self.db = TempDb()
        self.get_db = patch.object(marginmark_app, "get_db", self.db.connect)
        self.get_db.start()
        self.secret = patch.object(marginmark_app, "JWT_SECRET", "x" * 64)
        self.secret.start()

    def tearDown(self):
        self.secret.stop()
        self.get_db.stop()
        self.db.close()

    def test_tamper_expiry_and_version_revoke(self):
        now = int(time.time())
        token = marginmark_app.make_token(1, now=now)
        self.assertEqual(marginmark_app.verify_token(token, now=now), 1)
        self.assertIsNone(marginmark_app.verify_token(token + "x", now=now))
        self.assertIsNone(
            marginmark_app.verify_token(
                marginmark_app.make_token(
                    1,
                    now=now - marginmark_app.TOKEN_TTL_SECONDS - 1,
                ),
                now=now,
            )
        )
        db = self.db.connect()
        db.execute("UPDATE users SET token_version=token_version+1 WHERE id=1")
        db.commit()
        db.close()
        self.assertIsNone(marginmark_app.verify_token(token, now=now))

    def test_stripe_event_is_idempotent(self):
        self.assertTrue(marginmark_app._mark_event("evt_1", "invoice.paid"))
        self.assertFalse(marginmark_app._mark_event("evt_1", "invoice.paid"))


class SqlConstructionTests(unittest.TestCase):
    def test_execute_f_strings_only_build_identifiers_or_fixed_fragments(self):
        backend = Path(__file__).parent
        checked = [
            backend / "marginmark_app.py",
            backend / "db.py",
            backend / "admin_db.py",
            backend / "oauth.py",
            backend / "promo.py",
        ]
        violations = []
        for path in checked:
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                    continue
                if node.func.attr != "execute" or not node.args:
                    continue
                sql = node.args[0]
                if not isinstance(sql, ast.JoinedStr):
                    continue
                source = ast.get_source_segment(path.read_text(encoding="utf-8"), sql) or ""
                allowed_markers = (
                    "quote_ident",
                    "qtable",
                    "where",
                    "order",
                    "sets",
                    "clause",
                    "window",
                    '"{table}"',
                    '"{column}"',
                    "{spec}",
                )
                if not any(marker in source for marker in allowed_markers):
                    violations.append(f"{path.name}:{node.lineno}")
        self.assertEqual(violations, [])


class HttpHardeningTests(unittest.TestCase):
    def test_foreign_extension_origin_gets_no_cors_access(self):
        with TestClient(marginmark_app.app) as client:
            response = client.get(
                "/health",
                headers={"Origin": "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
            )
        self.assertNotIn("access-control-allow-origin", response.headers)

    def test_health_reports_commit_and_no_secrets(self):
        previous = os.environ.get("GIT_SHA")
        os.environ["GIT_SHA"] = "abc1234"
        try:
            with TestClient(marginmark_app.app) as client:
                body = client.get("/health").json()
        finally:
            if previous is None:
                os.environ.pop("GIT_SHA", None)
            else:
                os.environ["GIT_SHA"] = previous
        self.assertEqual(body["commit"], "abc1234")
        self.assertIn("app_env", body)
        for key in ("jwt_secret", "database_url", "stripe_secret", "admin_key"):
            self.assertNotIn(key, body)
        blob = str(body).lower()
        self.assertNotIn("sk_live", blob)
        self.assertNotIn("sk_test", blob)
        self.assertNotIn("postgres://", blob)
        self.assertNotIn("postgresql://", blob)

    def test_login_limit_uses_fly_client_ip_and_email(self):
        with TestClient(marginmark_app.app) as client:
            for _ in range(10):
                response = client.post(
                    "/auth/login",
                    headers={"Fly-Client-IP": "198.51.100.8"},
                    json={"email": "missing@example.com", "password": "wrong"},
                )
                self.assertEqual(response.status_code, 401)
            limited = client.post(
                "/auth/login",
                headers={"Fly-Client-IP": "198.51.100.8"},
                json={"email": "missing@example.com", "password": "wrong"},
            )
            other_ip = client.post(
                "/auth/login",
                headers={"Fly-Client-IP": "198.51.100.9"},
                json={"email": "missing@example.com", "password": "wrong"},
            )
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(other_ip.status_code, 401)


class ClientIpTests(unittest.TestCase):
    def test_ignores_spoofed_forwarded_for(self):
        from netutil import client_ip

        class Req:
            headers = {"x-forwarded-for": "1.2.3.4", "fly-client-ip": "198.51.100.8"}
            client = None

        self.assertEqual(client_ip(Req()), "198.51.100.8")

        class Direct:
            headers = {"x-forwarded-for": "1.2.3.4"}
            client = type("C", (), {"host": "10.0.0.8"})()

        self.assertEqual(client_ip(Direct()), "10.0.0.8")


if __name__ == "__main__":
    unittest.main()
