"""Owner ops table browser. Identifiers only — never execute client SQL."""

from __future__ import annotations

import re
from typing import Any

from db import USE_POSTGRES
from security.passwords import hash_password, validate_password

IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
SKIP_TABLES = frozenset({"sqlite_sequence"})
SECRET_COLUMNS = frozenset({"password_hash", "code_verifier"})
MAX_LIMIT = 200

_SENTINEL_UNCHANGED = ""


class AdminDbError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def quote_ident(name: str) -> str:
    if not IDENT_RE.match(name or ""):
        raise AdminDbError(400, "Invalid identifier")
    return f'"{name}"'


def _require_table(name: str) -> str:
    if name in SKIP_TABLES:
        raise AdminDbError(400, "Table not allowed")
    return quote_ident(name)


def _postgres(db) -> bool:
    flag = getattr(db, "_is_postgres", None)
    return USE_POSTGRES if flag is None else bool(flag)


def list_table_names(db) -> list[str]:
    if _postgres(db):
        rows = db.execute(
            """
            SELECT tablename AS name FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename
            """
        ).fetchall()
    else:
        rows = db.execute(
            """
            SELECT name FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name
            """
        ).fetchall()
    return [r["name"] for r in rows if r["name"] not in SKIP_TABLES]


def describe_table(db, table: str) -> dict[str, Any]:
    qtable = _require_table(table)
    if table not in list_table_names(db):
        raise AdminDbError(404, "Unknown table")

    if _postgres(db):
        cols_raw = db.execute(
            """
            SELECT column_name AS name, data_type AS type,
                   CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull,
                   column_default AS dflt
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ?
            ORDER BY ordinal_position
            """,
            (table,),
        ).fetchall()
        pk_rows = db.execute(
            """
            SELECT a.attname AS name
            FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
            JOIN pg_class c ON c.oid = i.indrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE i.indisprimary AND n.nspname = 'public' AND c.relname = ?
            """,
            (table,),
        ).fetchall()
        pk = {r["name"] for r in pk_rows}
        columns = [
            {
                "name": r["name"],
                "type": r["type"] or "text",
                "pk": r["name"] in pk,
                "notnull": bool(r["notnull"]),
                "has_default": r["dflt"] is not None,
                "secret": r["name"] in SECRET_COLUMNS,
            }
            for r in cols_raw
        ]
    else:
        cols_raw = db.execute(f"PRAGMA table_info({qtable})").fetchall()
        columns = [
            {
                "name": r["name"],
                "type": r["type"] or "TEXT",
                "pk": bool(r["pk"]),
                "notnull": bool(r["notnull"]),
                "has_default": r["dflt_value"] is not None,
                "secret": r["name"] in SECRET_COLUMNS,
            }
            for r in cols_raw
        ]

    count = db.execute(f"SELECT COUNT(*) AS n FROM {qtable}").fetchone()["n"]
    return {"table": table, "columns": columns, "rows": int(count)}


def list_tables(db) -> list[dict[str, Any]]:
    return [describe_table(db, name) for name in list_table_names(db)]


def _col_map(meta: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {c["name"]: c for c in meta["columns"]}


def _pk_names(meta: dict[str, Any]) -> list[str]:
    names = [c["name"] for c in meta["columns"] if c["pk"]]
    if not names:
        raise AdminDbError(400, "Table has no primary key")
    return names


def _coerce(col: dict[str, Any], raw: Any) -> Any:
    if raw is None or raw == "__null__":
        return None
    if isinstance(raw, (int, float, bool)):
        return raw
    text = str(raw)
    if text == "":
        return None
    t = (col.get("type") or "").upper()
    if any(x in t for x in ("INT", "SERIAL", "BIGINT", "SMALLINT")):
        return int(text)
    if any(x in t for x in ("REAL", "DOUBLE", "NUMERIC", "FLOAT", "DECIMAL")):
        return float(text)
    if "BOOL" in t:
        return text.lower() in ("1", "true", "t", "yes")
    return text


def _maybe_hash_secret(col_name: str, value: Any) -> Any:
    if col_name not in SECRET_COLUMNS or value is None:
        return value
    text = str(value)
    if col_name == "password_hash" and not text.startswith("$2"):
        validate_password(text)
        return hash_password(text)
    return text


def _prepare_values(meta: dict[str, Any], values: dict[str, Any], *, for_insert: bool) -> dict[str, Any]:
    cols = _col_map(meta)
    out: dict[str, Any] = {}
    for name, raw in (values or {}).items():
        if name not in cols:
            raise AdminDbError(400, f"Unknown column {name}")
        if for_insert and cols[name]["pk"] and (raw is None or str(raw) == ""):
            continue
        if name in SECRET_COLUMNS and (raw is None or str(raw) == _SENTINEL_UNCHANGED):
            continue
        try:
            coerced = _coerce(cols[name], raw)
            out[name] = _maybe_hash_secret(name, coerced)
        except ValueError as exc:
            raise AdminDbError(400, str(exc)) from exc
        except (TypeError, OverflowError) as exc:
            raise AdminDbError(400, f"Bad value for {name}") from exc
    if for_insert:
        missing = [
            c["name"]
            for c in meta["columns"]
            if c["notnull"]
            and not c["pk"]
            and not c.get("has_default")
            and c["name"] not in out
            and c["name"] not in SECRET_COLUMNS
        ]
        # password_hash is NOT NULL on users — require it on insert
        for c in meta["columns"]:
            if c["notnull"] and not c["pk"] and c["name"] in SECRET_COLUMNS and c["name"] not in out:
                missing.append(c["name"])
        if missing:
            raise AdminDbError(400, "Missing required: " + ", ".join(missing))
    return out


def _pk_clause(meta: dict[str, Any], pk: dict[str, Any]) -> tuple[str, list[Any]]:
    names = _pk_names(meta)
    cols = _col_map(meta)
    if not pk or set(pk) != set(names):
        raise AdminDbError(400, "Primary key columns required")
    parts = []
    params: list[Any] = []
    for name in names:
        parts.append(f"{quote_ident(name)} = ?")
        params.append(_coerce(cols[name], pk[name]))
    return " AND ".join(parts), params


def list_rows(
    db,
    table: str,
    *,
    q: str = "",
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    meta = describe_table(db, table)
    qtable = quote_ident(table)
    limit = min(max(int(limit), 1), MAX_LIMIT)
    offset = max(int(offset), 0)
    where = ""
    params: list[Any] = []
    needle = (q or "").strip()
    if needle:
        likes = []
        for col in meta["columns"]:
            if col["secret"]:
                continue
            likes.append(f"CAST({quote_ident(col['name'])} AS TEXT) LIKE ?")
            params.append(f"%{needle}%")
        if likes:
            where = " WHERE " + " OR ".join(likes)
    total = db.execute(f"SELECT COUNT(*) AS n FROM {qtable}{where}", params).fetchone()["n"]
    order = ", ".join(quote_ident(n) for n in _pk_names(meta)) if any(c["pk"] for c in meta["columns"]) else "1"
    rows = db.execute(
        f"SELECT * FROM {qtable}{where} ORDER BY {order} LIMIT ? OFFSET ?",
        (*params, limit, offset),
    ).fetchall()
    out_rows = []
    for row in rows:
        item = dict(row)
        for col in SECRET_COLUMNS:
            if col in item:
                item[col] = None
        out_rows.append(item)
    return {
        "table": table,
        "columns": meta["columns"],
        "total": int(total),
        "limit": limit,
        "offset": offset,
        "rows": out_rows,
    }


def insert_row(db, table: str, values: dict[str, Any]) -> dict[str, Any]:
    meta = describe_table(db, table)
    prepared = _prepare_values(meta, values, for_insert=True)
    if not prepared:
        raise AdminDbError(400, "No values")
    qtable = quote_ident(table)
    cols = list(prepared.keys())
    sql = (
        f"INSERT INTO {qtable} ({', '.join(quote_ident(c) for c in cols)}) "
        f"VALUES ({', '.join('?' for _ in cols)})"
    )
    db.execute(sql, list(prepared.values()))
    db.commit()
    return {"ok": True}


def update_row(db, table: str, pk: dict[str, Any], values: dict[str, Any]) -> dict[str, Any]:
    meta = describe_table(db, table)
    prepared = _prepare_values(meta, values, for_insert=False)
    pk_names = set(_pk_names(meta))
    for name in pk_names:
        prepared.pop(name, None)
    if not prepared:
        raise AdminDbError(400, "No updatable values")
    clause, pk_params = _pk_clause(meta, pk)
    sets = ", ".join(f"{quote_ident(c)} = ?" for c in prepared)
    qtable = quote_ident(table)
    cur = db.execute(
        f"UPDATE {qtable} SET {sets} WHERE {clause}",
        [*prepared.values(), *pk_params],
    )
    db.commit()
    if cur.rowcount == 0:
        raise AdminDbError(404, "Row not found")
    return {"ok": True}


def delete_row(db, table: str, pk: dict[str, Any]) -> dict[str, Any]:
    meta = describe_table(db, table)
    clause, pk_params = _pk_clause(meta, pk)
    qtable = quote_ident(table)
    cur = db.execute(f"DELETE FROM {qtable} WHERE {clause}", pk_params)
    db.commit()
    if cur.rowcount == 0:
        raise AdminDbError(404, "Row not found")
    return {"ok": True}


def patch_user(
    db,
    user_id: int,
    *,
    email: str | None = None,
    password: str | None = None,
    stripe_customer_id: str | None = None,
    clear_stripe_customer: bool = False,
) -> dict[str, Any]:
    from security.passwords import hash_password, normalize_email, validate_password

    row = db.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
    if not row:
        raise AdminDbError(404, "User not found")
    sets: list[str] = []
    params: list[Any] = []
    if email is not None:
        normalized = normalize_email(email)
        if "@" not in normalized:
            raise AdminDbError(400, "Enter a valid email")
        clash = db.execute(
            "SELECT id FROM users WHERE email=? AND id!=?",
            (normalized, user_id),
        ).fetchone()
        if clash:
            raise AdminDbError(400, "Email already registered")
        sets.append("email=?")
        params.append(normalized)
    if password is not None and str(password).strip():
        try:
            validate_password(password)
        except ValueError as exc:
            raise AdminDbError(400, str(exc)) from exc
        sets.append("password_hash=?")
        params.append(hash_password(password))
        sets.append("token_version=token_version+1")
    if clear_stripe_customer:
        sets.append("stripe_customer_id=?")
        params.append(None)
    elif stripe_customer_id is not None:
        sets.append("stripe_customer_id=?")
        params.append(stripe_customer_id.strip() or None)
    if not sets:
        return {"ok": True}
    params.append(user_id)
    db.execute(f"UPDATE users SET {', '.join(sets)} WHERE id=?", params)
    db.commit()
    return {"ok": True}


def upsert_subscription(
    db,
    user_id: int,
    service: str,
    *,
    status: str | None = None,
    stripe_sub_id: str | None = None,
    promo_expires_at: str | None = None,
    clear_stripe_sub: bool = False,
    clear_promo: bool = False,
) -> dict[str, Any]:
    if status is not None and status not in ("active", "free"):
        raise AdminDbError(400, "status must be active or free")
    row = db.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
    if not row:
        raise AdminDbError(404, "User not found")
    existing = db.execute(
        "SELECT status, stripe_sub_id, promo_expires_at FROM subscriptions WHERE user_id=? AND service=?",
        (user_id, service),
    ).fetchone()
    next_status = status if status is not None else (existing["status"] if existing else "free")
    next_stripe = existing["stripe_sub_id"] if existing else None
    next_promo = existing["promo_expires_at"] if existing else None
    if clear_stripe_sub:
        next_stripe = None
    elif stripe_sub_id is not None:
        next_stripe = stripe_sub_id.strip() or None
    if clear_promo:
        next_promo = None
    elif promo_expires_at is not None:
        next_promo = promo_expires_at.strip() or None
    db.execute(
        """
        INSERT INTO subscriptions (user_id, service, status, stripe_sub_id, promo_expires_at, tier)
        VALUES (?,?,?,?,?,?)
        ON CONFLICT(user_id, service) DO UPDATE SET
            status=?,
            stripe_sub_id=?,
            promo_expires_at=?,
            tier=CASE
              WHEN ?='active' AND COALESCE(subscriptions.tier, '') NOT IN ('pro', 'diamond') THEN 'pro'
              ELSE subscriptions.tier
            END
        """,
        (
            user_id,
            service,
            next_status,
            next_stripe,
            next_promo,
            "pro" if next_status == "active" else None,
            next_status,
            next_stripe,
            next_promo,
            next_status,
        ),
    )
    db.commit()
    return {
        "ok": True,
        "status": next_status,
        "stripe_sub_id": next_stripe,
        "promo_expires_at": next_promo,
    }


def reset_user_password(db, user_id: int) -> str:
    from security.passwords import generate_temp_password, hash_password

    row = db.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
    if not row:
        raise AdminDbError(404, "User not found")
    password = generate_temp_password()
    db.execute(
        "UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?",
        (hash_password(password), user_id),
    )
    db.commit()
    return password


def delete_user(db, user_id: int) -> dict[str, Any]:
    row = db.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
    if not row:
        raise AdminDbError(404, "User not found")
    email = None
    customer_id = None
    try:
        extra = db.execute(
            "SELECT email, stripe_customer_id FROM users WHERE id=?",
            (user_id,),
        ).fetchone()
        if extra:
            email = extra["email"]
            customer_id = extra["stripe_customer_id"]
    except Exception:
        email = None
        customer_id = None
    sub = db.execute(
        "SELECT stripe_sub_id FROM subscriptions WHERE user_id=? AND stripe_sub_id IS NOT NULL",
        (user_id,),
    ).fetchone()
    sub_id = sub["stripe_sub_id"] if sub else None
    if sub_id or customer_id:
        import stripe

        if stripe.api_key:
            if sub_id:
                stripe.Subscription.cancel(sub_id)
            if customer_id:
                stripe.Customer.delete(customer_id)
    try:
        db.execute("UPDATE telemetry_events SET user_id=NULL WHERE user_id=?", (user_id,))
    except Exception:
        pass
    if email:
        try:
            from datetime import datetime, timedelta, timezone

            cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
            db.execute(
                "DELETE FROM support_tickets WHERE email=? AND created_at < ?",
                (email, cutoff),
            )
        except Exception:
            pass
    for sql in (
        "DELETE FROM ai_usage WHERE user_id=?",
        "DELETE FROM support_notes WHERE user_id=?",
    ):
        try:
            db.execute(sql, (user_id,))
        except Exception:
            pass
    for sql in (
        "DELETE FROM subscriptions WHERE user_id=?",
        "DELETE FROM oauth_identities WHERE user_id=?",
        "DELETE FROM oauth_tickets WHERE user_id=?",
        "DELETE FROM sku_records WHERE user_id=?",
        "DELETE FROM promo_redemptions WHERE user_id=?",
        "DELETE FROM users WHERE id=?",
    ):
        db.execute(sql, (user_id,))
    db.commit()
    return {"ok": True}
