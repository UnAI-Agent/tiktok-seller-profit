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


def _pg_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://") :]
    return url


def _adapt_placeholders(sql: str) -> str:
    if not USE_POSTGRES:
        return sql
    return sql.replace("?", "%s")


def _adapt_sql(sql: str) -> str:
    sql = sql.strip()
    sql = sql.replace("INSERT OR REPLACE INTO reply_cache", "INSERT INTO reply_cache")
    if re.search(r"INSERT\s+INTO\s+reply_cache\b", sql, re.I) and "ON CONFLICT" not in sql.upper():
        sql = (
            sql.rstrip().rstrip(";")
            + " ON CONFLICT (hash) DO UPDATE SET "
            "content = EXCLUDED.content, service = EXCLUDED.service"
        )
    if USE_POSTGRES:
        if _INSERT_RETURNING_ID.search(sql) and "RETURNING" not in sql.upper():
            sql = sql.rstrip().rstrip(";") + " RETURNING id"
    return _adapt_placeholders(sql)


class CursorProxy:
    def __init__(self, cursor: Any, *, is_postgres: bool, had_returning: bool):
        self._cursor = cursor
        self._is_postgres = is_postgres
        self._had_returning = had_returning
        self._returning_row: Optional[dict] = None
        self.lastrowid: Optional[int] = None

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
        adapted = _adapt_sql(sql)
        had_returning = USE_POSTGRES and "RETURNING ID" in adapted.upper()
        cur = self._conn.cursor()
        cur.execute(adapted, tuple(params))
        return CursorProxy(cur, is_postgres=self._is_postgres, had_returning=had_returning)

    def commit(self) -> None:
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()


def get_db() -> DbConnection:
    if USE_POSTGRES:
        import psycopg
        from psycopg.rows import dict_row

        conn = psycopg.connect(_pg_url(DATABASE_URL), row_factory=dict_row)
        return DbConnection(conn, is_postgres=True)

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
            stripe_customer_id  TEXT
        );
        CREATE TABLE IF NOT EXISTS subscriptions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            service       TEXT NOT NULL,
            status        TEXT DEFAULT 'free',
            stripe_sub_id TEXT,
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
"""

_POSTGRES_SCHEMA = """
        CREATE TABLE IF NOT EXISTS users (
            id                  SERIAL PRIMARY KEY,
            email               TEXT UNIQUE NOT NULL,
            password_hash       TEXT NOT NULL,
            created_at          TIMESTAMPTZ DEFAULT NOW(),
            stripe_customer_id  TEXT
        );
        CREATE TABLE IF NOT EXISTS subscriptions (
            id            SERIAL PRIMARY KEY,
            user_id       INTEGER NOT NULL,
            service       TEXT NOT NULL,
            status        TEXT DEFAULT 'free',
            stripe_sub_id TEXT,
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
"""


def init_db() -> None:
    db = get_db()
    script = _POSTGRES_SCHEMA if USE_POSTGRES else _SQLITE_SCHEMA
    if USE_POSTGRES:
        for stmt in filter(None, (s.strip() for s in script.split(";"))):
            db.execute(stmt)
    else:
        db._conn.executescript(script)
    db.commit()
    db.close()
