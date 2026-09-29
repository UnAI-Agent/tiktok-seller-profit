"""
Reply Platform — Multi-Extension Backend
One backend, unlimited niche extensions.
Each extension passes its service slug → backend routes to the right prompt/config.

Deploy: Railway, Fly.io, or any container platform (Dockerfile included)
Scale:  Swap SQLite for Postgres via DATABASE_URL env var
"""

from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import Optional
from collections import defaultdict, deque
from starlette.middleware.base import BaseHTTPMiddleware
import hashlib, secrets, json, os, time, logging, traceback
from datetime import datetime, date
from dotenv import load_dotenv
from db import (
    DB_PATH,
    USE_POSTGRES,
    get_db,
    init_db,
    reply_cache_freshness_sql,
    telemetry_window_sql,
)
import anthropic
import stripe

from security.passwords import (
    hash_password,
    needs_rehash,
    normalize_email,
    validate_password,
    verify_password,
)
import oauth as oauth_mod
from billing_env import assert_stripe_keys_match_env, checkout_extra
import promo as promo_mod
import admin_db

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── Config ────────────────────────────────────────────────────────────────────
# TODO: Enforce HTTPS in production (TLS at the reverse proxy / Fly / Railway).
# localhost:8000 HTTP is OK for development only.
# TODO: Migrate to PostgreSQL before 1000+ users (set DATABASE_URL). SQLite is alpha-only.
ENV = os.getenv("ENV", "development").lower()
APP_ENV = os.getenv("APP_ENV", "local").lower()  # local | lle | prod
ANTHROPIC_API_KEY     = os.getenv("ANTHROPIC_API_KEY")
STRIPE_SECRET_KEY     = os.getenv("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")
_jwt_secret = os.getenv("JWT_SECRET")
if not _jwt_secret:
    if ENV == "production":
        raise RuntimeError("JWT_SECRET is required in production")
    _jwt_secret = secrets.token_hex(32)
    logger.warning("JWT_SECRET unset — tokens invalidate on process restart")
JWT_SECRET            = _jwt_secret
TELEMETRY_ADMIN_KEY   = os.getenv("TELEMETRY_ADMIN_KEY", "")
FRONTEND_URL          = os.getenv("FRONTEND_URL", "https://mail.google.com")
PUBLIC_BASE_URL       = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
assert_stripe_keys_match_env(APP_ENV, STRIPE_SECRET_KEY)

stripe.api_key = STRIPE_SECRET_KEY
ai = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# ─── Shared base prompt (applies to ALL services) ──────────────────────────────
BASE_PROMPT = """

CRITICAL — sound like a real human wrote this, not AI:
- NEVER start with: "Certainly!", "Absolutely!", "Of course!", "Great!", "I hope this finds you well", "Thank you for reaching out"
- NEVER use: "It's important to note", "Please don't hesitate to contact us", "I understand your frustration" as an opener
- NEVER use bullet points — this is a personal email
- USE contractions naturally: I'm, I'll, we've, can't, won't, that's
- VARY sentence length — mix short punchy sentences with longer ones
- A sentence starting with "And" or "But" is fine — real people do this
- Write like a real person typing quickly, not an AI generating a perfect response
- NEVER include a subject line
- Sign off differently each time — never repeat the same closing twice in a row
- NEVER invent specific details you don't know — use clear placeholders instead
- For unknown details use: [TRACKING NUMBER], [ESTIMATED DATE], [YOUR RETURN POLICY], [PRICE], [PRODUCT NAME]
- Placeholders are better than wrong information — the owner will fill them in before sending
- Never guess at policies, prices, dates, or specifics that aren't in the email thread

IMPORTANT — you are always writing AS the owner, TO a customer:
- You are ghostwriting for the owner — write in first person as if you ARE them
- The person reading this reply is a customer, not you or the owner
- Never address the owner, never say "you should reply with..." or "here's a draft"
- Never explain what you're doing — just write the reply itself
- Never start with "Here is a reply:" or "Draft:" — jump straight into the greeting

- ALWAYS put a blank line before the sign-off (Thanks, / Best, / etc.)
- Format must be:

  [Body text here]

  Thanks,
  [Your Name]

- The sign-off is ALWAYS on its own line, never attached to the last sentence

"""

# ─── Service Registry ──────────────────────────────────────────────────────────
# To add a new extension: copy any block below, change the values, done.
SERVICES = {

    "ai-reply": {
        "name": "AI Reply",
        "free_limit": 5,
        "pro_price_id": os.getenv("STRIPE_PRICE_AI_REPLY"),
        "pro_price_monthly": 9,
        "model_free": "claude-haiku-4-5",
        "model_pro":  "claude-sonnet-4-6",
        "system_prompt": """You are ghostwriting email replies for a professional.
Write as if you ARE that person — in first person, directly to whoever emailed them.

Rules:
- Start directly with a greeting (e.g. "Hi [name]," or "Hello,")
- Match the tone of the original email
- End with a professional sign-off and [Your Name] placeholder
- Under 150 words unless the thread clearly needs more
- Be specific — never write vague filler responses

If the email is clearly not relevant (spam, newsletters, automated alerts):
- Write one line only: "Hey, looks like this one landed in the wrong inbox — not meant for me! Reach out anytime if you need something." """
    },

    "shop-reply": {
        "name": "ShopReply",
        "free_limit": 8,
        "pro_price_id": os.getenv("STRIPE_PRICE_SHOP_REPLY"),
        "pro_price_monthly": 12,
        "model_free": "claude-haiku-4-5",
        "model_pro":  "claude-sonnet-4-6",
        "system_prompt": """You are ghostwriting customer emails for an Etsy shop owner.
Write as if you ARE the shop owner — in first person, directly to their customer.

You handle:
- Shipping delays and order status questions
- Custom order inquiries and quotes
- Refund and return requests
- Product questions and sizing
- Complaints and unhappy customers
- 5-star review thank-you notes
- Follow-up messages after purchase

Tone: Warm, genuine, small-business friendly. Sound like a real maker who cares
about their craft and their customers. Never corporate. Never robotic.

Always:
- Address the customer by name if visible
- Acknowledge their specific concern directly
- Offer a clear next step or resolution
- End with warmth ("Thanks so much for supporting my shop!" etc.)
- Keep it under 120 words — customers don't read long emails

Casual phrasing is great: "Totally get it!", "Good news —", "Quick update:"

If the email is clearly not a customer inquiry (newsletters, spam, promotions):
- Write one line only: "Hey, just wanted to flag this landed in my shop inbox by mistake — looks like it wasn't meant for me! Feel free to reach out if you ever have questions about my shop. Thanks!" """
    },

    "lead-reply": {
        "name": "LeadReply",
        "free_limit": 5,
        "pro_price_id": os.getenv("STRIPE_PRICE_LEAD_REPLY"),
        "pro_price_monthly": 29,
        "model_free": "claude-haiku-4-5",
        "model_pro":  "claude-sonnet-4-6",
        "system_prompt": """You are ghostwriting follow-up emails for a real estate agent.
Write as if you ARE the agent — in first person, directly to their lead.

Goals:
- Move the conversation toward a showing or call
- Handle objections gently without being pushy
- Follow up on cold leads without seeming desperate

Tone: Confident, helpful, local expert. Sound like the agent people want to work with.
Always include a clear call to action. Keep it under 100 words.

If the email is clearly not a real estate lead (spam, newsletters, unrelated):
- Write one line only: "Hey, looks like this one got to me by mistake — not meant for me! Feel free to reach out if you're ever looking to buy or sell." """
    },

    "tiktok-seller-tool": {
        "name": "MarginMark",
        "free_limit": 10,
        "pro_price_id": os.getenv("STRIPE_PRICE_TIKTOK_SELLER"),
        "pro_price_id_yearly": os.getenv("STRIPE_PRICE_TIKTOK_SELLER_YEARLY"),
        "pro_price_monthly": 9.99,
        "pro_price_yearly": 99,
        "model_free": "claude-haiku-4-5",
        "model_pro": "claude-sonnet-4-6",
        "system_prompt": "Not used — subscription-only extension.",
    },

    # ─── Add more services here — copy a block above and change the values ───────
}

def get_service(slug: str) -> dict:
    svc = SERVICES.get(slug)
    if not svc:
        raise HTTPException(status_code=400, detail=f"Unknown service: {slug}")
    return svc

init_db()

# ─── Auth helpers ───────────────────────────────────────────────────────────────
security = HTTPBearer()

def make_token(uid: int) -> str:
    import hmac, base64
    payload = f"{uid}:{int(time.time())}"
    sig = hmac.new(JWT_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()[:16]
    return base64.urlsafe_b64encode(f"{payload}:{sig}".encode()).decode()

def verify_token(token: str) -> Optional[int]:
    import hmac, base64
    try:
        decoded = base64.urlsafe_b64decode(token.encode()).decode()
        uid_str, ts_str, sig = decoded.rsplit(":", 2)
        payload = f"{uid_str}:{ts_str}"
        expected = hmac.new(JWT_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()[:16]
        if not hmac.compare_digest(sig, expected): return None
        if int(time.time()) - int(ts_str) > 90 * 86400: return None
        return int(uid_str)
    except: return None

def current_user(creds: HTTPAuthorizationCredentials = Depends(security)):
    uid = verify_token(creds.credentials)
    if not uid: raise HTTPException(401, "Invalid or expired token")
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    db.close()
    if not user: raise HTTPException(401, "User not found")
    return dict(user)

def billing_return_base() -> str:
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL
    return FRONTEND_URL.rstrip("/")

def oauth_public_base(request: Request) -> str:
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL
    if ENV == "production":
        raise HTTPException(503, "PUBLIC_BASE_URL is required in production")
    return str(request.base_url).rstrip("/")

def oauth_done_redirect(
    error: Optional[str] = None,
    ticket: Optional[str] = None,
    client: Optional[str] = None,
) -> RedirectResponse:
    from urllib.parse import quote
    if ticket:
        url = f"/auth/oauth/done?ticket={quote(ticket, safe='')}"
        ext = oauth_mod.normalize_ext_id(client)
        if ext:
            url += f"&client={quote(ext, safe='')}"
        return RedirectResponse(url=url, status_code=302)
    code = error or "invalid"
    return RedirectResponse(url=f"/auth/oauth/done?error={quote(code, safe='')}", status_code=302)

def oauth_done_html(
    error: Optional[str] = None,
    ticket: Optional[str] = None,
    client: Optional[str] = None,
) -> HTMLResponse:
    import html as html_mod
    ok = not error
    title = "Signed in" if ok else "Sign-in could not finish"
    message = html_mod.escape(oauth_mod.done_message(error))
    heading = html_mod.escape(title)
    ticket_attr = html_mod.escape(ticket or "", quote=True)
    ext = oauth_mod.normalize_ext_id(client)
    ext_attr = html_mod.escape(ext, quote=True)
    ping = ""
    if ok and ticket and ext:
        ping = f"""<script>
(function(){{
  var ticket = {json.dumps(ticket)};
  var ext = {json.dumps(ext)};
  location.replace("chrome-extension://" + ext + "/oauth-finish.html?ticket=" + encodeURIComponent(ticket));
}})();
</script>"""
    body = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{heading}</title>
<style>body{{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;color:#0f172a;line-height:1.45}}</style>
</head><body>
<h1>{heading}</h1>
<p>{message}</p>
<div id="tst-oauth-ticket" data-ticket="{ticket_attr}" data-ext="{ext_attr}" hidden></div>
{ping}
</body></html>"""
    return HTMLResponse(body, status_code=200 if ok else 400)

# ─── Usage helpers ──────────────────────────────────────────────────────────────
def get_usage(uid: int, service: str) -> int:
    db = get_db()
    row = db.execute(
        "SELECT count FROM usage WHERE user_id=? AND service=? AND date=?",
        (uid, service, date.today().isoformat())
    ).fetchone()
    db.close()
    return row["count"] if row else 0

def inc_usage(uid: int, service: str):
    db = get_db()
    db.execute("""
        INSERT INTO usage (user_id, service, date, count) VALUES (?,?,?,1)
        ON CONFLICT(user_id, service, date) DO UPDATE SET count=count+1
    """, (uid, service, date.today().isoformat()))
    db.commit(); db.close()

def get_sub(uid: int, service: str) -> str:
    db = get_db()
    row = db.execute(
        "SELECT status, stripe_sub_id, promo_expires_at FROM subscriptions WHERE user_id=? AND service=?",
        (uid, service)
    ).fetchone()
    db.close()
    return promo_mod.effective_sub_status(row)

def set_sub(uid: int, service: str, status: str, stripe_sub_id: str = None, promo_expires_at: str = None):
    db = get_db()
    db.execute("""
        INSERT INTO subscriptions (user_id, service, status, stripe_sub_id, promo_expires_at)
        VALUES (?,?,?,?,?)
        ON CONFLICT(user_id, service) DO UPDATE SET
            status=?,
            stripe_sub_id=COALESCE(?, subscriptions.stripe_sub_id),
            promo_expires_at=COALESCE(?, subscriptions.promo_expires_at)
    """, (uid, service, status, stripe_sub_id, promo_expires_at, status, stripe_sub_id, promo_expires_at))
    db.commit(); db.close()

# ─── Cache helpers ──────────────────────────────────────────────────────────────
def get_cached(thread: str, tone: str, service: str) -> Optional[str]:
    key = hashlib.md5(f"{thread}{tone}{service}".encode()).hexdigest()
    db = get_db()
    row = db.execute(
        f"SELECT content FROM reply_cache WHERE hash=? AND {reply_cache_freshness_sql()}",
        (key,),
    ).fetchone()
    if row:
        db.execute("UPDATE reply_cache SET hit_count=hit_count+1 WHERE hash=?", (key,))
        db.commit()
    db.close()
    return row["content"] if row else None

def set_cache(thread: str, tone: str, service: str, content: str):
    key = hashlib.md5(f"{thread}{tone}{service}".encode()).hexdigest()
    db = get_db()
    db.execute(
        "INSERT INTO reply_cache (hash,content,service) VALUES (?,?,?)",
        (key, content, service),
    )
    db.commit(); db.close()

# ─── Variety helpers ─────────────────────────────────────────────────────────────
def get_recent_openings(user_id: int, service: str) -> list:
    db = get_db()
    rows = db.execute(
        "SELECT opening FROM recent_openings WHERE user_id=? AND service=? ORDER BY created_at DESC LIMIT 5",
        (user_id, service)
    ).fetchall()
    db.close()
    return [r["opening"] for r in rows]

def track_opening(user_id: int, service: str, reply: str):
    opening = reply.split('\n')[0][:120]
    db = get_db()
    db.execute("INSERT INTO recent_openings (user_id, service, opening) VALUES (?,?,?)",
               (user_id, service, opening))
    db.execute("""DELETE FROM recent_openings WHERE user_id=? AND service=? AND id NOT IN (
        SELECT id FROM recent_openings WHERE user_id=? AND service=?
        ORDER BY created_at DESC LIMIT 10)""",
        (user_id, service, user_id, service))
    db.commit(); db.close()

# ─── Profile helpers ────────────────────────────────────────────────────────────
def get_profile_context(user_id: int, service: str) -> str:
    db = get_db()
    row = db.execute(
        "SELECT * FROM user_profiles WHERE user_id=? AND service=?",
        (user_id, service)
    ).fetchone()
    db.close()
    if not row: return ""
    parts = []
    if row["business_name"]:  parts.append(f"Business name: {row['business_name']}")
    if row["business_type"]:  parts.append(f"What they sell: {row['business_type']}")
    if row["return_policy"]:  parts.append(f"Return policy: {row['return_policy']}")
    if row["shipping_info"]:  parts.append(f"Shipping info: {row['shipping_info']}")
    if row["tone_notes"]:     parts.append(f"Tone/style notes: {row['tone_notes']}")
    if row["custom_context"]: parts.append(f"Additional context: {row['custom_context']}")
    if not parts: return ""
    return "\n\nBUSINESS PROFILE (use these exact details, never invent alternatives):\n" + "\n".join(parts)

# ─── Telemetry ──────────────────────────────────────────────────────────────────
def emit(
    event: str,
    service: str,
    data: dict | None = None,
    *,
    user_id: int | None = None,
    source: str = "server",
):
    data = dict(data or {})
    ts = datetime.utcnow().isoformat()
    uid = user_id if user_id is not None else data.get("user_id")
    try:
        db = get_db()
        if uid and not data.get("email"):
            row = db.execute("SELECT email FROM users WHERE id=?", (uid,)).fetchone()
            if row and row["email"]:
                data["email"] = row["email"]
        logger.info(json.dumps({
            "ts": ts,
            "service": service,
            "event": event,
            **{k: v for k, v in data.items() if k != "user_id"},
        }))
        db.execute(
            """INSERT INTO telemetry_events (ts, service, event, user_id, payload_json, source)
               VALUES (?,?,?,?,?,?)""",
            (ts, service, event, uid, json.dumps(data), source),
        )
        db.commit()
        db.close()
    except Exception as exc:
        logger.warning("telemetry persist failed: %s", exc)


def require_telemetry_admin(request: Request):
    if not TELEMETRY_ADMIN_KEY:
        raise HTTPException(503, "TELEMETRY_ADMIN_KEY not configured")
    key = request.headers.get("x-admin-key") or request.headers.get("x-telemetry-key")
    if not key or not secrets.compare_digest(key, TELEMETRY_ADMIN_KEY):
        raise HTTPException(401, "Invalid admin key")

# ─── App ────────────────────────────────────────────────────────────────────────
# Chrome extension popups send Origin: chrome-extension://<32-char-id>.
# FastAPI does not treat "chrome-extension://*" as a valid origin glob.
# allow_origins=["*"] + allow_credentials=True is invalid CORS and blocks the popup.
class RateLimitMiddleware(BaseHTTPMiddleware):
    """In-memory per-IP limiter. No extra dependency. Process-local (OK behind one instance)."""

    def __init__(self, app, max_hits: int = 120, window_sec: int = 60):
        super().__init__(app)
        self.max_hits = max_hits
        self.window_sec = window_sec
        self.hits: dict[str, deque] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path in ("/health", "/stripe/webhook", "/billing/webhook"):
            return await call_next(request)
        if request.method == "GET" and (
            path.startswith("/auth/oauth/")
            or path == "/billing/done"
            or path == "/ops"
            or path.startswith("/config/remote")
        ):
            return await call_next(request)
        ip = request.client.host if request.client else "unknown"
        now = time.time()
        q = self.hits[ip]
        while q and now - q[0] > self.window_sec:
            q.popleft()
        if len(q) >= self.max_hits:
            retry = max(1, int(self.window_sec - (now - q[0])) + 1)
            return JSONResponse(
                status_code=429,
                content={"error": "Too many requests"},
                headers={"Retry-After": str(retry)},
            )
        q.append(now)
        return await call_next(request)


app = FastAPI(title="Reply Platform API")
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_origin_regex=r"^chrome-extension://[a-z]{32}$",
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Admin-Key", "X-Telemetry-Key"],
    allow_credentials=True,
)


@app.exception_handler(Exception)
async def unhandled_exception(_request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": detail},
            headers=exc.headers or {},
        )
    logger.exception("unhandled")
    body = {"error": "Internal server error"}
    if ENV != "production":
        body["trace"] = traceback.format_exc()
    return JSONResponse(status_code=500, content=body)

# ─── Models ─────────────────────────────────────────────────────────────────────
class AuthReq(BaseModel):
    email: str
    password: str

class ForgotPasswordReq(BaseModel):
    email: str

class ReplyReq(BaseModel):
    thread: str
    service: str = "ai-reply"
    tone: Optional[str] = "professional"

class SaveReplyReq(BaseModel):
    content: str
    service: str
    label: Optional[str] = None

class UpdateLabelReq(BaseModel):
    label: str

class CheckoutReq(BaseModel):
    service: str
    billing_interval: Optional[str] = "monthly"  # monthly | yearly

class TelemetryEventReq(BaseModel):
    service: str = "tiktok-seller-tool"
    event: str
    properties: Optional[dict] = None

class SupportTicketReq(BaseModel):
    service: str = "tiktok-seller-tool"
    email: str = Field(max_length=320)
    subject: str = Field(max_length=200)
    message: str = Field(max_length=8000)

class SkuSyncReq(BaseModel):
    service: str = "tiktok-seller-tool"
    skus: list[dict] = Field(default_factory=list, max_length=500)

class OAuthTicketReq(BaseModel):
    ticket: str = Field(min_length=16, max_length=128)

class PromoRedeemReq(BaseModel):
    service: str = "tiktok-seller-tool"
    code: str = Field(min_length=4, max_length=32)

class AdminPromoReq(BaseModel):
    code: str = Field(min_length=4, max_length=32)
    service: str = "tiktok-seller-tool"
    duration_days: int = Field(default=30, ge=1, le=366)
    max_redemptions: Optional[int] = Field(default=None, ge=1)

class AdminConfigReq(BaseModel):
    service: str = "tiktok-seller-tool"
    key: str = Field(min_length=1, max_length=64)
    value: str = Field(max_length=4000)

class AdminDbWriteReq(BaseModel):
    table: str = Field(min_length=1, max_length=64)
    values: dict = Field(default_factory=dict)
    pk: Optional[dict] = None

class AdminUserPatchReq(BaseModel):
    email: Optional[str] = None
    password: Optional[str] = None
    stripe_customer_id: Optional[str] = Field(default=None, max_length=255)
    clear_stripe_customer: bool = False
    service: str = "tiktok-seller-tool"
    status: Optional[str] = None
    stripe_sub_id: Optional[str] = None
    promo_expires_at: Optional[str] = None
    clear_stripe_sub: bool = False
    clear_promo: bool = False
    promo_code: Optional[str] = None

class ProfileReq(BaseModel):
    service: str
    business_name:  Optional[str] = None
    business_type:  Optional[str] = None
    return_policy:  Optional[str] = None
    shipping_info:  Optional[str] = None
    tone_notes:     Optional[str] = None
    custom_context: Optional[str] = None

# ─── Auth routes ─────────────────────────────────────────────────────────────────
@app.post("/auth/register")
async def register(req: AuthReq):
    email = normalize_email(req.email)
    try:
        validate_password(req.password)
    except ValueError as e:
        raise HTTPException(400, str(e))
    db = get_db()
    if db.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone():
        db.close()
        raise HTTPException(400, "Email already registered")
    cur = db.execute(
        "INSERT INTO users (email,password_hash) VALUES (?,?)",
        (email, hash_password(req.password)),
    )
    db.commit()
    uid = cur.lastrowid
    db.close()
    emit("user.registered", "tiktok-seller-tool", {"email": email}, user_id=uid)
    return {"access_token": make_token(uid)}

@app.post("/auth/login")
async def login(req: AuthReq):
    email = normalize_email(req.email)
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not user or not verify_password(req.password, user["password_hash"]):
        db.close()
        raise HTTPException(401, "Invalid email or password")
    if needs_rehash(user["password_hash"]):
        db.execute(
            "UPDATE users SET password_hash=? WHERE id=?",
            (hash_password(req.password), user["id"]),
        )
        db.commit()
    uid = user["id"]
    db.close()
    emit("auth.login", "tiktok-seller-tool", {"email": email}, user_id=uid)
    return {"access_token": make_token(uid)}

@app.post("/auth/forgot-password")
async def forgot_password(req: ForgotPasswordReq):
    """Stub: always succeed so callers cannot enumerate accounts."""
    email = normalize_email(req.email)
    if "@" not in email:
        raise HTTPException(400, "Enter a valid email")
    return {
        "ok": True,
        "message": "If that account exists, reset instructions were sent.",
    }

@app.get("/auth/oauth/done")
async def oauth_done(
    ticket: Optional[str] = None,
    error: Optional[str] = None,
    client: Optional[str] = None,
):
    """Browser landing after OAuth. JWT is never placed in this page."""
    return oauth_done_html(
        None if ticket else (error or "invalid"),
        ticket=ticket,
        client=client,
    )


@app.get("/auth/oauth/{provider}")
async def oauth_start(provider: str, request: Request, mode: str = "login", client: str = ""):
    provider = provider.lower()
    if provider not in oauth_mod.PROVIDERS:
        return oauth_done_redirect("invalid")
    if mode not in ("login", "signup"):
        mode = "login"
    try:
        public_base = oauth_public_base(request)
        oauth_mod.load_provider_app(provider)
        state, challenge = oauth_mod.create_flow(
            provider, mode, oauth_mod.normalize_ext_id(client)
        )
        url = oauth_mod.authorize_url(
            provider,
            public_base=public_base,
            state=state,
            code_challenge=challenge,
        )
    except HTTPException:
        raise
    except oauth_mod.OAuthError as exc:
        return oauth_done_redirect(exc.code)
    except Exception:
        logger.exception("oauth start failed")
        return oauth_done_redirect("invalid")
    return RedirectResponse(url=url, status_code=302)


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
        return oauth_done_redirect("invalid")
    if error:
        return oauth_done_redirect("denied" if error == "access_denied" else "provider")
    if not code or not state:
        return oauth_done_redirect("invalid")
    try:
        public_base = oauth_public_base(request)
        verifier, client = oauth_mod.pop_flow(state, provider)
        profile = await oauth_mod.exchange_code_for_profile(
            provider,
            public_base=public_base,
            code=code,
            code_verifier=verifier,
        )
        uid, created = oauth_mod.find_or_create_oauth_user(profile)
        ticket = oauth_mod.issue_ticket(uid)
        emit(
            "auth.oauth_register" if created else "auth.oauth_login",
            "tiktok-seller-tool",
            {"provider": provider, "email": profile.email},
            user_id=uid,
        )
        return oauth_done_redirect(ticket=ticket, client=client)
    except HTTPException:
        raise
    except oauth_mod.OAuthError as exc:
        return oauth_done_redirect(exc.code)
    except Exception:
        logger.exception("oauth callback failed")
        return oauth_done_redirect("provider")


@app.post("/auth/oauth/exchange")
async def oauth_exchange(req: OAuthTicketReq):
    uid = oauth_mod.consume_ticket(req.ticket)
    if not uid:
        raise HTTPException(401, "Sign-in expired. Try again from the extension.")
    return {"access_token": make_token(uid)}

@app.get("/auth/me")
async def me(service: str = "ai-reply", user: dict = Depends(current_user)):
    svc = get_service(service)
    db = get_db()
    sub = db.execute(
        "SELECT status, stripe_sub_id, promo_expires_at FROM subscriptions WHERE user_id=? AND service=?",
        (user["id"], service),
    ).fetchone()
    db.close()
    is_pro = promo_mod.effective_sub_status(sub) == "active"
    return {
        "id": user["id"],
        "email": user["email"],
        "service": service,
        "is_pro": is_pro,
        "subscription_status": "active" if is_pro else "free",
        "promo_expires_at": (sub or {}).get("promo_expires_at") if is_pro else None,
        "has_stripe": bool(sub and sub.get("stripe_sub_id")),
        "usage_today": get_usage(user["id"], service),
        "usage_limit": -1 if is_pro else svc["free_limit"],
        "pro_price": svc["pro_price_monthly"],
        "pro_price_yearly": svc.get("pro_price_yearly"),
    }

# ─── Reply generation ─────────────────────────────────────────────────────────────
@app.post("/api/generate-reply")
async def generate_reply(req: ReplyReq, user: dict = Depends(current_user)):
    svc = get_service(req.service)
    is_pro = get_sub(user["id"], req.service) == "active"
    daily_cap = 100 if is_pro else svc["free_limit"]
    used = get_usage(user["id"], req.service)
    tone = req.tone or "professional"

    if used >= daily_cap:
        emit("reply.limit_hit", req.service, {"user_id": user["id"]})
        raise HTTPException(402, "Free limit reached", headers={
            "X-Usage": json.dumps({"used": used, "limit": daily_cap, "remaining": 0})
        })

    # Return cached reply instantly — same thread + tone + service = same result
    cached = get_cached(req.thread, tone, req.service)
    if cached:
        emit("reply.cache_hit", req.service, {"user_id": user["id"]})
        return {
            "reply": cached,
            "from_cache": True,
            "usage": {"used": used, "limit": daily_cap, "remaining": max(0, daily_cap - used)}
        }

    tone_map = {
        "professional": "Write a professional, clear reply.",
        "friendly":     "Write a warm, friendly, conversational reply.",
        "brief":        "Write a very short reply — 2-3 sentences max.",
        "firm":         "Write a polite but firm reply that holds boundaries."
    }

    recent = get_recent_openings(user["id"], req.service)
    variety_note = ""
    if recent:
        variety_note = "\n\nDo NOT start with any of these openings (used recently):\n" + \
                       "\n".join(f'- "{o}"' for o in recent)

    try:
        msg = ai.messages.create(
            model=svc["model_pro"] if is_pro else svc["model_free"],
            max_tokens=400,
            system=svc["system_prompt"] + get_profile_context(user["id"], req.service) + BASE_PROMPT,
            messages=[{"role": "user", "content":
                f"{tone_map.get(tone, tone_map['professional'])}\n\n"
                f"Email thread:\n---\n{req.thread[:3000]}\n---\n\n"
                f"Write only the reply body.{variety_note}"}]
        )
        reply = msg.content[0].text.strip()
    except anthropic.AuthenticationError as e:
        logger.error(f"Auth error: {e}")
        raise HTTPException(401, "API authentication failed")
    except anthropic.BadRequestError as e:
        logger.error(f"Bad request: {e}")
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Claude API failed")
        raise HTTPException(500, "Something went wrong generating your reply. Please try again.")

    inc_usage(user["id"], req.service)
    track_opening(user["id"], req.service, reply)
    set_cache(req.thread, tone, req.service, reply)
    used_now = get_usage(user["id"], req.service)
    emit("reply.generated", req.service, {
        "user_id": user["id"],
        "model": svc["model_pro"] if is_pro else svc["model_free"],
        "is_pro": is_pro
    })

    return {
        "reply": reply,
        "from_cache": False,
        "usage": {"used": used_now, "limit": daily_cap, "remaining": max(0, daily_cap - used_now)}
    }

# ─── Saved replies ────────────────────────────────────────────────────────────────
@app.post("/replies/save")
async def save_reply(req: SaveReplyReq, user: dict = Depends(current_user)):
    get_service(req.service)
    db = get_db()
    count = db.execute(
        "SELECT COUNT(*) as c FROM saved_replies WHERE user_id=? AND service=?",
        (user["id"], req.service)
    ).fetchone()["c"]
    if count >= 50:
        raise HTTPException(400, "Max 50 saved replies per service — delete some first.")
    cur = db.execute(
        "INSERT INTO saved_replies (user_id, service, label, content) VALUES (?,?,?,?)",
        (user["id"], req.service, req.label, req.content)
    )
    db.commit()
    rid = cur.lastrowid; db.close()
    emit("reply.saved", req.service, {"user_id": user["id"]})
    return {"id": rid, "saved": True}

@app.get("/replies/saved")
async def get_saved(service: str, user: dict = Depends(current_user)):
    get_service(service)
    db = get_db()
    rows = db.execute("""
        SELECT id, label, content, use_count, created_at
        FROM saved_replies WHERE user_id=? AND service=?
        ORDER BY use_count DESC, created_at DESC
    """, (user["id"], service)).fetchall()
    db.close()
    return [dict(r) for r in rows]

@app.post("/replies/saved/{reply_id}/use")
async def use_saved(reply_id: int, user: dict = Depends(current_user)):
    db = get_db()
    if not db.execute("SELECT id FROM saved_replies WHERE id=? AND user_id=?",
                      (reply_id, user["id"])).fetchone():
        raise HTTPException(404, "Reply not found")
    db.execute("UPDATE saved_replies SET use_count=use_count+1 WHERE id=?", (reply_id,))
    db.commit(); db.close()
    return {"used": True}

@app.patch("/replies/saved/{reply_id}")
async def update_label(reply_id: int, req: UpdateLabelReq, user: dict = Depends(current_user)):
    db = get_db()
    db.execute("UPDATE saved_replies SET label=? WHERE id=? AND user_id=?",
               (req.label, reply_id, user["id"]))
    db.commit(); db.close()
    return {"updated": True}

@app.delete("/replies/saved/{reply_id}")
async def delete_saved(reply_id: int, user: dict = Depends(current_user)):
    db = get_db()
    db.execute("DELETE FROM saved_replies WHERE id=? AND user_id=?", (reply_id, user["id"]))
    db.commit(); db.close()
    return {"deleted": True}

# ─── User profile ────────────────────────────────────────────────────────────────
@app.get("/profile")
async def get_profile(service: str, user: dict = Depends(current_user)):
    get_service(service)
    db = get_db()
    row = db.execute(
        "SELECT * FROM user_profiles WHERE user_id=? AND service=?",
        (user["id"], service)
    ).fetchone()
    db.close()
    return dict(row) if row else {}

@app.put("/profile")
async def update_profile(req: ProfileReq, user: dict = Depends(current_user)):
    get_service(req.service)
    db = get_db()
    db.execute("""
        INSERT INTO user_profiles
            (user_id, service, business_name, business_type, return_policy,
             shipping_info, tone_notes, custom_context, updated_at)
        VALUES (?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, service) DO UPDATE SET
            business_name=?,  business_type=?,  return_policy=?,
            shipping_info=?,  tone_notes=?,     custom_context=?,
            updated_at=CURRENT_TIMESTAMP
    """, (user["id"], req.service, req.business_name, req.business_type,
          req.return_policy, req.shipping_info, req.tone_notes, req.custom_context,
          req.business_name, req.business_type, req.return_policy,
          req.shipping_info, req.tone_notes, req.custom_context))
    db.commit(); db.close()
    emit("profile.updated", req.service, {"user_id": user["id"]})
    return {"saved": True}

# ─── Support ─────────────────────────────────────────────────────────────────────
@app.post("/support/ticket")
async def create_support_ticket(req: SupportTicketReq, request: Request):
    if "@" not in req.email or "." not in req.email.split("@")[-1]:
        raise HTTPException(400, "Valid email required")
    if not req.subject.strip() or not req.message.strip():
        raise HTTPException(400, "Subject and message are required")
    uid = None
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        uid = verify_token(auth.split(" ", 1)[1])
    db = get_db()
    cur = db.execute(
        """INSERT INTO support_tickets (user_id, service, email, subject, message)
           VALUES (?,?,?,?,?)""",
        (uid, req.service, req.email.strip(), req.subject.strip(), req.message.strip()),
    )
    db.commit()
    ticket_id = cur.lastrowid
    db.close()
    emit("support.ticket", req.service, {"ticket_id": ticket_id, "user_id": uid})
    return {"id": ticket_id, "status": "open"}

_SKU_ALLOWED = {
    "skuId", "title", "listPrice", "cogsPerUnit", "shippingOut", "adsPerUnit",
    "unitsSold", "refundRatePct", "netMarginPct", "netProfit", "sourceUrl", "updatedAt",
}

def _sanitize_sku(raw: dict) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    sku_id = str(raw.get("skuId") or raw.get("sku_id") or "").strip()[:128]
    if not sku_id:
        return None
    out = {"skuId": sku_id}
    for key in _SKU_ALLOWED:
        if key == "skuId":
            continue
        if key not in raw:
            continue
        val = raw[key]
        if isinstance(val, str):
            out[key] = val[:2000]
        elif isinstance(val, (int, float)) and not isinstance(val, bool):
            out[key] = val
    return out

@app.get("/skus")
async def list_skus(service: str = "tiktok-seller-tool", user: dict = Depends(current_user)):
    get_service(service)
    db = get_db()
    rows = db.execute(
        "SELECT sku_id, payload_json, updated_at FROM sku_records WHERE user_id=? AND service=? ORDER BY updated_at DESC",
        (user["id"], service),
    ).fetchall()
    db.close()
    skus = []
    for r in rows:
        try:
            payload = json.loads(r["payload_json"] or "{}")
        except json.JSONDecodeError:
            continue
        payload["skuId"] = r["sku_id"]
        payload["updatedAt"] = r["updated_at"]
        skus.append(payload)
    is_pro = get_sub(user["id"], service) == "active"
    return {"skus": skus, "is_pro": is_pro, "limit": -1 if is_pro else get_service(service)["free_limit"]}

@app.put("/skus/sync")
async def sync_skus(req: SkuSyncReq, user: dict = Depends(current_user)):
    svc = get_service(req.service)
    is_pro = get_sub(user["id"], req.service) == "active"
    limit = None if is_pro else int(svc["free_limit"])
    cleaned = []
    skipped = 0
    for raw in req.skus:
        item = _sanitize_sku(raw)
        if item:
            cleaned.append(item)
        else:
            skipped += 1
    db = get_db()
    existing_rows = db.execute(
        "SELECT sku_id FROM sku_records WHERE user_id=? AND service=?",
        (user["id"], req.service),
    ).fetchall()
    existing = {r["sku_id"] for r in existing_rows}
    saved = 0
    for item in cleaned:
        sku_id = item["skuId"]
        is_new = sku_id not in existing
        if limit is not None and is_new and len(existing) >= limit:
            skipped += 1
            continue
        db.execute(
            """INSERT INTO sku_records (user_id, service, sku_id, payload_json, updated_at)
               VALUES (?,?,?,?, CURRENT_TIMESTAMP)
               ON CONFLICT(user_id, service, sku_id) DO UPDATE SET
                 payload_json=EXCLUDED.payload_json, updated_at=CURRENT_TIMESTAMP""",
            (user["id"], req.service, sku_id, json.dumps(item)),
        )
        existing.add(sku_id)
        saved += 1
    db.commit()
    db.close()
    if saved == 0 and skipped > 0 and limit is not None and len(existing) >= limit:
        raise HTTPException(status_code=402, detail=f"Free tier limit: {limit} SKUs. Upgrade to Pro.")
    return {"saved": saved, "skipped": skipped}

# ─── Stripe ───────────────────────────────────────────────────────────────────────
@app.post("/stripe/create-checkout")
@app.post("/billing/checkout")
async def create_checkout(req: CheckoutReq, user: dict = Depends(current_user)):
    svc = get_service(req.service)
    interval = (req.billing_interval or "monthly").lower()
    if interval == "yearly":
        price_id = svc.get("pro_price_id_yearly") or svc.get("pro_price_id")
    else:
        price_id = svc.get("pro_price_id")
    if not price_id:
        raise HTTPException(400, f"No Stripe price configured for {req.service}")
    db = get_db()
    cid = db.execute("SELECT stripe_customer_id FROM users WHERE id=?",
                     (user["id"],)).fetchone()["stripe_customer_id"]
    if not cid:
        cust = stripe.Customer.create(email=user["email"])
        cid = cust.id
        db.execute("UPDATE users SET stripe_customer_id=? WHERE id=?", (cid, user["id"]))
        db.commit()
    db.close()
    ret = billing_return_base()
    session = stripe.checkout.Session.create(
        customer=cid,
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=f"{ret}/billing/done?ok=1",
        cancel_url=f"{ret}/billing/done?ok=0",
        metadata={"user_id": str(user["id"]), "service": req.service},
        **checkout_extra(req.service),
    )
    return {"url": session.url}

@app.post("/stripe/portal")
@app.post("/billing/portal")
async def portal(user: dict = Depends(current_user)):
    db = get_db()
    cid = db.execute("SELECT stripe_customer_id FROM users WHERE id=?",
                     (user["id"],)).fetchone()["stripe_customer_id"]
    db.close()
    if not cid: raise HTTPException(400, "No subscription found")
    sess = stripe.billing_portal.Session.create(
        customer=cid,
        return_url=f"{billing_return_base()}/billing/done?ok=1",
    )
    return {"url": sess.url}

@app.get("/billing/done")
async def billing_done(ok: Optional[str] = "1"):
    """Landing after Stripe Checkout. Pro is granted by the webhook, not this page."""
    paid = ok not in ("0", "false", "cancel")
    title = "You're all set" if paid else "Checkout cancelled"
    message = (
        "Return to the MarginMark popup. Pro unlocks a few seconds after payment."
        if paid
        else "No charge. You can try Upgrade to Pro again from the extension."
    )
    heading = title
    body = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>MarginMark — {heading}</title>
<style>body{{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;color:#0f172a;line-height:1.45}} a{{color:#0f172a}}</style>
</head><body>
<h1>{heading}</h1>
<p>{message}</p>
<p>MarginMark by Plainsman Software · <a href="https://plainsmansoftware.com/marginmark/privacy">Privacy</a> · <a href="https://plainsmansoftware.com/marginmark/terms">Terms</a></p>
</body></html>"""
    return HTMLResponse(body)

@app.post("/billing/promo")
async def redeem_billing_promo(req: PromoRedeemReq, user: dict = Depends(current_user)):
    get_service(req.service)
    db = get_db()
    try:
        result = promo_mod.redeem_promo(
            db, user_id=user["id"], service=req.service, code=req.code
        )
        db.commit()
    except promo_mod.PromoError as exc:
        db.close()
        raise HTTPException(exc.status, str(exc))
    except Exception:
        db.close()
        raise
    db.close()
    emit("billing.promo_redeemed", req.service, {"code": result["code"]}, user_id=user["id"])
    return result


@app.get("/config/remote")
async def remote_config(service: str = "tiktok-seller-tool"):
    get_service(service)
    db = get_db()
    rows = db.execute(
        "SELECT key, value_json FROM remote_config WHERE service=?",
        (service,),
    ).fetchall()
    db.close()
    out: dict = {}
    for r in rows:
        try:
            out[r["key"]] = json.loads(r["value_json"])
        except json.JSONDecodeError:
            out[r["key"]] = r["value_json"]
    return {"service": service, "config": out}


_OPS_HTML = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "ops.html")


@app.get("/ops")
async def ops_console():
    if not os.path.isfile(_OPS_HTML):
        raise HTTPException(404, "Ops console missing")
    return FileResponse(_OPS_HTML, media_type="text/html")


@app.get("/admin/overview")
async def admin_overview(request: Request, service: Optional[str] = None):
    require_telemetry_admin(request)
    db = get_db()
    users = db.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
    q = "SELECT COUNT(*) AS n FROM subscriptions WHERE status='active'"
    params: list = []
    if service:
        q += " AND service=?"
        params.append(service)
    pro = db.execute(q, params).fetchone()["n"]
    db.close()
    return {
        "users": users,
        "pro_rows": pro,
        "services": list(SERVICES.keys()),
        "app_env": APP_ENV,
    }


@app.get("/admin/users")
async def admin_users(
    request: Request,
    service: Optional[str] = None,
    q: str = "",
    limit: int = 200,
):
    require_telemetry_admin(request)
    limit = min(max(limit, 1), 1000)
    needle = q.strip().lower()
    db = get_db()
    join = "LEFT JOIN subscriptions s ON s.user_id=u.id"
    params: list = []
    if service:
        join += " AND s.service=?"
        params.append(service)
    sql = f"""
        SELECT u.id, u.email, u.created_at, u.stripe_customer_id,
               s.service, s.status, s.stripe_sub_id, s.promo_expires_at
        FROM users u
        {join}
    """
    if needle:
        sql += " WHERE (u.email LIKE ? OR CAST(u.id AS TEXT) LIKE ?)"
        params.extend([f"%{needle}%", f"%{needle}%"])
    sql += " ORDER BY u.id DESC LIMIT ?"
    params.append(limit)
    rows = db.execute(sql, params).fetchall()
    ids = [r["id"] for r in rows]
    providers: dict[int, list[str]] = {}
    if ids:
        placeholders = ",".join("?" for _ in ids)
        idents = db.execute(
            f"SELECT user_id, provider FROM oauth_identities WHERE user_id IN ({placeholders})",
            ids,
        ).fetchall()
        for ident in idents:
            providers.setdefault(int(ident["user_id"]), []).append(ident["provider"])
    db.close()
    users = []
    for r in rows:
        item = dict(r)
        item["oauth_providers"] = providers.get(int(r["id"]), [])
        users.append(item)
    return {"users": users}


@app.patch("/admin/users/{user_id}")
async def admin_patch_user(user_id: int, req: AdminUserPatchReq, request: Request):
    require_telemetry_admin(request)
    if req.service != "*":
        get_service(req.service)
    db = get_db()
    try:
        touched_user = any(
            [
                req.email is not None,
                req.password not in (None, ""),
                req.stripe_customer_id is not None,
                req.clear_stripe_customer,
            ]
        )
        if touched_user:
            admin_db.patch_user(
                db,
                user_id,
                email=req.email,
                password=req.password,
                stripe_customer_id=req.stripe_customer_id,
                clear_stripe_customer=req.clear_stripe_customer,
            )
        touched_sub = any(
            [
                req.status is not None,
                req.stripe_sub_id is not None,
                req.promo_expires_at is not None,
                req.clear_stripe_sub,
                req.clear_promo,
            ]
        )
        if touched_sub:
            admin_db.upsert_subscription(
                db,
                user_id,
                req.service,
                status=req.status,
                stripe_sub_id=req.stripe_sub_id,
                promo_expires_at=req.promo_expires_at,
                clear_stripe_sub=req.clear_stripe_sub,
                clear_promo=req.clear_promo,
            )
        promo_result = None
        if req.promo_code:
            try:
                promo_result = promo_mod.redeem_promo(
                    db,
                    user_id=user_id,
                    service=req.service,
                    code=req.promo_code,
                )
                db.commit()
            except promo_mod.PromoError as exc:
                raise HTTPException(exc.status, str(exc)) from exc
        if not touched_user and not touched_sub and not req.promo_code:
            raise HTTPException(400, "No fields to update")
        emit(
            "admin.user_patched",
            req.service,
            {"user_id": user_id, "email": req.email or ""},
            user_id=user_id,
        )
        return {"ok": True, "promo": promo_result}
    except admin_db.AdminDbError as exc:
        raise HTTPException(exc.status, exc.detail) from exc
    finally:
        db.close()


@app.post("/admin/users/{user_id}/reset-password")
async def admin_reset_password(user_id: int, request: Request):
    require_telemetry_admin(request)
    db = get_db()
    try:
        password = admin_db.reset_user_password(db, user_id)
        emit("admin.password_reset", "tiktok-seller-tool", {"user_id": user_id}, user_id=user_id)
        return {"ok": True, "temporary_password": password}
    except admin_db.AdminDbError as exc:
        raise HTTPException(exc.status, exc.detail) from exc
    finally:
        db.close()


@app.post("/admin/users/{user_id}/delete")
async def admin_delete_user(user_id: int, request: Request):
    require_telemetry_admin(request)
    db = get_db()
    try:
        admin_db.delete_user(db, user_id)
        emit("admin.user_deleted", "tiktok-seller-tool", {"user_id": user_id})
        return {"ok": True}
    except admin_db.AdminDbError as exc:
        raise HTTPException(exc.status, exc.detail) from exc
    finally:
        db.close()


@app.get("/admin/promos")
async def admin_list_promos(request: Request):
    require_telemetry_admin(request)
    db = get_db()
    rows = db.execute("SELECT * FROM promo_codes ORDER BY created_at DESC").fetchall()
    db.close()
    return {"promos": [dict(r) for r in rows]}


@app.post("/admin/promos")
async def admin_create_promo(req: AdminPromoReq, request: Request):
    require_telemetry_admin(request)
    code = promo_mod.normalize_code(req.code)
    if not promo_mod.CODE_RE.match(code):
        raise HTTPException(400, "Code must be 4–32 chars: A–Z, 0–9, _-")
    if req.service != "*" :
        get_service(req.service)
    db = get_db()
    existing = db.execute("SELECT code FROM promo_codes WHERE code=?", (code,)).fetchone()
    if existing:
        db.close()
        raise HTTPException(400, "Code already exists")
    db.execute(
        """INSERT INTO promo_codes (code, service, duration_days, max_redemptions, redeemed_count, active)
           VALUES (?,?,?,?,0,1)""",
        (code, req.service, req.duration_days, req.max_redemptions),
    )
    db.commit()
    db.close()
    emit("admin.promo_created", req.service, {"code": code, "days": req.duration_days})
    return {"ok": True, "code": code}


@app.post("/admin/promos/{code}/toggle")
async def admin_toggle_promo(code: str, request: Request):
    require_telemetry_admin(request)
    code = promo_mod.normalize_code(code)
    db = get_db()
    row = db.execute("SELECT active FROM promo_codes WHERE code=?", (code,)).fetchone()
    if not row:
        db.close()
        raise HTTPException(404, "Unknown code")
    nxt = 0 if int(row["active"]) else 1
    db.execute("UPDATE promo_codes SET active=? WHERE code=?", (nxt, code))
    db.commit()
    db.close()
    return {"ok": True, "active": bool(nxt)}


@app.put("/admin/config")
async def admin_put_config(req: AdminConfigReq, request: Request):
    require_telemetry_admin(request)
    get_service(req.service)
    key = req.key.strip()[:64]
    db = get_db()
    db.execute(
        """INSERT INTO remote_config (service, key, value_json)
           VALUES (?,?,?)
           ON CONFLICT(service, key) DO UPDATE SET value_json=?, updated_at=CURRENT_TIMESTAMP""",
        (req.service, key, json.dumps(req.value), json.dumps(req.value)),
    )
    db.commit()
    db.close()
    return {"ok": True}


def _admin_db_call(fn, *args, **kwargs):
    db = get_db()
    try:
        return fn(db, *args, **kwargs)
    except admin_db.AdminDbError as exc:
        raise HTTPException(exc.status, exc.detail) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    finally:
        db.close()


@app.get("/admin/db/tables")
async def admin_db_tables(request: Request):
    require_telemetry_admin(request)
    return {"tables": _admin_db_call(admin_db.list_tables)}


@app.get("/admin/db/rows")
async def admin_db_rows(
    request: Request,
    table: str,
    q: str = "",
    limit: int = 50,
    offset: int = 0,
):
    require_telemetry_admin(request)
    return _admin_db_call(admin_db.list_rows, table, q=q, limit=limit, offset=offset)


@app.post("/admin/db/rows")
async def admin_db_insert(req: AdminDbWriteReq, request: Request):
    require_telemetry_admin(request)
    return _admin_db_call(admin_db.insert_row, req.table, req.values or {})


@app.put("/admin/db/rows")
async def admin_db_update(req: AdminDbWriteReq, request: Request):
    require_telemetry_admin(request)
    if not req.pk:
        raise HTTPException(400, "pk required")
    return _admin_db_call(admin_db.update_row, req.table, req.pk, req.values or {})


@app.post("/admin/db/rows/delete")
async def admin_db_delete(req: AdminDbWriteReq, request: Request):
    require_telemetry_admin(request)
    if not req.pk:
        raise HTTPException(400, "pk required")
    return _admin_db_call(admin_db.delete_row, req.table, req.pk)


@app.post("/stripe/webhook")
@app.post("/billing/webhook")
async def webhook(request: Request):
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(503, "Webhook not configured")
    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except Exception:
        raise HTTPException(400, "Invalid webhook signature")

    if event["type"] == "checkout.session.completed":
        s = event["data"]["object"]
        uid = s["metadata"].get("user_id")
        service = s["metadata"].get("service")
        if uid and service:
            set_sub(int(uid), service, "active", s.get("subscription"))
            emit("stripe.upgraded", service, {"user_id": uid})

    elif event["type"] in (
        "customer.subscription.updated",
        "customer.subscription.created",
        "charge.succeeded",
    ):
        obj = event["data"]["object"]
        if event["type"] == "charge.succeeded":
            # Subscriptions are activated via checkout.session.completed / subscription.updated.
            return {"ok": True}
        status = obj.get("status")
        mapped = "active" if status in ("active", "trialing") else "free"
        sub_id = obj.get("id")
        if sub_id:
            db = get_db()
            db.execute(
                "UPDATE subscriptions SET status=? WHERE stripe_sub_id=?",
                (mapped, sub_id),
            )
            db.commit()
            db.close()
            emit("stripe.subscription_updated", "platform", {"sub_id": sub_id, "status": mapped})

    elif event["type"] in ("customer.subscription.deleted", "customer.subscription.paused"):
        sub = event["data"]["object"]
        db = get_db()
        db.execute("UPDATE subscriptions SET status='free' WHERE stripe_sub_id=?", (sub["id"],))
        db.commit(); db.close()
        emit("stripe.cancelled", "platform", {"sub_id": sub["id"]})

    elif event["type"] == "invoice.payment_failed":
        sub = event["data"]["object"]
        db = get_db()
        cid = sub.get("customer")
        if cid:
            u = db.execute("SELECT id FROM users WHERE stripe_customer_id=?", (cid,)).fetchone()
            if u:
                db.execute("UPDATE subscriptions SET status='past_due' WHERE user_id=?", (u["id"],))
                db.commit()
        db.close()

    return {"ok": True}

# ─── Telemetry API (extension + your dashboard app) ─────────────────────────────
def _optional_user_from_request(request: Request) -> Optional[int]:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    return verify_token(auth.split(" ", 1)[1])


@app.post("/telemetry/event")
async def telemetry_event(req: TelemetryEventReq, request: Request):
    """Extension clients — fire-and-forget usage events."""
    uid = _optional_user_from_request(request)
    props = req.properties or {}
    if not isinstance(props, dict):
        props = {}
    # Never persist secrets if a client accidentally sends them.
    redacted = {
        k: v
        for k, v in props.items()
        if k.lower() not in ("password", "token", "authorization", "secret", "jwt")
    }
    emit(
        req.event[:80],
        req.service,
        redacted,
        user_id=uid,
        source="extension",
    )
    return {"ok": True}


@app.get("/admin/telemetry/events")
async def telemetry_events(
    request: Request,
    service: Optional[str] = None,
    event: Optional[str] = None,
    q: str = "",
    limit: int = 500,
    since: Optional[str] = None,
):
    """Read events for your internal telemetry app (header: X-Admin-Key)."""
    require_telemetry_admin(request)
    limit = min(max(limit, 1), 5000)
    sql = """
        SELECT t.id, t.ts, t.service, t.event, t.user_id, t.payload_json, t.source, u.email
        FROM telemetry_events t
        LEFT JOIN users u ON u.id = t.user_id
        WHERE 1=1
    """
    params: list = []
    if service:
        sql += " AND t.service=?"
        params.append(service)
    if event:
        sql += " AND t.event=?"
        params.append(event)
    if since:
        sql += " AND t.ts>=?"
        params.append(since)
    needle = q.strip()
    if needle:
        sql += " AND (u.email LIKE ? OR CAST(t.user_id AS TEXT) LIKE ? OR t.payload_json LIKE ?)"
        like = f"%{needle}%"
        params.extend([like, like, like])
    sql += " ORDER BY t.id DESC LIMIT ?"
    params.append(limit)
    db = get_db()
    rows = db.execute(sql, params).fetchall()
    db.close()
    return {
        "events": [
            {
                "id": r["id"],
                "ts": r["ts"],
                "service": r["service"],
                "event": r["event"],
                "user_id": r["user_id"],
                "email": r["email"],
                "properties": json.loads(r["payload_json"] or "{}"),
                "source": r["source"],
            }
            for r in rows
        ]
    }


@app.get("/admin/telemetry/summary")
async def telemetry_summary(request: Request, service: Optional[str] = None, days: int = 7):
    require_telemetry_admin(request)
    days = min(max(days, 1), 90)
    db = get_db()
    window_sql, window_params = telemetry_window_sql(days)
    q = f"""
        SELECT service, event, COUNT(*) AS n
        FROM telemetry_events
        WHERE {window_sql}
    """
    params: list = list(window_params)
    if service:
        q += " AND service=?"
        params.append(service)
    q += " GROUP BY service, event ORDER BY n DESC"
    rows = db.execute(q, params).fetchall()
    db.close()
    return {"days": days, "counts": [dict(r) for r in rows]}


# ─── Health ───────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    body = {
        "status": "ok",
        "app_env": APP_ENV,
        "services": list(SERVICES.keys()),
        "db": "postgres" if USE_POSTGRES else "sqlite",
        "ts": datetime.utcnow().isoformat(),
    }
    if ENV != "production":
        body["db_path"] = None if USE_POSTGRES else DB_PATH
        body["telemetry_admin"] = bool(TELEMETRY_ADMIN_KEY)
    return body


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
