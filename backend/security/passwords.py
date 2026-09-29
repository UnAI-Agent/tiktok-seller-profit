"""Password hashing (bcrypt) and policy — not stored in plain text anywhere."""

import hashlib
import re
import secrets

import bcrypt

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(email: str) -> str:
    return email.strip().lower()


def validate_password(password: str) -> None:
    """8+ chars and at least 3 of: upper, lower, digit, special."""
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters")
    classes = 0
    if re.search(r"[A-Z]", password):
        classes += 1
    if re.search(r"[a-z]", password):
        classes += 1
    if re.search(r"\d", password):
        classes += 1
    if re.search(r"[!@#$%^&*(),.?\":{}|<>_\-+=\[\]\\;/'`~]", password):
        classes += 1
    if classes < 3:
        raise ValueError(
            "Password needs at least 3 of: uppercase, lowercase, number, special character",
        )


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def _legacy_sha256(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def verify_password(password: str, stored_hash: str) -> bool:
    if stored_hash.startswith("$2"):
        try:
            return bcrypt.checkpw(
                password.encode("utf-8"),
                stored_hash.encode("utf-8"),
            )
        except ValueError:
            return False
    return secrets.compare_digest(_legacy_sha256(password), stored_hash)


def needs_rehash(stored_hash: str) -> bool:
    return not stored_hash.startswith("$2")


def generate_temp_password() -> str:
    """Owner-facing one-time password. Always satisfies validate_password."""
    return f"Rst-{secrets.token_urlsafe(8)}!1"
