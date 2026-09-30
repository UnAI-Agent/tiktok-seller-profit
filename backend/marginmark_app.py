"""MarginMark-only FastAPI application."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import html
import json
import logging
import os
import re
import sys
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

import stripe
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.middleware.base import BaseHTTPMiddleware

import account_flow
import admin_db
import oauth as oauth_mod
import promo as promo_mod
import support_mail
import web_pages
from billing_env import (
    assert_database_isolation,
    assert_stripe_keys_match_env,
    checkout_extra,
    price_amount_matches,
    trial_allowed,
)
from db import DATABASE_URL, DB_PATH, USE_POSTGRES, get_db, init_db, telemetry_window_sql
from netutil import client_ip
from security.passwords import (
    hash_password,
    needs_rehash,
    normalize_email,
    validate_password,
    verify_password,
)

load_dotenv()
logger = logging.getLogger(__name__)

SERVICE = "tiktok-seller-tool"
SERVICE_CONFIG = {
    "name": "MarginMark",
    "free_limit": 10,  # replaced below from tiers.json free.skuLimit
    "pro_price_id": os.getenv("STRIPE_PRICE_TIKTOK_SELLER"),
    "pro_price_id_yearly": os.getenv("STRIPE_PRICE_TIKTOK_SELLER_YEARLY"),
    "pro_price_monthly": 14.99,
    "pro_price_yearly": 120,
}
try:
    from tiers import TIERS as _TIERS

    SERVICE_CONFIG["free_limit"] = int(_TIERS["free"]["skuLimit"])
    SERVICE_CONFIG["pro_price_monthly"] = float(_TIERS["pro"]["monthlyUsd"])
    SERVICE_CONFIG["pro_price_yearly"] = float(_TIERS["pro"]["yearlyUsd"])
except (ImportError, KeyError, TypeError, ValueError):
    pass
ENV = os.getenv("ENV", "development").lower()
APP_ENV = os.getenv("APP_ENV", "local").lower()
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://plainsmansoftware.com").rstrip("/")
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")
JWT_SECRET = os.getenv("JWT_SECRET", "")
ADMIN_KEY = os.getenv("ADMIN_KEY", "")
TELEMETRY_READ_KEY = os.getenv("TELEMETRY_READ_KEY", "")
ADMIN_DB_WRITE = os.getenv("ADMIN_DB_WRITE", "") == "1"
ADMIN_IP_ALLOWLIST = {
    item.strip() for item in os.getenv("ADMIN_IP_ALLOWLIST", "").split(",") if item.strip()
}
TOKEN_TTL_SECONDS = min(int(os.getenv("ACCESS_TOKEN_DAYS", "30")), 30) * 86400
MAX_BODY_BYTES = 256 * 1024
TICKET_RE = re.compile(r"^[A-Za-z0-9_-]{20,128}$")
STATIC_DIR = Path(__file__).resolve().parent / "static"
_DUMMY_PASSWORD_HASH = hash_password("Dummy-password-9fY!3jQx")

if ENV != "development":
    for name, value in (
        ("JWT_SECRET", JWT_SECRET),
        ("ADMIN_KEY", ADMIN_KEY),
        ("TELEMETRY_READ_KEY", TELEMETRY_READ_KEY),
    ):
        if len(value.encode("utf-8")) < 32 or value.lower().startswith("change"):
            raise RuntimeError(f"{name} must be at least 32 bytes and non-default")
    if secrets.compare_digest(ADMIN_KEY, TELEMETRY_READ_KEY):
        raise RuntimeError("ADMIN_KEY and TELEMETRY_READ_KEY must differ")
elif not JWT_SECRET:
    JWT_SECRET = secrets.token_hex(32)
    logger.warning("JWT_SECRET unset; development tokens reset on restart")

assert_stripe_keys_match_env(APP_ENV, STRIPE_SECRET_KEY)
assert_database_isolation(
    APP_ENV,
    DATABASE_URL,
    os.getenv("EXPECTED_DB_HOST", ""),
    os.getenv("EXPECTED_DB_HOST_LLE", ""),
    os.getenv("EXPECTED_DB_HOST_PROD", ""),
)
if APP_ENV in ("lle", "prod") and not os.getenv("STRIPE_WEBHOOK_EVENTS_CONFIRMED"):
    logger.warning(
        "STRIPE_WEBHOOK_EVENTS_CONFIRMED is unset. Subscribe checkout.session.completed, "
        "customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, "
        "invoice.paid, and invoice.payment_failed."
    )
stripe.api_key = STRIPE_SECRET_KEY
stripe.api_version = "2024-04-10"


def _verify_stripe_prices() -> None:
    if APP_ENV not in ("lle", "prod") or not STRIPE_SECRET_KEY or "pytest" in sys.modules:
        return
    checks = (
        (os.getenv("STRIPE_PRICE_PRO_MONTHLY") or os.getenv("STRIPE_PRICE_TIKTOK_SELLER"), 14.99, "month"),
        (os.getenv("STRIPE_PRICE_PRO_YEARLY") or os.getenv("STRIPE_PRICE_TIKTOK_SELLER_YEARLY"), 120, "year"),
        (os.getenv("STRIPE_PRICE_DIAMOND_MONTHLY"), 39, "month"),
        (os.getenv("STRIPE_PRICE_DIAMOND_YEARLY"), 349, "year"),
    )
    problems: list[str] = []
    for price_id, usd, interval in checks:
        if not price_id:
            continue
        price = stripe.Price.retrieve(price_id)
        recurring = price.get("recurring") or {}
        if not price_amount_matches(
            int(price.get("unit_amount") or 0),
            str(recurring.get("interval") or ""),
            usd,
            interval,
        ):
            problems.append(str(price_id))
    if not problems:
        return
    message = "Stripe prices do not match tiers.json: " + ", ".join(problems)
    if APP_ENV == "lle":
        raise RuntimeError(message)
    logger.error(message)


_verify_stripe_prices()
init_db()


def _client_ip(request: Request) -> str:
    return client_ip(request)


class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        length = request.headers.get("content-length")
        if length:
            try:
                if int(length) > MAX_BODY_BYTES:
                    return JSONResponse({"error": "Request body too large"}, status_code=413)
            except ValueError:
                return JSONResponse({"error": "Invalid Content-Length"}, status_code=400)
        if request.method in {"POST", "PUT", "PATCH"}:
            body = await request.body()
            if len(body) > MAX_BODY_BYTES:
                return JSONResponse({"error": "Request body too large"}, status_code=413)
            request._body = body
        response = await call_next(request)
        is_html = response.headers.get("content-type", "").startswith("text/html")
        if is_html and request.url.path == "/ops":
            csp = "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'"
        elif is_html:
            csp = "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'"
        else:
            csp = "default-src 'none'; object-src 'none'; frame-ancestors 'none'"
        response.headers["Content-Security-Policy"] = csp
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        if ENV == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    max_keys = 50_000
    limits = {
        "/auth/login": 10,
        "/auth/register": 5,
        "/auth/forgot-password": 3,
        "/auth/reset": 3,
        "/auth/verify-email": 10,
        "/trends/events": 30,
        "/telemetry/error": 30,
        "/support/ticket": 5,
        "/insights/review-summary": 30,
    }

    def __init__(self, app):
        super().__init__(app)
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def prune_buckets(self, now: float) -> None:
        stale = [
            key
            for key, bucket in self.hits.items()
            if not bucket or now - bucket[-1] >= 60
        ]
        for key in stale:
            del self.hits[key]
        overflow = len(self.hits) - self.max_keys
        if overflow <= 0:
            return
        oldest = sorted(
            self.hits,
            key=lambda key: self.hits[key][0] if self.hits[key] else 0,
        )
        for key in oldest[:overflow]:
            del self.hits[key]

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path == "/billing/webhook":
            return await call_next(request)
        limit = 10 if path.startswith("/billing/") else self.limits.get(path, 120)
        email = ""
        if path in self.limits:
            body = await request.body()
            request._body = body
            try:
                email = normalize_email(str(json.loads(body or b"{}").get("email", "")))[:254]
            except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
                email = ""
        key = f"{_client_ip(request)}:{path}:{email}"
        now = time.time()
        self.prune_buckets(now)
        bucket = self.hits[key]
        while bucket and now - bucket[0] >= 60:
            bucket.popleft()
        if len(bucket) >= limit:
            return JSONResponse(
                {"error": "Too many requests"},
                status_code=429,
                headers={"Retry-After": str(max(1, int(60 - (now - bucket[0]))))},
            )
        bucket.append(now)
        return await call_next(request)


def _extension_origins() -> list[str]:
    origins = []
    for ext_id in os.getenv("EXTENSION_IDS", "").split(","):
        ext_id = ext_id.strip()
        if re.fullmatch(r"[a-z]{32}", ext_id):
            origins.append(f"chrome-extension://{ext_id}")
    if ENV != "production":
        origins += ["http://localhost:5173", "http://127.0.0.1:5173"]
    return origins


app = FastAPI(
    title="MarginMark API",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.add_middleware(SecurityMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_extension_origins(),
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=False,
)


@app.exception_handler(Exception)
def unhandled_exception(_request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        return JSONResponse(
            {"error": exc.detail if isinstance(exc.detail, str) else "Request failed"},
            status_code=exc.status_code,
            headers=exc.headers or {},
        )
    logger.exception("Unhandled MarginMark API error")
    return JSONResponse({"error": "Internal server error"}, status_code=500)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AuthReq(StrictModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class ForgotPasswordReq(StrictModel):
    email: str = Field(min_length=3, max_length=254)


class ProfileReq(StrictModel):
    display_name: Optional[str] = Field(default=None, max_length=80)
    email: Optional[str] = Field(default=None, max_length=254)


class ChangePasswordReq(StrictModel):
    current_password: str = Field(default="", max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class OAuthTicketReq(StrictModel):
    ticket: str = Field(min_length=20, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")


class CheckoutReq(StrictModel):
    service: str = Field(default=SERVICE, max_length=32)
    billing_interval: str = Field(default="monthly", pattern=r"^(monthly|yearly)$")
    plan: str = Field(default="pro", pattern=r"^(pro|diamond)$")

    @field_validator("service")
    @classmethod
    def only_marginmark(cls, value: str) -> str:
        if value != SERVICE:
            raise ValueError("Unknown service")
        return value


class PromoRedeemReq(StrictModel):
    service: str = Field(default=SERVICE, max_length=32)
    code: str = Field(min_length=4, max_length=32)


class SupportTicketReq(StrictModel):
    service: str = Field(default=SERVICE, max_length=32)
    email: str = Field(min_length=3, max_length=254)
    subject: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=4000)
    kind: str = Field(default="support", max_length=16)

    @field_validator("service")
    @classmethod
    def only_marginmark(cls, value: str) -> str:
        if value != SERVICE:
            raise ValueError("Unknown service")
        return value

    @field_validator("kind")
    @classmethod
    def known_kind(cls, value: str) -> str:
        kind = value.strip().lower()
        if kind not in support_mail.TICKET_KINDS:
            raise ValueError("Unknown ticket kind")
        return kind


class TelemetryEventReq(StrictModel):
    service: str = Field(default=SERVICE, max_length=32)
    event: str = Field(min_length=1, max_length=64)
    properties: dict[str, Any] = Field(default_factory=dict)

    @field_validator("properties")
    @classmethod
    def props_under_limit(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(value, separators=(",", ":")).encode("utf-8")) > 4096:
            raise ValueError("properties exceeds 4 KB")
        return value


class AdminPromoReq(StrictModel):
    code: str = Field(min_length=4, max_length=32)
    service: str = Field(default=SERVICE, max_length=32)
    duration_days: int = Field(default=30, ge=1, le=366)
    max_redemptions: Optional[int] = Field(default=None, ge=1)


class AdminConfigReq(StrictModel):
    service: str = Field(default=SERVICE, max_length=32)
    key: str = Field(min_length=1, max_length=64)
    value: str = Field(max_length=4000)


class AdminDbWriteReq(StrictModel):
    table: str = Field(min_length=1, max_length=64)
    values: dict[str, Any] = Field(default_factory=dict)
    pk: Optional[dict[str, Any]] = None


class AdminUserPatchReq(StrictModel):
    email: Optional[str] = Field(default=None, max_length=254)
    password: Optional[str] = Field(default=None, max_length=128)
    stripe_customer_id: Optional[str] = Field(default=None, max_length=255)
    clear_stripe_customer: bool = False
    service: str = Field(default=SERVICE, max_length=32)
    status: Optional[str] = Field(default=None, pattern=r"^(active|free)$")
    stripe_sub_id: Optional[str] = Field(default=None, max_length=255)
    promo_expires_at: Optional[str] = Field(default=None, max_length=64)
    clear_stripe_sub: bool = False
    clear_promo: bool = False
    promo_code: Optional[str] = Field(default=None, max_length=32)


def _b64_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64_decode(raw: str) -> bytes:
    return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))


def make_token(uid: int, token_version: Optional[int] = None, *, now: Optional[int] = None) -> str:
    issued = int(now if now is not None else time.time())
    if token_version is None:
        db = get_db()
        row = db.execute("SELECT token_version FROM users WHERE id=?", (uid,)).fetchone()
        db.close()
        token_version = int(row["token_version"]) if row else 0
    payload = _b64_encode(
        json.dumps(
            {
                "sub": str(uid),
                "iat": issued,
                "exp": issued + TOKEN_TTL_SECONDS,
                "ver": int(token_version),
            },
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    )
    signature = _b64_encode(
        hmac.new(JWT_SECRET.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest()
    )
    return f"{payload}.{signature}"


def verify_token(token: str, *, now: Optional[int] = None) -> Optional[int]:
    try:
        payload, supplied = token.split(".", 1)
        expected = _b64_encode(
            hmac.new(JWT_SECRET.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(supplied, expected):
            return None
        claims = json.loads(_b64_decode(payload).decode("utf-8"))
        current = int(now if now is not None else time.time())
        uid = int(claims["sub"])
        if int(claims["iat"]) > current + 60 or int(claims["exp"]) <= current:
            return None
        db = get_db()
        row = db.execute("SELECT token_version FROM users WHERE id=?", (uid,)).fetchone()
        db.close()
        if not row or int(claims["ver"]) != int(row["token_version"]):
            return None
        return uid
    except (
        ValueError,
        KeyError,
        TypeError,
        json.JSONDecodeError,
        binascii.Error,
        UnicodeDecodeError,
    ):
        return None


security = HTTPBearer()


def current_user(creds: HTTPAuthorizationCredentials = Depends(security)) -> dict[str, Any]:
    uid = verify_token(creds.credentials)
    if uid is None:
        raise HTTPException(401, "Invalid or expired token")
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    db.close()
    if not row:
        raise HTTPException(401, "User not found")
    return dict(row)


def _sub_status(row: Optional[dict[str, Any]]) -> str:
    if not row:
        return "free"
    if row.get("status") == "past_due" and row.get("past_due_since"):
        try:
            started = datetime.fromisoformat(str(row["past_due_since"]).replace("Z", "+00:00"))
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - started <= timedelta(days=3):
                return "active"
        except ValueError:
            pass
    return promo_mod.effective_sub_status(row)


def _set_sub(
    uid: int,
    status: str,
    stripe_sub_id: Optional[str] = None,
    *,
    past_due_since: Optional[str] = None,
    tier: Optional[str] = None,
    db: Optional[Any] = None,
) -> int:
    own = db is None
    if own:
        db = get_db()
    # A new Stripe subscription must not inherit cancel fields from the previous one.
    reset_live_fields = False
    if stripe_sub_id:
        prior = db.execute(
            "SELECT stripe_sub_id FROM subscriptions WHERE user_id=? AND service=?",
            (uid, SERVICE),
        ).fetchone()
        stored = prior["stripe_sub_id"] if prior else None
        reset_live_fields = bool(stored) and str(stored) != str(stripe_sub_id)
    if reset_live_fields:
        cur = db.execute(
            """
            UPDATE subscriptions
               SET status=?,
                   stripe_sub_id=?,
                   past_due_since=?,
                   tier=COALESCE(?, tier),
                   stripe_status=NULL,
                   current_period_end=NULL,
                   interval=NULL,
                   amount_cents=NULL
             WHERE user_id=? AND service=?
            """,
            (status, stripe_sub_id, past_due_since, tier, uid, SERVICE),
        )
    else:
        cur = db.execute(
            """
            INSERT INTO subscriptions
              (user_id, service, status, stripe_sub_id, past_due_since, tier)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(user_id, service) DO UPDATE SET
              status=?,
              stripe_sub_id=COALESCE(?, subscriptions.stripe_sub_id),
              past_due_since=?,
              tier=COALESCE(?, subscriptions.tier)
            """,
            (
                uid,
                SERVICE,
                status,
                stripe_sub_id,
                past_due_since,
                tier,
                status,
                stripe_sub_id,
                past_due_since,
                tier,
            ),
        )
    written = max(int(cur.rowcount or 0), 0)
    if own:
        db.commit()
        db.close()
    return written


def _emit(event: str, data: Optional[dict[str, Any]] = None, *, user_id: Optional[int] = None) -> None:
    scrubbed = _scrub_props(data or {})
    try:
        db = get_db()
        db.execute(
            """INSERT INTO telemetry_events (ts, service, event, user_id, payload_json, source)
               VALUES (?,?,?,?,?,?)""",
            (
                datetime.now(timezone.utc).isoformat(),
                SERVICE,
                event[:64],
                user_id,
                json.dumps(scrubbed, separators=(",", ":")),
                "extension" if event in TELEMETRY_EVENTS else "server",
            ),
        )
        db.commit()
        db.close()
    except Exception:
        logger.warning("Telemetry persist failed", exc_info=True)


TELEMETRY_EVENTS = frozenset(
    {
        "overlay.shown",
        "scrape.result",
        "cost.first_entered",
        "sku.limit_hit",
        "upgrade.clicked",
        "user.registered",
        "checkout.created",
        "subscription.state_changed",
        "auth.login",
        "auth.register",
        "onboarding.step",
        "bulk_cost.imported",
        "statement.imported",
        "creator.imported",
        "promo_guard.shown",
        "checkin.viewed",
        "value_receipt.viewed",
    }
)
_SENSITIVE_PROP = re.compile(r"(email|url|href|password|token|secret|authorization|jwt)", re.I)


def _scrub_props(props: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in props.items():
        if _SENSITIVE_PROP.search(str(key)):
            continue
        if isinstance(value, bool) or (
            isinstance(value, (int, float)) and not isinstance(value, bool)
        ):
            out[str(key)[:64]] = value
        elif isinstance(value, str):
            if "://" in value or re.search(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
                continue
            out[str(key)[:64]] = value[:256]
    return out


def _oauth_base(request: Request) -> str:
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL
    if ENV == "production":
        raise HTTPException(503, "PUBLIC_BASE_URL is required")
    return str(request.base_url).rstrip("/")


def _oauth_redirect(
    error: Optional[str] = None,
    ticket: Optional[str] = None,
    client: Optional[str] = None,
) -> RedirectResponse:
    if ticket:
        url = f"/auth/oauth/done?ticket={quote(ticket, safe='')}"
        ext = oauth_mod.normalize_ext_id(client)
        if ext:
            url += f"&client={quote(ext, safe='')}"
        return RedirectResponse(url, status_code=302)
    return RedirectResponse(
        f"/auth/oauth/done?error={quote(error or 'invalid', safe='')}",
        status_code=302,
    )


def _oauth_done_html(
    error: Optional[str], ticket: Optional[str], client: Optional[str]
) -> HTMLResponse:
    ok = not error
    heading = "You're signed in" if ok else "Sign-in could not finish"
    ext = oauth_mod.normalize_ext_id(client)
    body = (
        f"<p>{html.escape(oauth_mod.done_message(error))}</p>"
        + ("<p>You can close this tab and go back to Seller Center.</p>" if ok else "")
        + f'<div id="tst-oauth-ticket" data-ticket="{html.escape(ticket or "", quote=True)}" '
        f'data-ext="{html.escape(ext, quote=True)}" hidden></div>'
    )
    doc, _ = web_pages.page(
        title=heading,
        heading=heading,
        body_html=body,
        tone="ok" if ok else "error",
        head_extra='<script src="/static/oauth-done.js" defer></script>',
    )
    return HTMLResponse(doc, status_code=200 if ok else 400)


@app.get("/health")
def health():
    body: dict[str, Any] = {
        "status": "ok",
        "app_env": APP_ENV,
        "commit": (os.getenv("GIT_SHA") or "").strip() or "unknown",
        "service": SERVICE,
        "db": "postgres" if USE_POSTGRES else "sqlite",
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    if ENV != "production":
        body["db_path"] = None if USE_POSTGRES else DB_PATH
    return body


@app.post("/auth/register")
def register(req: AuthReq):
    email = normalize_email(req.email)
    if "@" not in email:
        raise HTTPException(400, "Enter a valid email")
    try:
        validate_password(req.password)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    db = get_db()
    if db.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone():
        db.close()
        raise HTTPException(400, "Email already registered")
    cur = db.execute(
        "INSERT INTO users (email,password_hash) VALUES (?,?)",
        (email, hash_password(req.password)),
    )
    uid = int(cur.lastrowid)
    sent = False
    if support_mail.smtp_ready():
        code = account_flow.issue_email_code(db, uid)
        sent = support_mail.send_transactional(
            email,
            "Your MarginMark code",
            f"Your MarginMark code is {code}. It expires in 15 minutes.",
        )
    db.commit()
    db.close()
    _emit("user.registered", user_id=uid)
    return {"access_token": make_token(uid), "email_verification_sent": sent}


@app.post("/auth/login")
def login(req: AuthReq):
    email = normalize_email(req.email)
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    password_hash = user["password_hash"] if user else _DUMMY_PASSWORD_HASH
    valid = verify_password(req.password, password_hash)
    if not user or not valid:
        db.close()
        raise HTTPException(401, "Invalid email or password")
    if needs_rehash(user["password_hash"]):
        db.execute(
            "UPDATE users SET password_hash=? WHERE id=?",
            (hash_password(req.password), user["id"]),
        )
        db.commit()
    uid = int(user["id"])
    version = int(user["token_version"])
    db.close()
    _emit("auth.login", user_id=uid)
    return {"access_token": make_token(uid, version)}


class DeleteAccountReq(BaseModel):
    confirm: str
    password: str = ""


_NAME_RE = re.compile(r"^[\w .'-]{0,80}$", re.UNICODE)


@app.post("/auth/profile")
def update_profile(req: ProfileReq, user: dict[str, Any] = Depends(current_user)):
    sets: list[str] = []
    values: list[Any] = []
    if req.display_name is not None:
        name = req.display_name.strip()
        if name and not _NAME_RE.fullmatch(name):
            raise HTTPException(400, "Name can use letters, numbers, spaces, and . ' -")
        sets.append("display_name=?")
        values.append(name)
    if req.email is not None:
        email = normalize_email(req.email)
        if "@" not in email:
            raise HTTPException(400, "Enter a valid email")
        if email != normalize_email(str(user["email"])):
            db = get_db()
            taken = db.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
            db.close()
            if taken:
                raise HTTPException(400, "Email already registered")
            sets.append("email=?")
            values.append(email)
            # A new address has to be verified again before checkout.
            sets.append("email_verified_at=NULL")
    if not sets:
        return {"ok": True, "email": user["email"], "display_name": (user.get("display_name") or "").strip()}
    values.append(user["id"])
    db = get_db()
    db.execute(f"UPDATE users SET {', '.join(sets)} WHERE id=?", tuple(values))
    db.commit()
    row = db.execute("SELECT email, display_name FROM users WHERE id=?", (user["id"],)).fetchone()
    db.close()
    return {
        "ok": True,
        "email": row["email"],
        "display_name": (row["display_name"] or "").strip(),
    }


@app.post("/auth/change-password")
def change_password(req: ChangePasswordReq, user: dict[str, Any] = Depends(current_user)):
    try:
        validate_password(req.new_password)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    db = get_db()
    row = db.execute("SELECT password_hash FROM users WHERE id=?", (user["id"],)).fetchone()
    oauth = db.execute(
        "SELECT 1 FROM oauth_identities WHERE user_id=? LIMIT 1",
        (user["id"],),
    ).fetchone()
    current_ok = bool(req.current_password) and row is not None and verify_password(
        req.current_password, row["password_hash"]
    )
    if not current_ok and not (oauth and not req.current_password):
        db.close()
        raise HTTPException(400, "Current password is wrong.")
    # New password: every other session and stolen token stops working. This
    # session gets a fresh token so the seller isn't logged out mid-work.
    db.execute(
        "UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?",
        (hash_password(req.new_password), user["id"]),
    )
    db.commit()
    db.close()
    return {"ok": True, "access_token": make_token(int(user["id"]))}


@app.post("/auth/delete-account")
def delete_account(req: DeleteAccountReq, user: dict[str, Any] = Depends(current_user)):
    if req.confirm != "DELETE":
        raise HTTPException(400, "Type DELETE to confirm")
    db = get_db()
    row = db.execute("SELECT password_hash FROM users WHERE id=?", (user["id"],)).fetchone()
    oauth = db.execute(
        "SELECT provider FROM oauth_identities WHERE user_id=?",
        (user["id"],),
    ).fetchone()
    password_ok = bool(req.password) and row is not None and verify_password(req.password, row["password_hash"])
    try:
        if not password_ok and not oauth:
            raise HTTPException(401, "Enter your password to delete this account")
        from admin_db import delete_user

        delete_user(db, int(user["id"]))
    finally:
        db.close()
    return {"ok": True}


RESET_SENT = "If that account exists, reset instructions were sent."
RESET_UNAVAILABLE = (
    "Password reset is not available yet. Contact support@plainsmansoftware.com"
)
VERIFY_REQUIRED = "Verify your email to start your trial"


@app.get("/auth/providers")
def auth_providers():
    return {"providers": oauth_mod.enabled_sign_in_providers()}


@app.post("/auth/forgot-password")
def forgot_password(req: ForgotPasswordReq, request: Request):
    email = normalize_email(req.email)
    if "@" not in email:
        raise HTTPException(400, "Enter a valid email")
    if not support_mail.smtp_ready():
        raise HTTPException(503, RESET_UNAVAILABLE)
    db = get_db()
    try:
        user = db.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
        if user:
            token = account_flow.issue_password_reset(db, int(user["id"]))
            link = f"{_oauth_base(request)}/auth/reset?token={quote(token, safe='')}"
            support_mail.send_transactional(
                email,
                "Reset your MarginMark password",
                f"Set a new password within 30 minutes:\n{link}\n\nIf you did not ask for this, ignore this email.",
            )
        db.commit()
    finally:
        db.close()
    return {"ok": True, "message": RESET_SENT}


def _reset_form(token: str, message: str = "") -> HTMLResponse:
    doc, status = web_pages.reset_form(token, message)
    return HTMLResponse(doc, status_code=status)


def _reset_invalid() -> HTMLResponse:
    doc, status = web_pages.reset_invalid()
    return HTMLResponse(doc, status_code=status)


@app.get("/auth/reset")
def reset_password_form(token: str = ""):
    if not token:
        return _reset_invalid()
    return _reset_form(token)


@app.post("/auth/reset")
async def reset_password(request: Request):
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        payload = await request.json()
        token = str(payload.get("token") or "")
        password = str(payload.get("password") or "")
    else:
        from urllib.parse import parse_qs

        raw = (await request.body()).decode("utf-8", errors="replace")
        form = parse_qs(raw)
        token = (form.get("token") or [""])[0]
        password = (form.get("password") or [""])[0]
        confirm = form.get("confirm")
        if confirm is not None and confirm[0] != password:
            return _reset_form(token, "The two passwords don't match.")
    try:
        validate_password(password)
    except ValueError as exc:
        if "application/json" in content_type:
            raise HTTPException(400, str(exc)) from exc
        return _reset_form(token, str(exc))
    db = get_db()
    try:
        uid = account_flow.take_password_reset(db, token)
        if uid is None:
            db.commit()
            if "application/json" in content_type:
                raise HTTPException(400, "This reset link is invalid or expired.")
            return _reset_invalid()
        db.execute(
            "UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?",
            (hash_password(password), uid),
        )
        db.commit()
    finally:
        db.close()
    if "application/json" in content_type:
        return {"ok": True}
    doc, _status = web_pages.reset_done()
    return HTMLResponse(doc)


class VerifyEmailReq(BaseModel):
    code: str = Field(min_length=4, max_length=12)


@app.post("/auth/verify-email")
def verify_email(req: VerifyEmailReq, user: dict[str, Any] = Depends(current_user)):
    db = get_db()
    try:
        result = account_flow.check_email_code(db, int(user["id"]), req.code)
        db.commit()
    finally:
        db.close()
    if result == "ok":
        return {"ok": True, "email_verified": True}
    if result == "locked":
        raise HTTPException(429, "Too many attempts. Request a new code.")
    if result == "expired":
        raise HTTPException(400, "That code expired. Request a new one.")
    raise HTTPException(400, "That code does not match.")


@app.post("/auth/verify-email/resend")
def resend_verify_email(user: dict[str, Any] = Depends(current_user)):
    if user.get("email_verified_at"):
        return {"ok": True, "email_verification_sent": False}
    if not support_mail.smtp_ready():
        raise HTTPException(503, RESET_UNAVAILABLE)
    db = get_db()
    try:
        if not account_flow.resend_allowed(db, int(user["id"])):
            raise HTTPException(429, "Wait 60 seconds before sending another code.")
        code = account_flow.issue_email_code(db, int(user["id"]))
        sent = support_mail.send_transactional(
            str(user["email"]),
            "Your MarginMark code",
            f"Your MarginMark code is {code}. It expires in 15 minutes.",
        )
        db.commit()
    finally:
        db.close()
    return {"ok": True, "email_verification_sent": sent}


@app.post("/auth/refresh")
def refresh_token(user: dict[str, Any] = Depends(current_user)):
    return {"access_token": make_token(int(user["id"]), int(user["token_version"]))}


@app.post("/auth/sign-out-everywhere")
def sign_out_everywhere(user: dict[str, Any] = Depends(current_user)):
    db = get_db()
    db.execute("UPDATE users SET token_version=token_version+1 WHERE id=?", (user["id"],))
    db.commit()
    db.close()
    return {"ok": True}


@app.get("/auth/oauth/done")
def oauth_done(
    ticket: Optional[str] = None,
    error: Optional[str] = None,
    client: Optional[str] = None,
):
    return _oauth_done_html(None if ticket else (error or "invalid"), ticket, client)


@app.get("/auth/oauth/{provider}")
def oauth_start(provider: str, request: Request, mode: str = "login", client: str = ""):
    provider = provider.lower()
    if provider not in oauth_mod.PROVIDERS:
        return _oauth_redirect("invalid")
    try:
        state, challenge = oauth_mod.create_flow(
            provider,
            mode if mode in ("login", "signup") else "login",
            oauth_mod.normalize_ext_id(client),
        )
        url = oauth_mod.authorize_url(
            provider,
            public_base=_oauth_base(request),
            state=state,
            code_challenge=challenge,
        )
        return RedirectResponse(url, status_code=302)
    except oauth_mod.OAuthError as exc:
        return _oauth_redirect(exc.code)


@app.get("/auth/oauth/{provider}/callback")
async def oauth_callback(
    provider: str,
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
):
    provider = provider.lower()
    if provider not in oauth_mod.PROVIDERS:
        return _oauth_redirect("invalid")
    if error or not code or not state:
        return _oauth_redirect("denied" if error == "access_denied" else "invalid")
    try:
        verifier, client = oauth_mod.pop_flow(state, provider)
        profile = await oauth_mod.exchange_code_for_profile(
            provider,
            public_base=_oauth_base(request),
            code=code,
            code_verifier=verifier,
        )
        uid, created = oauth_mod.find_or_create_oauth_user(profile)
        _emit("auth.oauth_register" if created else "auth.oauth_login", user_id=uid)
        return _oauth_redirect(ticket=oauth_mod.issue_ticket(uid), client=client)
    except oauth_mod.OAuthError as exc:
        return _oauth_redirect(exc.code)


@app.post("/auth/oauth/exchange")
def oauth_exchange(req: OAuthTicketReq):
    uid = oauth_mod.consume_ticket(req.ticket)
    if uid is None:
        raise HTTPException(401, "Sign-in expired. Try again from the extension.")
    return {"access_token": make_token(uid)}


def _stripe_value(obj: Any, key: str) -> Any:
    if isinstance(obj, dict):
        return obj.get(key)
    getter = getattr(obj, "get", None)
    if callable(getter):
        return getter(key)
    return getattr(obj, key, None)


def _items_data(obj: Any) -> list:
    items = _stripe_value(obj, "items")
    data = _stripe_value(items, "data") if items is not None else None
    return data if isinstance(data, list) else []


def _period_end_unix(obj: Any) -> Optional[int]:
    """Billing period end. API 2026-08-26.dahlia puts it on the subscription item."""
    raw = _stripe_value(obj, "current_period_end")
    if isinstance(raw, (int, float)):
        return int(raw)
    data = _items_data(obj)
    if not data:
        return None
    nested = _stripe_value(data[0], "current_period_end")
    return int(nested) if isinstance(nested, (int, float)) else None


def _map_stripe_status(status: Optional[str]) -> str:
    if status in ("active", "trialing"):
        return "active"
    if status == "past_due":
        return "past_due"
    return "free"


def _subscription_still_paid(sub: Any) -> bool:
    status = _stripe_value(sub, "status")
    if status in ("active", "trialing", "past_due"):
        return True
    ends = [
        raw
        for key in ("trial_end", "cancel_at")
        if isinstance((raw := _stripe_value(sub, key)), (int, float))
    ]
    period_end = _period_end_unix(sub)
    if period_end is not None:
        ends.append(period_end)
    return bool(ends) and max(ends) > time.time()


def _checkout_pending(started_at: Optional[str]) -> bool:
    if not started_at:
        return False
    try:
        started = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
    except ValueError:
        return False
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - started <= timedelta(hours=2)


def _tier_keeping_diamond(current: Optional[str], mapped: Optional[str]) -> str:
    if current == "diamond" and mapped != "diamond":
        return "diamond"
    if mapped in ("pro", "diamond"):
        return mapped
    if current in ("pro", "diamond"):
        return current
    return "free"


def _price_id_of(sub: Any) -> Optional[str]:
    items = _stripe_value(sub, "items")
    data = _stripe_value(items, "data") if items is not None else None
    if data is None and isinstance(items, dict):
        data = items.get("data")
    first = (data or [None])[0]
    price = _stripe_value(first, "price") if first is not None else None
    raw = _stripe_value(price, "id") if price is not None else None
    return str(raw) if raw else None


def _pull_active_stripe_sub(user_id: int, session_id: Optional[str] = None) -> None:
    """Copy a paid Stripe subscription that belongs to this account.

    Only the stored customer id is used. Email lookup is not. Stripe is
    called after a recent checkout, or when the return URL includes a
    Checkout Session that names this user.
    """
    db = get_db()
    try:
        row = db.execute(
            "SELECT stripe_customer_id, checkout_started_at FROM users WHERE id=?",
            (user_id,),
        ).fetchone()
        existing = db.execute(
            "SELECT status, stripe_sub_id, tier FROM subscriptions WHERE user_id=? AND service=?",
            (user_id, SERVICE),
        ).fetchone()
    finally:
        db.close()
    if not row:
        return
    cid = row["stripe_customer_id"]
    current_tier = existing["tier"] if existing else None
    pending = _checkout_pending(row["checkout_started_at"])
    if session_id:
        if not STRIPE_SECRET_KEY:
            return
        try:
            session = stripe.checkout.Session.retrieve(session_id)
        except stripe.error.StripeError:
            logger.warning("Stripe session lookup failed")
            return
        if str(_stripe_value(session, "client_reference_id") or "") != str(user_id):
            return
        pending = True
        session_customer = _stripe_value(session, "customer")
        if session_customer and not cid:
            cid = str(session_customer)
            write = get_db()
            write.execute(
                "UPDATE users SET stripe_customer_id=? WHERE id=?",
                (cid, user_id),
            )
            write.commit()
            write.close()
    if not pending or not cid or not STRIPE_SECRET_KEY:
        return
    if existing and existing["status"] == "active" and existing["stripe_sub_id"] and not session_id:
        return
    try:
        listed = stripe.Subscription.list(customer=cid, status="all", limit=10)
    except stripe.error.StripeError:
        logger.warning("Stripe subscription lookup failed")
        return
    data = getattr(listed, "data", None)
    if data is None and isinstance(listed, dict):
        data = listed.get("data") or []
    for sub in data or []:
        if not _subscription_still_paid(sub):
            continue
        from tiers import tier_for_price

        tier = _tier_keeping_diamond(current_tier, tier_for_price(_price_id_of(sub)))
        _set_sub(user_id, "active", _stripe_value(sub, "id"), tier=tier)
        write = get_db()
        write.execute("UPDATE users SET trial_used=1 WHERE id=?", (user_id,))
        write.commit()
        write.close()
        return


@app.get("/auth/me")
def me(
    service: str = SERVICE,
    session_id: Optional[str] = None,
    user: dict[str, Any] = Depends(current_user),
):
    if service != SERVICE:
        raise HTTPException(400, "Unknown service")
    _pull_active_stripe_sub(int(user["id"]), session_id)
    db = get_db()
    sub = db.execute(
        """SELECT status, stripe_sub_id, promo_expires_at, past_due_since,
                  tier, tier_override, tier_override_expires_at,
                  interval, stripe_status, current_period_end
           FROM subscriptions WHERE user_id=? AND service=?""",
        (user["id"], SERVICE),
    ).fetchone()
    oauth_row = db.execute(
        "SELECT provider FROM oauth_identities WHERE user_id=? LIMIT 1",
        (user["id"],),
    ).fetchone()
    db.close()
    tier = _effective_plan(sub)
    is_pro = tier in ("pro", "diamond")
    sub_dict = dict(sub) if sub else {}
    return {
        "id": user["id"],
        "email": user["email"],
        "display_name": (user.get("display_name") or "").strip(),
        "service": SERVICE,
        "is_pro": is_pro,
        "tier": tier,
        "subscription_status": "active" if is_pro else "free",
        "promo_expires_at": sub.get("promo_expires_at") if sub and is_pro else None,
        "has_stripe": bool(sub and sub.get("stripe_sub_id")),
        "email_verified": bool(user.get("email_verified_at")),
        "usage_limit": -1 if is_pro else SERVICE_CONFIG["free_limit"],
        "pro_price": SERVICE_CONFIG["pro_price_monthly"],
        "pro_price_yearly": SERVICE_CONFIG["pro_price_yearly"],
        # Additive plan details for the account screen. Older builds ignore them.
        "plan_interval": (sub_dict.get("interval") or None) if is_pro else None,
        "plan_status": (sub_dict.get("stripe_status") or ("active" if is_pro else None)) if is_pro else None,
        "current_period_end": (sub_dict.get("current_period_end") or None) if is_pro else None,
        "trial_available": not bool(user.get("trial_used")),
        "has_oauth": bool(oauth_row),
        "oauth_provider": (oauth_row["provider"] if oauth_row else None),
    }


def _effective_plan(sub: Any) -> str:
    """Single source of truth for Free / Pro / Diamond (API, admin, v1 routes)."""
    from tiers import effective_tier

    row = dict(sub) if sub else None
    active = _sub_status(row) == "active"
    return effective_tier(row, active=active)


def _return_base() -> str:
    return PUBLIC_BASE_URL or FRONTEND_URL


_BILLING_OFF = "Billing is not configured. Nothing was charged."
_BILLING_DOWN = "Checkout could not start. Nothing was charged."


def _billing_json(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


@app.post("/billing/checkout")
def create_checkout(req: CheckoutReq, user: dict[str, Any] = Depends(current_user)):
    try:
        return _create_checkout(req, user)
    except stripe.error.StripeError as exc:
        logger.warning("Checkout stripe error: %s", exc.__class__.__name__)
        return _billing_json(502, _BILLING_DOWN)


def _create_checkout(req: CheckoutReq, user: dict[str, Any]):
    db = get_db()
    sub = db.execute(
        "SELECT status, stripe_sub_id, promo_expires_at, past_due_since FROM subscriptions WHERE user_id=? AND service=?",
        (user["id"], SERVICE),
    ).fetchone()
    cid_row = db.execute(
        "SELECT stripe_customer_id FROM users WHERE id=?", (user["id"],)
    ).fetchone()
    cid = cid_row["stripe_customer_id"]
    if _sub_status(sub) == "active" and cid:
        db.close()
        if not STRIPE_SECRET_KEY:
            return _billing_json(503, _BILLING_OFF)
        portal_session = stripe.billing_portal.Session.create(
            customer=cid,
            return_url=f"{_return_base()}/billing/done?ok=1",
        )
        return {"url": portal_session.url}
    if not user.get("email_verified_at"):
        db.close()
        raise HTTPException(403, VERIFY_REQUIRED)
    if not STRIPE_SECRET_KEY:
        db.close()
        return _billing_json(503, _BILLING_OFF)
    if not cid:
        db.close()
        customer = stripe.Customer.create(email=user["email"])
        cid = customer.id
        db = get_db()
        db.execute("UPDATE users SET stripe_customer_id=? WHERE id=?", (cid, user["id"]))
        db.commit()
    used_row = db.execute("SELECT trial_used FROM users WHERE id=?", (user["id"],)).fetchone()
    used = int((used_row or {}).get("trial_used") or 0)
    db.close()
    prior = 0
    if cid and STRIPE_SECRET_KEY:
        listed = stripe.Subscription.list(customer=cid, status="all", limit=1)
        data = getattr(listed, "data", None)
        if data is None and isinstance(listed, dict):
            data = listed.get("data") or []
        prior = len(data or [])
    from config_store import load_published
    from remote_doc import diamond_flag_enabled
    from tiers import price_id as tier_price_id

    if req.plan == "diamond" and not diamond_flag_enabled(load_published()):
        raise HTTPException(403, "Diamond is not available")
    price_id = tier_price_id(req.plan, req.billing_interval)
    if not price_id:
        raise HTTPException(400, "No Stripe price configured")
    allow_trial = req.plan == "pro" and trial_allowed(used, prior)
    extra = checkout_extra(SERVICE, trial_allowed=allow_trial)
    session = stripe.checkout.Session.create(
        customer=cid,
        client_reference_id=str(user["id"]),
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=f"{_return_base()}/billing/done?ok=1&session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{_return_base()}/billing/done?ok=0",
        metadata={"user_id": str(user["id"]), "service": SERVICE, "tier": req.plan, "price_id": price_id},
        managed_payments={"enabled": False},
        **extra,
    )
    started = get_db()
    started.execute(
        "UPDATE users SET checkout_started_at=? WHERE id=?",
        (datetime.now(timezone.utc).isoformat(), user["id"]),
    )
    started.commit()
    started.close()
    _emit("checkout.created", {"tier": req.plan, "interval": req.billing_interval}, user_id=int(user["id"]))
    return {"url": session.url}


@app.post("/billing/portal")
def billing_portal(user: dict[str, Any] = Depends(current_user)):
    db = get_db()
    row = db.execute(
        "SELECT stripe_customer_id FROM users WHERE id=?", (user["id"],)
    ).fetchone()
    db.close()
    if not row["stripe_customer_id"]:
        raise HTTPException(400, "No subscription found")
    if not STRIPE_SECRET_KEY:
        return _billing_json(503, _BILLING_OFF)
    try:
        session = stripe.billing_portal.Session.create(
            customer=row["stripe_customer_id"],
            return_url=f"{_return_base()}/billing/done?ok=1",
        )
    except stripe.error.StripeError as exc:
        logger.warning("Portal stripe error: %s", exc.__class__.__name__)
        return _billing_json(502, _BILLING_DOWN)
    return {"url": session.url}


@app.get("/billing/done")
def billing_done(ok: str = "1"):
    paid = ok not in ("0", "false", "cancel")
    doc, status = web_pages.billing_done(paid)
    return HTMLResponse(doc, status_code=status)


@app.post("/billing/promo")
def redeem_promo(req: PromoRedeemReq, user: dict[str, Any] = Depends(current_user)):
    if req.service != SERVICE:
        raise HTTPException(400, "Unknown service")
    db = get_db()
    try:
        result = promo_mod.redeem_promo(
            db, user_id=user["id"], service=SERVICE, code=req.code
        )
        db.commit()
        return result
    except promo_mod.PromoError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    finally:
        db.close()


def _apply_subscription_event(
    obj: dict[str, Any],
    mapped: str,
    past_due: Optional[str],
    db: Any,
) -> dict[str, Any]:
    sub_id = obj.get("id")
    items = _items_data(obj)
    price = _stripe_value(items[0], "price") if items else None
    amount = _stripe_value(price, "unit_amount") if price is not None else None
    interval = _stripe_value(_stripe_value(price, "recurring"), "interval") if price is not None else None
    stripe_status = obj.get("status")
    period_end = _period_end_unix(obj)
    end_iso = (
        datetime.fromtimestamp(period_end, timezone.utc).isoformat()
        if period_end is not None
        else None
    )
    previous = db.execute(
        "SELECT status, tier FROM subscriptions WHERE stripe_sub_id=?",
        (sub_id,),
    ).fetchone()
    from tiers import tier_for_price

    price_id = _stripe_value(price, "id") if price is not None else None
    next_tier = _tier_keeping_diamond(
        (previous or {}).get("tier"),
        tier_for_price(str(price_id) if price_id else None),
    )
    cur = db.execute(
        """UPDATE subscriptions
           SET status=?, past_due_since=?, amount_cents=?, interval=?, stripe_status=?, current_period_end=?, tier=?
           WHERE stripe_sub_id=?""",
        (mapped, past_due, amount, interval, stripe_status, end_iso, next_tier, sub_id),
    )
    return {
        "from": (previous or {}).get("status") or "free",
        "to": mapped,
        "tier": next_tier,
        "interval": interval or "",
        "rows": max(int(cur.rowcount or 0), 0),
    }


def invoice_subscription_id(obj: dict[str, Any]) -> Optional[str]:
    direct = obj.get("subscription")
    if isinstance(direct, str) and direct:
        return direct
    parent = obj.get("parent") or {}
    details = (parent.get("subscription_details") or {}) if isinstance(parent, dict) else {}
    nested = details.get("subscription")
    if isinstance(nested, str) and nested:
        return nested
    return None


def _stripe_object_dict(remote: Any) -> Optional[dict[str, Any]]:
    """Stripe 9 Subscription subclasses dict. Later majors do not."""
    recursive = getattr(remote, "to_dict_recursive", None)
    if callable(recursive):
        converted = recursive()
        if isinstance(converted, dict):
            return converted
    as_dict = getattr(remote, "to_dict", None)
    if callable(as_dict):
        converted = as_dict()
        if isinstance(converted, dict):
            return converted
    try:
        return dict(remote)
    except (TypeError, ValueError):
        return None


def _retrieve_subscription(sub_id: str) -> Optional[dict[str, Any]]:
    if not sub_id or not STRIPE_SECRET_KEY:
        return None
    try:
        remote = stripe.Subscription.retrieve(sub_id)
    except stripe.error.StripeError:
        logger.warning("webhook subscription retrieve failed sub=%s", sub_id)
        return None
    return _stripe_object_dict(remote)


def _stripe_row_canceled(db: Any, sub_id: str) -> bool:
    row = db.execute(
        "SELECT stripe_status FROM subscriptions WHERE stripe_sub_id=?",
        (sub_id,),
    ).fetchone()
    return bool(row) and str(row["stripe_status"] or "") == "canceled"


def _sync_subscription_event(
    db: Any, event_type: str, payload: Any
) -> tuple[int, str, Optional[str], Optional[dict[str, Any]], bool]:
    """Live Stripe subscription wins. A failed lookup must not revive a cancel."""
    if event_type.startswith("invoice."):
        sub_id = invoice_subscription_id(payload)
    else:
        raw_id = payload.get("id")
        sub_id = raw_id if isinstance(raw_id, str) else None
    if not sub_id:
        return 0, "-", None, None, False
    live = _retrieve_subscription(sub_id)
    if live is None and event_type != "customer.subscription.deleted" and _stripe_row_canceled(db, sub_id):
        payload_status = payload.get("status") if event_type.startswith("customer.subscription.") else None
        would_revive = event_type.startswith("invoice.") or _map_stripe_status(
            payload_status if isinstance(payload_status, str) else None
        ) != "free"
        if would_revive:
            return 0, "free", sub_id, None, False
    if live is None and event_type in ("invoice.paid", "invoice.payment_failed"):
        if event_type == "invoice.paid":
            cur = db.execute(
                "UPDATE subscriptions SET status='active', past_due_since=NULL WHERE stripe_sub_id=?",
                (sub_id,),
            )
            mapped = "active"
        else:
            cur = db.execute(
                "UPDATE subscriptions SET status='past_due', past_due_since=? WHERE stripe_sub_id=?",
                (datetime.now(timezone.utc).isoformat(), sub_id),
            )
            mapped = "past_due"
        written = max(int(cur.rowcount or 0), 0)
        return written, mapped, sub_id, None, written == 0
    source = dict(live if live is not None else payload)
    if event_type == "customer.subscription.deleted":
        source["id"] = sub_id
        source["status"] = "canceled"
    source.setdefault("id", sub_id)
    mapped = (
        "free"
        if event_type == "customer.subscription.deleted"
        else _map_stripe_status(source.get("status") if isinstance(source.get("status"), str) else None)
    )
    past_due = datetime.now(timezone.utc).isoformat() if mapped == "past_due" else None
    change = _apply_subscription_event(source, mapped, past_due, db)
    written = int(change.get("rows") or 0)
    state = change if event_type in ("customer.subscription.updated", "customer.subscription.created") else None
    return written, mapped, sub_id, state, written == 0


def _mark_event(event_id: str, event_type: str, db: Optional[Any] = None) -> bool:
    own = db is None
    if own:
        db = get_db()
    try:
        if db.execute("SELECT event_id FROM stripe_events WHERE event_id=?", (event_id,)).fetchone():
            return False
        db.execute(
            "INSERT INTO stripe_events (event_id, event_type) VALUES (?,?)",
            (event_id, event_type),
        )
        if own:
            db.commit()
        return True
    finally:
        if own:
            db.close()


@app.post("/billing/webhook")
async def webhook(request: Request):
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(503, "Webhook not configured")
    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(
            payload,
            request.headers.get("stripe-signature"),
            STRIPE_WEBHOOK_SECRET,
        )
    except (ValueError, stripe.error.SignatureVerificationError) as exc:
        raise HTTPException(400, "Invalid webhook signature") from exc
    db = get_db()
    state_change: Optional[dict[str, Any]] = None
    committed = False
    duplicate = False
    event_type = "-"
    sub_id: Optional[str] = None
    rows = 0
    resulting = "-"
    warn_zero = False
    try:
        event_type = str(event["type"])
        if not _mark_event(str(event["id"]), event_type, db):
            duplicate = True
            resulting = "duplicate"
        else:
            obj = event["data"]["object"]
            if event_type == "checkout.session.completed":
                meta = obj.get("metadata") or {}
                uid = meta.get("user_id") or obj.get("client_reference_id")
                if uid:
                    from tiers import tier_for_price

                    tier = tier_for_price(meta.get("price_id")) or meta.get("tier")
                    if tier not in ("pro", "diamond"):
                        tier = None
                    raw_sub = obj.get("subscription")
                    sub_id = raw_sub if isinstance(raw_sub, str) else None
                    live = _retrieve_subscription(sub_id) if sub_id else None
                    live_status = live.get("status") if isinstance(live, dict) else None
                    if live_status in ("canceled", "incomplete_expired"):
                        resulting = "skipped"
                        rows = 0
                    else:
                        rows = _set_sub(int(uid), "active", sub_id, tier=tier, db=db)
                        db.execute("UPDATE users SET trial_used=1 WHERE id=?", (int(uid),))
                        resulting = "active"
            elif event_type in (
                "customer.subscription.updated",
                "customer.subscription.created",
                "customer.subscription.deleted",
                "invoice.paid",
                "invoice.payment_failed",
            ):
                rows, resulting, sub_id, state_change, warn_zero = _sync_subscription_event(
                    db, event_type, obj
                )
            db.commit()
            committed = True
    finally:
        if not committed:
            db.rollback()
        db.close()
    logger.info(
        "webhook type=%s sub=%s rows=%s status=%s",
        event_type,
        sub_id or "-",
        rows,
        resulting,
    )
    if warn_zero and sub_id:
        logger.warning("webhook type=%s sub=%s matched zero rows", event_type, sub_id)
    if state_change:
        state_change.pop("rows", None)
        _emit("subscription.state_changed", state_change)
    if duplicate:
        return {"ok": True, "duplicate": True}
    return {"ok": True}


@app.get("/config/remote")
def remote_config(service: str = SERVICE):
    if service != SERVICE:
        raise HTTPException(400, "Unknown service")
    from config_store import load_published

    published = load_published()
    if not published:
        return {"published": False}
    return published


def _optional_user(request: Request) -> Optional[int]:
    auth = request.headers.get("authorization", "")
    return verify_token(auth[7:]) if auth.lower().startswith("bearer ") else None


@app.post("/support/ticket")
def create_support_ticket(req: SupportTicketReq, request: Request):
    if "@" not in req.email or "." not in req.email.split("@")[-1]:
        raise HTTPException(400, "Valid email required")
    db = get_db()
    cur = db.execute(
        """INSERT INTO support_tickets (user_id, service, email, subject, message)
           VALUES (?,?,?,?,?)""",
        (
            _optional_user(request),
            SERVICE,
            req.email.strip(),
            req.subject.strip(),
            req.message.strip(),
        ),
    )
    db.commit()
    ticket_id = cur.lastrowid
    db.close()
    emailed = support_mail.send_support_email(
        reply_to=req.email.strip(),
        subject=support_mail.ticket_subject(req.kind, req.subject.strip()),
        message=f"Kind: {req.kind}\n\n{req.message.strip()}",
        ticket_id=int(ticket_id or 0),
    )
    _emit("support.ticket", {"ticket_id": ticket_id}, user_id=_optional_user(request))
    return {"id": ticket_id, "status": "open", "emailed": emailed}


@app.post("/telemetry/event")
def telemetry_event(req: TelemetryEventReq, request: Request):
    if req.service != SERVICE or req.event not in TELEMETRY_EVENTS:
        raise HTTPException(400, "Unknown telemetry event")
    _emit(req.event, req.properties, user_id=_optional_user(request))
    return {"ok": True}


@app.get("/static/oauth-done.js")
def oauth_done_script():
    return FileResponse(
        STATIC_DIR / "oauth-done.js",
        media_type="application/javascript",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.get("/static/ops.js")
def ops_script():
    return FileResponse(
        STATIC_DIR / "ops.js",
        media_type="application/javascript",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/ops")
def ops_console():
    return FileResponse(STATIC_DIR / "ops.html", media_type="text/html")


def _require_ip(request: Request) -> None:
    if ENV == "production" and _client_ip(request) not in ADMIN_IP_ALLOWLIST:
        raise HTTPException(403, "Admin IP denied")


def _require_key(request: Request, expected: str, header: str) -> None:
    _require_ip(request)
    supplied = request.headers.get(header, "")
    if not expected or not supplied or not secrets.compare_digest(supplied, expected):
        raise HTTPException(401, "Invalid admin key")


def require_admin(request: Request) -> None:
    _require_key(request, ADMIN_KEY, "x-admin-key")


def require_telemetry_read(request: Request) -> None:
    _require_key(request, TELEMETRY_READ_KEY, "x-telemetry-key")


def _admin_call(fn, *args, **kwargs):
    db = get_db()
    try:
        return fn(db, *args, **kwargs)
    except admin_db.AdminDbError as exc:
        raise HTTPException(exc.status, exc.detail) from exc
    finally:
        db.close()


@app.get("/admin/metrics/summary")
def admin_metrics(request: Request):
    require_admin(request)
    from metrics_summary import build_summary

    db = get_db()
    try:
        return build_summary(db)
    finally:
        db.close()


@app.get("/admin/overview")
def admin_overview(request: Request):
    require_admin(request)
    db = get_db()
    users = db.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
    pro = db.execute(
        "SELECT COUNT(*) AS n FROM subscriptions WHERE service=? AND status='active'",
        (SERVICE,),
    ).fetchone()["n"]
    db.close()
    return {"users": users, "pro_rows": pro, "services": [SERVICE], "app_env": APP_ENV}


@app.get("/admin/billing/stripe")
def admin_billing_stripe(request: Request, user_id: int):
    """Read-only: local subscription row versus the live Stripe status."""
    require_admin(request)
    db = get_db()
    try:
        user = db.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(404, "User not found")
        sub = db.execute(
            """SELECT status, tier, stripe_sub_id, stripe_status, interval, current_period_end
               FROM subscriptions WHERE user_id=? AND service=?""",
            (user_id, SERVICE),
        ).fetchone()
    finally:
        db.close()
    local = dict(sub) if sub else None
    live_status = None
    lookup = "skipped"
    sub_id = (local or {}).get("stripe_sub_id")
    if sub_id and STRIPE_SECRET_KEY:
        try:
            remote = stripe.Subscription.retrieve(str(sub_id))
            live_status = _stripe_value(remote, "status")
            lookup = "ok"
        except stripe.error.StripeError:
            lookup = "failed"
    mapped = _map_stripe_status(str(live_status)) if isinstance(live_status, str) else None
    local_status = (local or {}).get("status")
    local_stripe = (local or {}).get("stripe_status")
    mismatch = lookup == "failed" or (
        mapped is not None and (mapped != local_status or local_stripe != live_status)
    )
    return {
        "user_id": user_id,
        "local": local,
        "stripe_status": live_status,
        "lookup": lookup,
        "mismatch": mismatch,
    }


@app.get("/admin/users")
def admin_users(request: Request, q: str = "", limit: int = 200):
    require_admin(request)
    limit = min(max(limit, 1), 1000)
    like = f"%{q.strip().lower()}%"
    db = get_db()
    rows = db.execute(
        """SELECT u.id, u.email, u.created_at, u.stripe_customer_id,
                  s.service, s.status, s.stripe_sub_id, s.promo_expires_at,
                  s.past_due_since, s.tier, s.tier_override, s.tier_override_expires_at
           FROM users u LEFT JOIN subscriptions s
             ON s.user_id=u.id AND s.service=?
           WHERE ?='' OR LOWER(u.email) LIKE ? OR CAST(u.id AS TEXT) LIKE ?
           ORDER BY u.id DESC LIMIT ?""",
        (SERVICE, q.strip(), like, like, limit),
    ).fetchall()
    db.close()
    users = []
    for row in rows:
        item = dict(row)
        # "plan" is exactly what /auth/me reports to the extension.
        item["plan"] = _effective_plan(item if item.get("status") else None)
        users.append(item)
    return {"users": users}


@app.patch("/admin/users/{user_id}")
def admin_patch_user(
    user_id: int, req: AdminUserPatchReq, request: Request
):
    require_admin(request)
    db = get_db()
    try:
        admin_db.patch_user(
            db,
            user_id,
            email=req.email,
            password=req.password,
            stripe_customer_id=req.stripe_customer_id,
            clear_stripe_customer=req.clear_stripe_customer,
        )
        if any(
            (
                req.status is not None,
                req.stripe_sub_id is not None,
                req.promo_expires_at is not None,
                req.clear_stripe_sub,
                req.clear_promo,
            )
        ):
            admin_db.upsert_subscription(
                db,
                user_id,
                SERVICE,
                status=req.status,
                stripe_sub_id=req.stripe_sub_id,
                promo_expires_at=req.promo_expires_at,
                clear_stripe_sub=req.clear_stripe_sub,
                clear_promo=req.clear_promo,
            )
        if req.promo_code:
            promo_mod.redeem_promo(
                db, user_id=user_id, service=SERVICE, code=req.promo_code
            )
            db.commit()
        return {"ok": True}
    except admin_db.AdminDbError as exc:
        raise HTTPException(exc.status, exc.detail) from exc
    finally:
        db.close()


@app.post("/admin/users/{user_id}/reset-password")
def admin_reset_password(user_id: int, request: Request):
    require_admin(request)
    db = get_db()
    try:
        return {
            "ok": True,
            "temporary_password": admin_db.reset_user_password(db, user_id),
        }
    finally:
        db.close()


@app.post("/admin/users/{user_id}/delete")
def admin_delete_user(user_id: int, request: Request):
    require_admin(request)
    return _admin_call(admin_db.delete_user, user_id)


@app.get("/admin/promos")
def admin_promos(request: Request):
    require_admin(request)
    db = get_db()
    rows = db.execute("SELECT * FROM promo_codes ORDER BY created_at DESC").fetchall()
    db.close()
    return {"promos": [dict(row) for row in rows]}


@app.post("/admin/promos")
def admin_create_promo(req: AdminPromoReq, request: Request):
    require_admin(request)
    code = promo_mod.normalize_code(req.code)
    if req.service != SERVICE or not promo_mod.CODE_RE.fullmatch(code):
        raise HTTPException(400, "Invalid promo")
    db = get_db()
    db.execute(
        """INSERT INTO promo_codes
           (code, service, duration_days, max_redemptions, redeemed_count, active)
           VALUES (?,?,?,?,0,1)""",
        (code, SERVICE, req.duration_days, req.max_redemptions),
    )
    db.commit()
    db.close()
    return {"ok": True, "code": code}


@app.post("/admin/promos/{code}/toggle")
def admin_toggle_promo(code: str, request: Request):
    require_admin(request)
    normalized = promo_mod.normalize_code(code)
    db = get_db()
    row = db.execute("SELECT active FROM promo_codes WHERE code=?", (normalized,)).fetchone()
    if not row:
        db.close()
        raise HTTPException(404, "Unknown code")
    active = 0 if int(row["active"]) else 1
    db.execute("UPDATE promo_codes SET active=? WHERE code=?", (active, normalized))
    db.commit()
    db.close()
    return {"ok": True, "active": bool(active)}


@app.put("/admin/config")
def admin_config(req: AdminConfigReq, request: Request):
    require_admin(request)
    if req.service != SERVICE:
        raise HTTPException(400, "Unknown service")
    db = get_db()
    value = json.dumps(req.value)
    db.execute(
        """INSERT INTO remote_config (service, key, value_json) VALUES (?,?,?)
           ON CONFLICT(service, key) DO UPDATE SET value_json=?, updated_at=CURRENT_TIMESTAMP""",
        (SERVICE, req.key.strip(), value, value),
    )
    db.commit()
    db.close()
    return {"ok": True}


@app.get("/admin/db/tables")
def admin_tables(request: Request):
    require_admin(request)
    return {"tables": _admin_call(admin_db.list_tables)}


@app.get("/admin/db/rows")
def admin_rows(request: Request, table: str, q: str = "", limit: int = 50, offset: int = 0):
    require_admin(request)
    return _admin_call(admin_db.list_rows, table, q=q, limit=limit, offset=offset)


def _require_db_write() -> None:
    if ENV == "production" and not ADMIN_DB_WRITE:
        raise HTTPException(403, "Admin database writes disabled")


@app.post("/admin/db/rows")
def admin_insert(req: AdminDbWriteReq, request: Request):
    require_admin(request)
    _require_db_write()
    return _admin_call(admin_db.insert_row, req.table, req.values)


@app.put("/admin/db/rows")
def admin_update(req: AdminDbWriteReq, request: Request):
    require_admin(request)
    _require_db_write()
    if not req.pk:
        raise HTTPException(400, "pk required")
    return _admin_call(admin_db.update_row, req.table, req.pk, req.values)


@app.post("/admin/db/rows/delete")
def admin_delete(req: AdminDbWriteReq, request: Request):
    require_admin(request)
    _require_db_write()
    if not req.pk:
        raise HTTPException(400, "pk required")
    return _admin_call(admin_db.delete_row, req.table, req.pk)


@app.get("/admin/telemetry/events")
def telemetry_events(
    request: Request,
    event: Optional[str] = None,
    limit: int = 500,
    since: Optional[str] = None,
):
    require_telemetry_read(request)
    sql = "SELECT id, ts, service, event, user_id, payload_json, source FROM telemetry_events WHERE service=?"
    params: list[Any] = [SERVICE]
    if event:
        sql += " AND event=?"
        params.append(event)
    if since:
        sql += " AND ts>=?"
        params.append(since)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(min(max(limit, 1), 5000))
    db = get_db()
    rows = db.execute(sql, params).fetchall()
    db.close()
    return {
        "events": [
            {**dict(row), "properties": json.loads(row["payload_json"] or "{}")}
            for row in rows
        ]
    }


@app.get("/admin/telemetry/summary")
def telemetry_summary(request: Request, days: int = 7):
    require_telemetry_read(request)
    days = min(max(days, 1), 90)
    window, window_params = telemetry_window_sql(days)
    db = get_db()
    rows = db.execute(
        f"""SELECT service, event, COUNT(*) AS n FROM telemetry_events
            WHERE service=? AND {window}
            GROUP BY service, event ORDER BY n DESC""",
        (SERVICE, *window_params),
    ).fetchall()
    db.close()
    return {"days": days, "counts": [dict(row) for row in rows]}


from v1_routes import register_v1

register_v1(app)
otel_setup_mod = __import__("otel_setup")
otel_setup_mod.setup(os.getenv("OTEL_SERVICE_NAME", f"marginmark-api-{APP_ENV}"))

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "marginmark_app:app",
        host="127.0.0.1",
        port=8000,
        proxy_headers=True,
        forwarded_allow_ips="*",
    )
