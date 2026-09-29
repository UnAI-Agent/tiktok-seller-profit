import sqlite3
import unittest

import admin_db
from db import DbConnection


def _mem():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    db = DbConnection(conn, is_postgres=False)
    db.execute(
        """
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            token_version INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.commit()
    return db


class IdentTests(unittest.TestCase):
    def test_rejects_injection(self):
        for payload in (
            'users"; DROP TABLE users;--',
            "1 OR 1=1",
            "name) VALUES",
            "users\u201d",
        ):
            with self.subTest(payload=payload), self.assertRaises(admin_db.AdminDbError):
                admin_db.quote_ident(payload)

    def test_accepts_table(self):
        self.assertEqual(admin_db.quote_ident("users"), '"users"')


class BrowseTests(unittest.TestCase):
    def test_insert_list_update_delete(self):
        db = _mem()
        admin_db.insert_row(
            db,
            "users",
            {"email": "a@example.com", "password_hash": "Abcdef1!"},
        )
        data = admin_db.list_rows(db, "users")
        self.assertEqual(data["total"], 1)
        self.assertIsNone(data["rows"][0]["password_hash"])
        uid = data["rows"][0]["id"]
        row = db.execute("SELECT password_hash FROM users WHERE id=?", (uid,)).fetchone()
        self.assertTrue(row["password_hash"].startswith("$2"))
        admin_db.update_row(db, "users", {"id": uid}, {"email": "b@example.com"})
        data = admin_db.list_rows(db, "users", q="b@")
        self.assertEqual(data["rows"][0]["email"], "b@example.com")
        admin_db.delete_row(db, "users", {"id": uid})
        self.assertEqual(admin_db.list_rows(db, "users")["total"], 0)

    def test_patch_user_and_pro_and_reset(self):
        db = _mem()
        db.execute(
            """
            CREATE TABLE subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                service TEXT NOT NULL,
                status TEXT DEFAULT 'free',
                stripe_sub_id TEXT,
                promo_expires_at TEXT,
                tier TEXT,
                UNIQUE(user_id, service)
            )
            """
        )
        db.execute(
            "CREATE TABLE oauth_identities (user_id INTEGER, provider TEXT, subject TEXT)"
        )
        db.execute("CREATE TABLE oauth_tickets (ticket TEXT, user_id INTEGER)")
        db.execute("CREATE TABLE sku_records (user_id INTEGER)")
        db.execute("CREATE TABLE promo_redemptions (user_id INTEGER, code TEXT)")
        db.commit()
        admin_db.insert_row(
            db,
            "users",
            {"email": "a@example.com", "password_hash": "Abcdef1!"},
        )
        uid = admin_db.list_rows(db, "users")["rows"][0]["id"]
        admin_db.patch_user(db, uid, email="pro@example.com")
        admin_db.upsert_subscription(
            db, uid, "tiktok-seller-tool", status="active"
        )
        sub = db.execute(
            "SELECT status FROM subscriptions WHERE user_id=?", (uid,)
        ).fetchone()
        self.assertEqual(sub["status"], "active")
        temp = admin_db.reset_user_password(db, uid)
        from security.passwords import validate_password, verify_password

        validate_password(temp)
        stored = db.execute(
            "SELECT password_hash, email FROM users WHERE id=?", (uid,)
        ).fetchone()
        self.assertEqual(stored["email"], "pro@example.com")
        self.assertTrue(verify_password(temp, stored["password_hash"]))
        version = db.execute(
            "SELECT token_version FROM users WHERE id=?", (uid,)
        ).fetchone()["token_version"]
        self.assertGreaterEqual(version, 1)
        admin_db.delete_user(db, uid)
        self.assertEqual(admin_db.list_rows(db, "users")["total"], 0)

    def test_unknown_table(self):
        db = _mem()
        with self.assertRaises(admin_db.AdminDbError) as ctx:
            admin_db.list_rows(db, "nope")
        self.assertEqual(ctx.exception.status, 404)


if __name__ == "__main__":
    unittest.main()
