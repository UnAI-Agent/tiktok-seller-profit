"""OAuth 2.0 authorization-code + PKCE for Google, Facebook, and TikTok.

Client secrets stay on the API. The extension only ever sees a one-time ticket,
then exchanges it for the same JWT email login uses.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import re
import secrets
import time
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlencode

import httpx

from db import get_db
from security.passwords import hash_password, normalize_email

logger = logging.getLogger(__name__)

PROVIDERS = ("google", "facebook", "tiktok")
FLOW_TTL_SEC = 600
TICKET_TTL_SEC = 600
HTTP_TIMEOUT = 15.0
FACEBOOK_GRAPH = "v21.0"
SUBJECT_RE = re.compile(r"[^a-zA-Z0-9._-]")

DONE_ERROR_COPY = {
    "not_configured": "This sign-in method is not enabled yet.",
    "denied": "Sign-in was cancelled.",
    "expired": "Sign-in expired. Try again from the extension.",
    "provider": "The identity provider returned an error. Try again.",
    "unverified": "That account email is not verified.",
    "account_exists": "An account with that email already exists. Log in with email and password.",
    "invalid": "Sign-in could not be completed. Try again.",
}


class OAuthError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code if code in DONE_ERROR_COPY else "invalid"


@dataclass(frozen=True)
class OAuthProfile:
    provider: str
    subject: str
    email: str


@dataclass(frozen=True)
class ProviderApp:
    client_id: str
    client_secret: str


def make_pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def facebook_appsecret_proof(access_token: str, app_secret: str) -> str:
    return hmac.new(
        app_secret.encode("utf-8"),
        access_token.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def synthetic_email(provider: str, subject: str) -> str:
    safe = SUBJECT_RE.sub("", subject)[:64] or "user"
    return f"{provider}.{safe}@oauth.tiktok-seller-tool.invalid"


EXT_ID_RE = re.compile(r"^[a-z]{32}$")


def normalize_ext_id(raw: Optional[str]) -> str:
    value = (raw or "").strip()
    return value if EXT_ID_RE.fullmatch(value) else ""


def client_from_state(state: str) -> str:
    if "." not in (state or ""):
        return ""
    return normalize_ext_id(state.rsplit(".", 1)[-1])


def allowed_extension_ids() -> set[str]:
    return {
        ext
        for item in os.getenv("EXTENSION_IDS", "").split(",")
        if (ext := normalize_ext_id(item))
    }


def assert_extension_client(client_id: str) -> str:
    """LLE and prod only start OAuth for an extension id in EXTENSION_IDS."""
    ext = normalize_ext_id(client_id)
    allowed = allowed_extension_ids()
    app_env = os.getenv("APP_ENV", "local").lower()
    if app_env in ("lle", "prod"):
        if not ext or ext not in allowed:
            raise OAuthError("invalid")
        return ext
    if ext and allowed and ext not in allowed:
        raise OAuthError("invalid")
    return ext


def done_message(code: Optional[str]) -> str:
    if not code:
        return "Signed in. Returning to the extension…"
    return DONE_ERROR_COPY.get(code, DONE_ERROR_COPY["invalid"])


def enabled_sign_in_providers() -> list[str]:
    """Providers whose app credentials are set. The extension shows only these, so a provider you have not set up never appears."""
    ready: list[str] = []
    for name in PROVIDERS:
        try:
            load_provider_app(name)
        except OAuthError:
            continue
        ready.append(name)
    return ready


def load_provider_app(provider: str) -> ProviderApp:
    if provider == "google":
        cid = os.getenv("GOOGLE_CLIENT_ID", "").strip()
        secret = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
    elif provider == "facebook":
        cid = os.getenv("FACEBOOK_APP_ID", "").strip()
        secret = os.getenv("FACEBOOK_APP_SECRET", "").strip()
    elif provider == "tiktok":
        cid = os.getenv("TIKTOK_CLIENT_KEY", "").strip()
        secret = os.getenv("TIKTOK_CLIENT_SECRET", "").strip()
    else:
        raise OAuthError("invalid")
    if not cid or not secret:
        raise OAuthError("not_configured")
    return ProviderApp(client_id=cid, client_secret=secret)


def callback_url(public_base: str, provider: str) -> str:
    return f"{public_base.rstrip('/')}/auth/oauth/{provider}/callback"


def authorize_url(
    provider: str,
    *,
    public_base: str,
    state: str,
    code_challenge: str,
) -> str:
    app = load_provider_app(provider)
    redirect_uri = callback_url(public_base, provider)
    if provider == "google":
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(
            {
                "client_id": app.client_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": "openid email profile",
                "state": state,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
                "access_type": "online",
                "prompt": "select_account",
            }
        )
    if provider == "facebook":
        return f"https://www.facebook.com/{FACEBOOK_GRAPH}/dialog/oauth?" + urlencode(
            {
                "client_id": app.client_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": "email,public_profile",
                "state": state,
            }
        )
    return "https://www.tiktok.com/v2/auth/authorize/?" + urlencode(
        {
            "client_key": app.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "user.info.basic",
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
    )


def parse_google_userinfo(data: dict) -> OAuthProfile:
    subject = str(data.get("sub") or "").strip()
    email = normalize_email(str(data.get("email") or ""))
    verified = data.get("email_verified")
    if verified in (True, "true", "1", 1) and subject and "@" in email:
        return OAuthProfile("google", subject, email)
    if subject and not (verified in (True, "true", "1", 1)):
        raise OAuthError("unverified")
    raise OAuthError("provider")


def parse_facebook_me(data: dict) -> OAuthProfile:
    subject = str(data.get("id") or "").strip()
    if not subject:
        raise OAuthError("provider")
    email_raw = str(data.get("email") or "").strip()
    email = normalize_email(email_raw) if "@" in email_raw else synthetic_email("facebook", subject)
    return OAuthProfile("facebook", subject, email)


def parse_tiktok_user(token_body: dict, user_body: dict) -> OAuthProfile:
    user = (user_body.get("data") or {}).get("user") or {}
    subject = str(
        user.get("open_id") or token_body.get("open_id") or ""
    ).strip()
    if not subject:
        raise OAuthError("provider")
    return OAuthProfile("tiktok", subject, synthetic_email("tiktok", subject))


def _purge_expired(db) -> None:
    now = int(time.time())
    db.execute("DELETE FROM oauth_flows WHERE created_at < ?", (now - FLOW_TTL_SEC,))
    db.execute("DELETE FROM oauth_tickets WHERE created_at < ?", (now - TICKET_TTL_SEC,))


def create_flow(provider: str, mode: str, client_id: str = "") -> tuple[str, str]:
    state = secrets.token_urlsafe(32)
    ext = assert_extension_client(client_id)
    if ext:
        state = f"{state}.{ext}"
    verifier, challenge = make_pkce()
    db = get_db()
    _purge_expired(db)
    db.execute(
        "INSERT INTO oauth_flows (state, provider, mode, code_verifier, created_at) VALUES (?,?,?,?,?)",
        (state, provider, mode, verifier, int(time.time())),
    )
    db.commit()
    db.close()
    return state, challenge


def pop_flow(state: str, provider: str) -> tuple[str, str]:
    if not state:
        raise OAuthError("invalid")
    db = get_db()
    row = db.execute(
        "SELECT provider, code_verifier, created_at FROM oauth_flows WHERE state=?",
        (state,),
    ).fetchone()
    db.execute("DELETE FROM oauth_flows WHERE state=?", (state,))
    db.commit()
    db.close()
    if not row:
        raise OAuthError("expired")
    if row["provider"] != provider:
        raise OAuthError("invalid")
    if int(time.time()) - int(row["created_at"]) > FLOW_TTL_SEC:
        raise OAuthError("expired")
    return str(row["code_verifier"]), client_from_state(state)


def issue_ticket(user_id: int) -> str:
    ticket = secrets.token_urlsafe(32)
    db = get_db()
    _purge_expired(db)
    db.execute(
        "INSERT INTO oauth_tickets (ticket, user_id, created_at, used) VALUES (?,?,?,0)",
        (ticket, user_id, int(time.time())),
    )
    db.commit()
    db.close()
    return ticket


def consume_ticket(ticket: str) -> Optional[int]:
    if not ticket or len(ticket) < 16 or len(ticket) > 128:
        return None
    if not re.fullmatch(r"[A-Za-z0-9_-]+", ticket):
        return None
    cutoff = int(time.time()) - TICKET_TTL_SEC
    db = get_db()
    cur = db.execute(
        "UPDATE oauth_tickets SET used=1 WHERE ticket=? AND used=0 AND created_at>=?",
        (ticket, cutoff),
    )
    if cur.rowcount != 1:
        db.close()
        return None
    row = db.execute(
        "SELECT user_id FROM oauth_tickets WHERE ticket=?",
        (ticket,),
    ).fetchone()
    db.commit()
    db.close()
    if not row:
        return None
    return int(row["user_id"])


def find_or_create_oauth_user(profile: OAuthProfile) -> tuple[int, bool]:
    db = get_db()
    ident = db.execute(
        "SELECT user_id FROM oauth_identities WHERE provider=? AND subject=?",
        (profile.provider, profile.subject),
    ).fetchone()
    if ident:
        uid = int(ident["user_id"])
        if profile.provider == "google":
            db.execute(
                "UPDATE users SET email_verified_at=COALESCE(email_verified_at, ?) WHERE id=?",
                (datetime.now(timezone.utc).isoformat(), uid),
            )
            db.commit()
        db.close()
        return uid, False

    email = normalize_email(profile.email)
    existing = db.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
    created = False
    if existing:
        uid = int(existing["id"])
        linked = db.execute(
            "SELECT 1 FROM oauth_identities WHERE user_id=? LIMIT 1",
            (uid,),
        ).fetchone()
        if not linked:
            db.close()
            raise OAuthError("account_exists")
    else:
        cur = db.execute(
            "INSERT INTO users (email, password_hash) VALUES (?,?)",
            (email, hash_password(secrets.token_urlsafe(32))),
        )
        uid = int(cur.lastrowid)
        created = True
    db.execute(
        "INSERT INTO oauth_identities (user_id, provider, subject) VALUES (?,?,?)",
        (uid, profile.provider, profile.subject),
    )
    if profile.provider == "google":
        db.execute(
            "UPDATE users SET email_verified_at=COALESCE(email_verified_at, ?) WHERE id=?",
            (datetime.now(timezone.utc).isoformat(), uid),
        )
    db.commit()
    db.close()
    return uid, created


async def exchange_code_for_profile(
    provider: str,
    *,
    public_base: str,
    code: str,
    code_verifier: str,
) -> OAuthProfile:
    app = load_provider_app(provider)
    redirect_uri = callback_url(public_base, provider)
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            if provider == "google":
                token_res = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "client_id": app.client_id,
                        "client_secret": app.client_secret,
                        "code": code,
                        "code_verifier": code_verifier,
                        "grant_type": "authorization_code",
                        "redirect_uri": redirect_uri,
                    },
                )
                token_res.raise_for_status()
                access = token_res.json().get("access_token")
                if not access:
                    raise OAuthError("provider")
                info = await client.get(
                    "https://www.googleapis.com/oauth2/v3/userinfo",
                    headers={"Authorization": f"Bearer {access}"},
                )
                info.raise_for_status()
                return parse_google_userinfo(info.json())

            if provider == "facebook":
                token_res = await client.post(
                    f"https://graph.facebook.com/{FACEBOOK_GRAPH}/oauth/access_token",
                    data={
                        "client_id": app.client_id,
                        "client_secret": app.client_secret,
                        "redirect_uri": redirect_uri,
                        "code": code,
                    },
                )
                token_res.raise_for_status()
                access = token_res.json().get("access_token")
                if not access:
                    raise OAuthError("provider")
                proof = facebook_appsecret_proof(access, app.client_secret)
                info = await client.get(
                    f"https://graph.facebook.com/{FACEBOOK_GRAPH}/me",
                    params={
                        "fields": "id,email,name",
                        "access_token": access,
                        "appsecret_proof": proof,
                    },
                )
                info.raise_for_status()
                return parse_facebook_me(info.json())

            token_res = await client.post(
                "https://open.tiktokapis.com/v2/oauth/token/",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                data={
                    "client_key": app.client_id,
                    "client_secret": app.client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": redirect_uri,
                    "code_verifier": code_verifier,
                },
            )
            token_res.raise_for_status()
            token_body = token_res.json()
            access = token_body.get("access_token")
            if not access:
                raise OAuthError("provider")
            info = await client.get(
                "https://open.tiktokapis.com/v2/user/info/",
                params={"fields": "open_id,display_name,avatar_url"},
                headers={"Authorization": f"Bearer {access}"},
            )
            user_body = info.json() if info.status_code == 200 else {}
            return parse_tiktok_user(token_body, user_body)
    except OAuthError:
        raise
    except httpx.HTTPError:
        logger.warning("oauth http failed for %s", provider)
        raise OAuthError("provider")
