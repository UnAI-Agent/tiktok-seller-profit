"""Password reset tokens and email verification codes. Only hashes are stored."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from datetime import datetime, timezone

RESET_TTL_SEC = 30 * 60
CODE_TTL_SEC = 15 * 60
CODE_ATTEMPTS = 5
RESEND_WAIT_SEC = 60


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def issue_password_reset(db, user_id: int, now: int | None = None) -> str:
    current = int(now if now is not None else time.time())
    token = secrets.token_urlsafe(32)
    db.execute(
        "INSERT INTO password_resets (token_hash, user_id, expires_at, used_at) VALUES (?,?,?,NULL)",
        (hash_secret(token), int(user_id), current + RESET_TTL_SEC),
    )
    return token


def take_password_reset(db, token: str, now: int | None = None) -> int | None:
    if not token or len(token) < 20:
        return None
    current = int(now if now is not None else time.time())
    digest = hash_secret(token)
    cur = db.execute(
        """UPDATE password_resets
           SET used_at=?
           WHERE token_hash=? AND used_at IS NULL AND expires_at>=?""",
        (current, digest, current),
    )
    if cur.rowcount != 1:
        return None
    row = db.execute(
        "SELECT user_id FROM password_resets WHERE token_hash=?",
        (digest,),
    ).fetchone()
    return int(row["user_id"]) if row else None


def issue_email_code(db, user_id: int, now: int | None = None) -> str:
    current = int(now if now is not None else time.time())
    code = f"{secrets.randbelow(1_000_000):06d}"
    digest = hash_secret(code)
    expires = current + CODE_TTL_SEC
    db.execute(
        """INSERT INTO email_verifications (user_id, code_hash, expires_at, attempts)
           VALUES (?,?,?,0)
           ON CONFLICT(user_id) DO UPDATE SET
             code_hash=excluded.code_hash,
             expires_at=excluded.expires_at,
             attempts=0""",
        (int(user_id), digest, expires),
    )
    return code


def resend_allowed(db, user_id: int, now: int | None = None) -> bool:
    row = db.execute(
        "SELECT expires_at FROM email_verifications WHERE user_id=?",
        (int(user_id),),
    ).fetchone()
    if not row:
        return True
    current = int(now if now is not None else time.time())
    sent_at = int(row["expires_at"]) - CODE_TTL_SEC
    return current - sent_at >= RESEND_WAIT_SEC


def check_email_code(db, user_id: int, code: str, now: int | None = None) -> str:
    current = int(now if now is not None else time.time())
    row = db.execute(
        "SELECT code_hash, expires_at, attempts FROM email_verifications WHERE user_id=?",
        (int(user_id),),
    ).fetchone()
    if not row:
        return "mismatch"
    if int(row["attempts"]) >= CODE_ATTEMPTS:
        return "locked"
    if int(row["expires_at"]) < current:
        return "expired"
    supplied = hash_secret((code or "").strip())
    if not hmac.compare_digest(str(row["code_hash"]), supplied):
        attempts = int(row["attempts"]) + 1
        db.execute(
            "UPDATE email_verifications SET attempts=? WHERE user_id=?",
            (attempts, int(user_id)),
        )
        return "locked" if attempts >= CODE_ATTEMPTS else "mismatch"
    db.execute(
        "UPDATE users SET email_verified_at=? WHERE id=?",
        (datetime.now(timezone.utc).isoformat(), int(user_id)),
    )
    db.execute("DELETE FROM email_verifications WHERE user_id=?", (int(user_id),))
    return "ok"
