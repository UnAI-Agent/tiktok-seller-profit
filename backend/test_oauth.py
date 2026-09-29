import os
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import oauth
from db import DbConnection


class PkceTests(unittest.TestCase):
    def test_challenge_is_s256(self):
        verifier, challenge = oauth.make_pkce()
        self.assertGreater(len(verifier), 40)
        self.assertNotIn("=", challenge)
        self.assertNotIn("+", challenge)


class ProfileTests(unittest.TestCase):
    def test_google_verified(self):
        p = oauth.parse_google_userinfo(
            {"sub": "abc", "email": "A@Gmail.com", "email_verified": True}
        )
        self.assertEqual(p.email, "a@gmail.com")
        self.assertEqual(p.subject, "abc")

    def test_google_unverified(self):
        with self.assertRaises(oauth.OAuthError) as ctx:
            oauth.parse_google_userinfo(
                {"sub": "abc", "email": "a@gmail.com", "email_verified": False}
            )
        self.assertEqual(ctx.exception.code, "unverified")

    def test_facebook_without_email(self):
        p = oauth.parse_facebook_me({"id": "99"})
        self.assertTrue(p.email.startswith("facebook.99@"))

    def test_tiktok_open_id(self):
        p = oauth.parse_tiktok_user({"open_id": "tt_1"}, {"data": {"user": {}}})
        self.assertEqual(p.provider, "tiktok")
        self.assertIn("tt_1", p.email)

    def test_facebook_proof(self):
        proof = oauth.facebook_appsecret_proof("token", "secret")
        self.assertEqual(len(proof), 64)


class TicketGuardTests(unittest.TestCase):
    def test_garbage_ticket(self):
        self.assertIsNone(oauth.consume_ticket(""))
        self.assertIsNone(oauth.consume_ticket("not valid!"))
        self.assertIsNone(oauth.consume_ticket("short"))


class ExtIdTests(unittest.TestCase):
    def test_client_from_state(self):
        ext = "a" * 32
        self.assertEqual(oauth.client_from_state(f"nonce.{ext}"), ext)
        self.assertEqual(oauth.client_from_state("nonce"), "")
        self.assertEqual(oauth.normalize_ext_id("nope"), "")

    def test_lle_allows_only_listed_extension(self):
        allowed = "a" * 32
        with patch.dict(os.environ, {"APP_ENV": "lle", "EXTENSION_IDS": allowed}):
            self.assertEqual(oauth.assert_extension_client(allowed), allowed)
            with self.assertRaises(oauth.OAuthError):
                oauth.assert_extension_client("b" * 32)
            with self.assertRaises(oauth.OAuthError):
                oauth.assert_extension_client("")


class HijackTests(unittest.TestCase):
    def test_password_account_is_not_linked(self):
        handle = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        path = handle.name
        handle.close()
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        db = DbConnection(conn, is_postgres=False)
        db.execute(
            """CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                email TEXT,
                password_hash TEXT
            )"""
        )
        db.execute(
            """CREATE TABLE oauth_identities (
                user_id INTEGER,
                provider TEXT,
                subject TEXT
            )"""
        )
        db.execute(
            "INSERT INTO users (id, email, password_hash) VALUES (1, ?, ?)",
            ("seller@example.com", "hash"),
        )
        db.commit()

        def connect():
            again = sqlite3.connect(path)
            again.row_factory = sqlite3.Row
            return DbConnection(again, is_postgres=False)

        with patch.object(oauth, "get_db", connect):
            with self.assertRaises(oauth.OAuthError) as ctx:
                oauth.find_or_create_oauth_user(
                    oauth.OAuthProfile("google", "sub-1", "seller@example.com")
                )
        self.assertEqual(ctx.exception.code, "account_exists")
        db.close()
        os.unlink(path)


if __name__ == "__main__":
    unittest.main()
