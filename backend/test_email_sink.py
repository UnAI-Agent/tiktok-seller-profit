"""Account mail through a local SMTP sink. Never a real mailbox."""

import email
import os
import re
import unittest
from email import policy

os.environ.setdefault("ENV", "development")
os.environ.setdefault("APP_ENV", "local")

import db
from aiosmtpd.controller import Controller
from fastapi.testclient import TestClient
import marginmark_app
from test_launch_v2 import LaunchDb

_CODE = re.compile(r"\b(\d{6})\b")


class _Sink:
    def __init__(self):
        self.raw: list[bytes] = []

    async def handle_DATA(self, server, session, envelope):
        self.raw.append(envelope.content)
        return "250 OK"

    def messages(self):
        return [email.message_from_bytes(item, policy=policy.default) for item in self.raw]

    def bodies_to(self, address: str) -> list[str]:
        found = []
        for msg in self.messages():
            if address.lower() not in (msg.get("To") or "").lower():
                continue
            if msg.is_multipart():
                found.append(msg.get_body(preferencelist=("plain",)).get_content())
            else:
                found.append(msg.get_content())
        return found


class EmailSinkTests(unittest.TestCase):
    def setUp(self):
        self.db = LaunchDb()
        self.client = TestClient(marginmark_app.app)
        self.sink = _Sink()
        self.controller = Controller(self.sink, hostname="127.0.0.1", port=1025)
        self.controller.start()
        self.n = 0

    def tearDown(self):
        self.controller.stop()
        self.client.close()
        self.db.close()

    def _ip(self) -> str:
        self.n += 1
        return f"203.0.113.{20 + self.n}"

    def _register(self, address: str):
        return self.client.post(
            "/auth/register",
            headers={"Fly-Client-IP": self._ip()},
            json={"email": address, "password": "Valid-pass-1"},
        )

    def test_register_code_verifies_the_account(self):
        """@F-MAIL-VERIFY The 6-digit code in the sink verifies the account."""
        address = "e2e+verify@e2e.test"
        registered = self._register(address)
        self.assertEqual(registered.status_code, 200, registered.text)
        token = registered.json()["access_token"]
        bodies = self.sink.bodies_to(address)
        self.assertTrue(bodies, "register did not send a message")
        match = _CODE.search(bodies[-1])
        self.assertIsNotNone(match)
        verified = self.client.post(
            "/auth/verify-email",
            headers={"Authorization": f"Bearer {token}", "Fly-Client-IP": self._ip()},
            json={"code": match.group(1)},
        )
        self.assertEqual(verified.status_code, 200, verified.text)
        me = self.client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertTrue(me.json()["email_verified"])

    def test_resend_within_60_seconds_is_429(self):
        """@F-MAIL-RESEND"""
        address = "e2e+resend@e2e.test"
        registered = self._register(address)
        token = registered.json()["access_token"]
        response = self.client.post(
            "/auth/verify-email/resend",
            headers={"Authorization": f"Bearer {token}", "Fly-Client-IP": self._ip()},
        )
        self.assertEqual(response.status_code, 429, response.text)
        self.assertIn("Wait 60 seconds", response.json().get("detail") or response.json().get("error", ""))

    def test_forgot_password_form_and_json(self):
        """@F-MAIL-RESET Reset link from the sink works as a form and as JSON."""
        address = "e2e+reset@e2e.test"
        registered = self._register(address)
        old = registered.json()["access_token"]
        forgot = self.client.post(
            "/auth/forgot-password",
            headers={"Fly-Client-IP": self._ip()},
            json={"email": address},
        )
        self.assertEqual(forgot.status_code, 200, forgot.text)
        body = self.sink.bodies_to(address)[-1]
        token = body.split("token=")[1].split()[0].strip()
        form = self.client.get("/auth/reset", params={"token": token})
        self.assertEqual(form.status_code, 200, form.text)
        self.assertIn("password", form.text.lower())
        saved = self.client.post(
            "/auth/reset",
            headers={"Fly-Client-IP": self._ip(), "Content-Type": "application/x-www-form-urlencoded"},
            content=f"token={token}&password=Next-pass-2&confirm=Next-pass-2",
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        stale = self.client.get("/auth/me", headers={"Authorization": f"Bearer {old}"})
        self.assertEqual(stale.status_code, 401)
        logged = self.client.post(
            "/auth/login",
            headers={"Fly-Client-IP": self._ip()},
            json={"email": address, "password": "Next-pass-2"},
        )
        self.assertEqual(logged.status_code, 200, logged.text)

        address_b = "e2e+resetjson@e2e.test"
        self._register(address_b)
        self.client.post(
            "/auth/forgot-password",
            headers={"Fly-Client-IP": self._ip()},
            json={"email": address_b},
        )
        token_b = self.sink.bodies_to(address_b)[-1].split("token=")[1].split()[0].strip()
        as_json = self.client.post(
            "/auth/reset",
            headers={"Fly-Client-IP": self._ip()},
            json={"token": token_b, "password": "Next-pass-3"},
        )
        self.assertEqual(as_json.status_code, 200, as_json.text)
        again = self.client.post(
            "/auth/reset",
            headers={"Fly-Client-IP": self._ip()},
            json={"token": token_b, "password": "Next-pass-4"},
        )
        self.assertEqual(again.status_code, 400, again.text)
        logged_b = self.client.post(
            "/auth/login",
            headers={"Fly-Client-IP": self._ip()},
            json={"email": address_b, "password": "Next-pass-3"},
        )
        self.assertEqual(logged_b.status_code, 200, logged_b.text)

    def test_support_ticket_emails_the_inbox(self):
        """@F-MAIL-SUPPORT @F-SUPPORT"""
        response = self.client.post(
            "/support/ticket",
            headers={"Fly-Client-IP": self._ip()},
            json={
                "email": "seller@e2e.test",
                "subject": "Price did not read",
                "message": "The overlay showed no price.",
                "kind": "problem",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        conn = db.get_db()
        row = conn.execute(
            "SELECT subject FROM support_tickets WHERE email=?",
            ("seller@e2e.test",),
        ).fetchone()
        conn.close()
        self.assertEqual(row["subject"], "Price did not read")
        inbox = self.sink.bodies_to("support@e2e.test")
        self.assertTrue(inbox)
        subjects = [msg.get("Subject") or "" for msg in self.sink.messages()]
        self.assertTrue(any(item.startswith("[problem]") for item in subjects))
