"""SQLite (local) or Postgres (DATABASE_URL / Neon)."""

from __future__ import annotations

import os
import re
import sqlite3
from typing import Any, Iterable, Optional

from dotenv import load_dotenv

load_dotenv()

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_DATA_DIR = os.path.join(_BACKEND_DIR, "data")
os.makedirs(_DATA_DIR, exist_ok=True)
DB_PATH = os.getenv("DB_PATH", os.path.join(_DATA_DIR, "platform.db"))

DATABASE_URL = (os.getenv("DATABASE_URL") or os.getenv("DATABASE_URL_UNPOOLED") or "").strip()
USE_POSTGRES = bool(DATABASE_URL)

_INSERT_RETURNING_ID = re.compile(
    r"INSERT\s+INTO\s+(users|saved_replies|support_tickets|sku_records)\b",
    re.IGNORECASE,
)
_IDENTIFIER_RE = re.compile(r"^[a-z_][a-z0-9_]*$")
_COLUMN_SPECS = frozenset(
    {
        "INTEGER NOT NULL DEFAULT 0",
        "INTEGER",
        "TEXT",
        "TIMESTAMPTZ",
    }
)


def _pg_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://") :]
    return url


def _adapt_placeholders(sql: str, *, postgres: bool) -> str:
    if not postgres:
        return sql
    return sql.replace("?", "%s")


def _adapt_sql(sql: str, *, postgres: bool) -> str:
    sql = sql.strip()
    sql = sql.replace("INSERT OR REPLACE INTO reply_cache", "INSERT INTO reply_cache")
    if re.search(r"INSERT\s+INTO\s+reply_cache\b", sql, re.I) and "ON CONFLICT" not in sql.upper():
        sql = (
            sql.rstrip().rstrip(";")
            + " ON CONFLICT (hash) DO UPDATE SET "
            "content = EXCLUDED.content, service = EXCLUDED.service"
        )
    if postgres:
        if _INSERT_RETURNING_ID.search(sql) and "RETURNING" not in sql.upper():
            sql = sql.rstrip().rstrip(";") + " RETURNING id"
    return _adapt_placeholders(sql, postgres=postgres)


class CursorProxy:
    def __init__(self, cursor: Any, *, is_postgres: bool, had_returning: bool):
        self._cursor = cursor
        self._is_postgres = is_postgres
        self._had_returning = had_returning
        self._returning_row: Optional[dict] = None
        self.lastrowid: Optional[int] = None
        self.rowcount: int = cursor.rowcount if cursor.rowcount is not None else -1

        if is_postgres and had_returning:
            row = cursor.fetchone()
            if row is not None:
                self._returning_row = dict(row)
                self.lastrowid = self._returning_row.get("id")
        elif not is_postgres:
            self.lastrowid = cursor.lastrowid

    def fetchone(self) -> Optional[dict]:
        if self._returning_row is not None:
            row, self._returning_row = self._returning_row, None
            return row
        row = self._cursor.fetchone()
        if row is None:
            return None
        return dict(row)

    def fetchall(self) -> list[dict]:
        rows = self._cursor.fetchall()
        return [dict(r) for r in rows]


class DbConnection:
    def __init__(self, conn: Any, *, is_postgres: bool):
        self._conn = conn
        self._is_postgres = is_postgres

    def execute(self, sql: str, params: Iterable[Any] = ()) -> CursorProxy:
        adapted = _adapt_sql(sql, postgres=self._is_postgres)
        had_returning = self._is_postgres and "RETURNING ID" in adapted.upper()
        cur = self._conn.cursor()
        cur.execute(adapted, tuple(params))
        return CursorProxy(cur, is_postgres=self._is_postgres, had_returning=had_returning)

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def close(self) -> None:
        pool = getattr(self, "_pool", None)
        if pool is not None:
            pool.putconn(self._conn)
            return
        self._conn.close()


_PG_POOL: Any = None


def get_db() -> DbConnection:
    global _PG_POOL
    if USE_POSTGRES:
        from psycopg.rows import dict_row
        from psycopg_pool import ConnectionPool

        if _PG_POOL is None:
            _PG_POOL = ConnectionPool(
                conninfo=_pg_url(DATABASE_URL),
                min_size=1,
                max_size=10,
                kwargs={"row_factory": dict_row},
            )
        conn = _PG_POOL.getconn()
        wrapped = DbConnection(conn, is_postgres=True)
        wrapped._pool = _PG_POOL
        return wrapped

    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return DbConnection(conn, is_postgres=False)


def reply_cache_freshness_sql() -> str:
    if USE_POSTGRES:
        return "created_at::timestamptz > NOW() - INTERVAL '48 hours'"
    return "datetime(created_at) > datetime('now', '-48 hours')"


def telemetry_window_sql(days: int) -> tuple[str, tuple[Any, ...]]:
    if USE_POSTGRES:
        return "ts::timestamptz >= NOW() - (%s * INTERVAL '1 day')", (days,)
    return "datetime(ts) >= datetime('now', ?)", (f"-{days} days",)


_SQLITE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS users (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            email               TEXT UNIQUE NOT NULL,
            password_hash       TEXT NOT NULL,
            created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
            stripe_customer_id  TEXT,
            token_version       INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS subscriptions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            service       TEXT NOT NULL,
            status        TEXT DEFAULT 'free',
            stripe_sub_id TEXT,
            promo_expires_at TEXT,
            past_due_since TEXT,
            UNIQUE(user_id, service)
        );
        CREATE TABLE IF NOT EXISTS usage (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id  INTEGER NOT NULL,
            service  TEXT NOT NULL,
            date     TEXT NOT NULL,
            count    INTEGER DEFAULT 0,
            UNIQUE(user_id, service, date)
        );
        CREATE TABLE IF NOT EXISTS saved_replies (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            service    TEXT NOT NULL,
            label      TEXT,
            content    TEXT NOT NULL,
            use_count  INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS recent_openings (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            service    TEXT NOT NULL,
            opening    TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS reply_cache (
            hash       TEXT PRIMARY KEY,
            content    TEXT NOT NULL,
            service    TEXT NOT NULL,
            hit_count  INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS user_profiles (
            user_id        INTEGER NOT NULL,
            service        TEXT NOT NULL,
            business_name  TEXT,
            business_type  TEXT,
            return_policy  TEXT,
            shipping_info  TEXT,
            tone_notes     TEXT,
            custom_context TEXT,
            updated_at     TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, service)
        );
        CREATE TABLE IF NOT EXISTS support_tickets (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER,
            service    TEXT NOT NULL,
            email      TEXT NOT NULL,
            subject    TEXT NOT NULL,
            message    TEXT NOT NULL,
            status     TEXT DEFAULT 'open',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS telemetry_events (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            ts           TEXT NOT NULL,
            service      TEXT NOT NULL,
            event        TEXT NOT NULL,
            user_id      INTEGER,
            payload_json TEXT,
            source       TEXT DEFAULT 'server'
        );
        CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry_events(ts);
        CREATE INDEX IF NOT EXISTS idx_telemetry_svc_evt ON telemetry_events(service, event);
        CREATE TABLE IF NOT EXISTS sku_records (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL,
            service      TEXT NOT NULL,
            sku_id       TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            updated_at   TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, service, sku_id)
        );
        CREATE TABLE IF NOT EXISTS oauth_identities (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            provider   TEXT NOT NULL,
            subject    TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(provider, subject)
        );
        CREATE TABLE IF NOT EXISTS oauth_flows (
            state         TEXT PRIMARY KEY,
            provider      TEXT NOT NULL,
            mode          TEXT NOT NULL,
            code_verifier TEXT NOT NULL,
            created_at    INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS oauth_tickets (
            ticket     TEXT PRIMARY KEY,
            user_id    INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            used       INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS promo_codes (
            code            TEXT PRIMARY KEY,
            service         TEXT NOT NULL,
            duration_days   INTEGER NOT NULL,
            max_redemptions INTEGER,
            redeemed_count  INTEGER NOT NULL DEFAULT 0,
            active          INTEGER NOT NULL DEFAULT 1,
            created_at      TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS promo_redemptions (
            user_id    INTEGER NOT NULL,
            code       TEXT NOT NULL,
            service    TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, code)
        );
        CREATE TABLE IF NOT EXISTS remote_config (
            service    TEXT NOT NULL,
            key        TEXT NOT NULL,
            value_json TEXT NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (service, key)
        );
        CREATE TABLE IF NOT EXISTS stripe_events (
            event_id    TEXT PRIMARY KEY,
            event_type  TEXT NOT NULL,
            processed_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
"""

_POSTGRES_SCHEMA = """
        CREATE TABLE IF NOT EXISTS users (
            id                  SERIAL PRIMARY KEY,
            email               TEXT UNIQUE NOT NULL,
            password_hash       TEXT NOT NULL,
            created_at          TIMESTAMPTZ DEFAULT NOW(),
            stripe_customer_id  TEXT,
            token_version       INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS subscriptions (
            id            SERIAL PRIMARY KEY,
            user_id       INTEGER NOT NULL,
            service       TEXT NOT NULL,
            status        TEXT DEFAULT 'free',
            stripe_sub_id TEXT,
            promo_expires_at TIMESTAMPTZ,
            past_due_since TIMESTAMPTZ,
            UNIQUE(user_id, service)
        );
        CREATE TABLE IF NOT EXISTS usage (
            id       SERIAL PRIMARY KEY,
            user_id  INTEGER NOT NULL,
            service  TEXT NOT NULL,
            date     TEXT NOT NULL,
            count    INTEGER DEFAULT 0,
            UNIQUE(user_id, service, date)
        );
        CREATE TABLE IF NOT EXISTS saved_replies (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL,
            service    TEXT NOT NULL,
            label      TEXT,
            content    TEXT NOT NULL,
            use_count  INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS recent_openings (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL,
            service    TEXT NOT NULL,
            opening    TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS reply_cache (
            hash       TEXT PRIMARY KEY,
            content    TEXT NOT NULL,
            service    TEXT NOT NULL,
            hit_count  INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS user_profiles (
            user_id        INTEGER NOT NULL,
            service        TEXT NOT NULL,
            business_name  TEXT,
            business_type  TEXT,
            return_policy  TEXT,
            shipping_info  TEXT,
            tone_notes     TEXT,
            custom_context TEXT,
            updated_at     TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (user_id, service)
        );
        CREATE TABLE IF NOT EXISTS support_tickets (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER,
            service    TEXT NOT NULL,
            email      TEXT NOT NULL,
            subject    TEXT NOT NULL,
            message    TEXT NOT NULL,
            status     TEXT DEFAULT 'open',
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS telemetry_events (
            id           SERIAL PRIMARY KEY,
            ts           TIMESTAMPTZ NOT NULL,
            service      TEXT NOT NULL,
            event        TEXT NOT NULL,
            user_id      INTEGER,
            payload_json TEXT,
            source       TEXT DEFAULT 'server'
        );
        CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry_events(ts);
        CREATE INDEX IF NOT EXISTS idx_telemetry_svc_evt ON telemetry_events(service, event);
        CREATE TABLE IF NOT EXISTS sku_records (
            id           SERIAL PRIMARY KEY,
            user_id      INTEGER NOT NULL,
            service      TEXT NOT NULL,
            sku_id       TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            updated_at   TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, service, sku_id)
        );
        CREATE TABLE IF NOT EXISTS oauth_identities (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL,
            provider   TEXT NOT NULL,
            subject    TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(provider, subject)
        );
        CREATE TABLE IF NOT EXISTS oauth_flows (
            state         TEXT PRIMARY KEY,
            provider      TEXT NOT NULL,
            mode          TEXT NOT NULL,
            code_verifier TEXT NOT NULL,
            created_at    BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS oauth_tickets (
            ticket     TEXT PRIMARY KEY,
            user_id    INTEGER NOT NULL,
            created_at BIGINT NOT NULL,
            used       INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS promo_codes (
            code            TEXT PRIMARY KEY,
            service         TEXT NOT NULL,
            duration_days   INTEGER NOT NULL,
            max_redemptions INTEGER,
            redeemed_count  INTEGER NOT NULL DEFAULT 0,
            active          INTEGER NOT NULL DEFAULT 1,
            created_at      TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS promo_redemptions (
            user_id    INTEGER NOT NULL,
            code       TEXT NOT NULL,
            service    TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (user_id, code)
        );
        CREATE TABLE IF NOT EXISTS remote_config (
            service    TEXT NOT NULL,
            key        TEXT NOT NULL,
            value_json TEXT NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (service, key)
        );
        CREATE TABLE IF NOT EXISTS stripe_events (
            event_id    TEXT PRIMARY KEY,
            event_type  TEXT NOT NULL,
            processed_at TIMESTAMPTZ DEFAULT NOW()
        );
"""


def _ensure_sqlite_column(db: DbConnection, table: str, column: str, spec: str) -> None:
    if not _IDENTIFIER_RE.fullmatch(table) or not _IDENTIFIER_RE.fullmatch(column):
        raise ValueError("Invalid migration identifier")
    if spec not in _COLUMN_SPECS:
        raise ValueError("Invalid migration column spec")
    rows = db.execute(f'PRAGMA table_info("{table}")').fetchall()
    names = {r["name"] for r in rows}
    if column not in names:
        db.execute(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {spec}')


def init_db() -> None:
    db = get_db()
    script = _POSTGRES_SCHEMA if USE_POSTGRES else _SQLITE_SCHEMA
    if USE_POSTGRES:
        for stmt in filter(None, (s.strip() for s in script.split(";"))):
            db.execute(stmt)
        db.execute(
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS promo_expires_at TIMESTAMPTZ"
        )
        db.execute(
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ"
        )
        db.execute(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0"
        )
        db.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS tier TEXT")
        db.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS tier_override TEXT")
        db.execute(
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS tier_override_expires_at TEXT"
        )
        db.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS tier_override_note TEXT")
        db.execute(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_used INTEGER NOT NULL DEFAULT 0"
        )
        db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TEXT")
        db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT")
        db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS checkout_started_at TEXT")
        db.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS amount_cents INTEGER")
        db.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS interval TEXT")
        db.execute("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_status TEXT")
        db.execute(
            "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_end TEXT"
        )
    else:
        db._conn.executescript(script)
        _ensure_sqlite_column(db, "subscriptions", "promo_expires_at", "TEXT")
        _ensure_sqlite_column(db, "subscriptions", "past_due_since", "TEXT")
        _ensure_sqlite_column(db, "users", "token_version", "INTEGER NOT NULL DEFAULT 0")
        _ensure_sqlite_column(db, "subscriptions", "tier", "TEXT")
        _ensure_sqlite_column(db, "subscriptions", "tier_override", "TEXT")
        _ensure_sqlite_column(db, "subscriptions", "tier_override_expires_at", "TEXT")
        _ensure_sqlite_column(db, "subscriptions", "tier_override_note", "TEXT")
        _ensure_sqlite_column(db, "users", "trial_used", "INTEGER NOT NULL DEFAULT 0")
        _ensure_sqlite_column(db, "users", "email_verified_at", "TEXT")
        _ensure_sqlite_column(db, "users", "display_name", "TEXT")
        _ensure_sqlite_column(db, "users", "checkout_started_at", "TEXT")
        _ensure_sqlite_column(db, "subscriptions", "amount_cents", "INTEGER")
        _ensure_sqlite_column(db, "subscriptions", "interval", "TEXT")
        _ensure_sqlite_column(db, "subscriptions", "stripe_status", "TEXT")
        _ensure_sqlite_column(db, "subscriptions", "current_period_end", "TEXT")
    from v1_schema import V1_TABLES

    for statement in V1_TABLES:
        db.execute(statement)
    db.execute(
        """CREATE TABLE IF NOT EXISTS password_resets (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            used_at INTEGER
        )"""
    )
    db.execute(
        """CREATE TABLE IF NOT EXISTS email_verifications (
            user_id INTEGER PRIMARY KEY,
            code_hash TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0
        )"""
    )
    db.commit()
    db.close()
