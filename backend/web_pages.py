"""Branded HTML shell for the few pages the API serves (reset, billing, OAuth).

The API CSP allows inline styles but no inline scripts, so everything here is
static markup. Every dynamic value is escaped by the caller or here.
"""

from __future__ import annotations

import html

PRIVACY_URL = "https://plainsmansoftware.com/marginmark/privacy"
TERMS_URL = "https://plainsmansoftware.com/marginmark/terms"
SUPPORT_EMAIL = "support@plainsmansoftware.com"

_LOGO = (
    '<svg width="36" height="36" viewBox="0 0 32 32" aria-hidden="true">'
    '<rect width="32" height="32" rx="8" fill="#0f172a"/>'
    '<path d="M7.5 23.5V10.5L16 17.5l8.5-7V23.5" fill="none" stroke="#fff" '
    'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'
    '<path d="M8 27h16" stroke="#34d399" stroke-width="2.6" stroke-linecap="round"/></svg>'
)

_ICONS = {
    "ok": ('#059669', '#ecfdf5', '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
    "error": ('#e11d48', '#fff1f2', '<path d="M12 7v6m0 4h.01" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
    "info": ('#475569', '#f1f5f9', '<path d="M12 11v6m0-10h.01" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
    "lock": ('#4f46e5', '#eef2ff', '<rect x="6" y="11" width="12" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 11V8a3 3 0 016 0v3" fill="none" stroke="currentColor" stroke-width="2"/>'),
}

_CSS = """
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:linear-gradient(180deg,#f8fafc 0%,#eef2f7 100%);color:#0f172a;
font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:24px}
.card{width:100%;max-width:420px;background:#fff;border:1px solid #e2e8f0;border-radius:18px;
box-shadow:0 10px 30px -12px rgba(15,23,42,.18);padding:28px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px;margin-bottom:22px}
.brand small{display:block;font-weight:500;color:#64748b;font-size:12px}
.icon{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:14px}
.icon svg{width:24px;height:24px}
h1{font-size:21px;line-height:1.25;margin:0 0 6px}
p{margin:0 0 12px;color:#475569}
label{display:block;font-size:13px;font-weight:600;color:#334155;margin:14px 0 6px}
input[type=password],input[type=text],input[type=email]{width:100%;padding:11px 12px;border:1px solid #cbd5e1;border-radius:10px;font:inherit;background:#f8fafc}
input:focus{outline:none;border-color:#0f172a;background:#fff;box-shadow:0 0 0 3px rgba(15,23,42,.08)}
.btn{display:inline-block;width:100%;margin-top:18px;padding:12px 14px;border:0;border-radius:10px;background:#0f172a;color:#fff;
font-family:inherit;font-weight:600;font-size:15px;line-height:1.2;text-align:center;text-decoration:none;cursor:pointer}
.btn:hover{background:#1e293b}
.rules{margin:10px 0 0;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font-size:12.5px;color:#475569}
.rules li{margin:2px 0 2px 16px}
.alert{padding:10px 12px;border-radius:10px;font-size:13.5px;margin:0 0 12px}
.alert.error{background:#fff1f2;color:#9f1239;border:1px solid #fecdd3}
.alert.ok{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}
.steps{margin:6px 0 0;padding:0;list-style:none}
.steps li{display:flex;gap:10px;align-items:flex-start;margin:8px 0;color:#334155;font-size:14px}
.steps li>b:first-child{flex:none;width:22px;height:22px;border-radius:999px;background:#0f172a;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center}
footer{margin-top:22px;padding-top:14px;border-top:1px solid #f1f5f9;font-size:12px;color:#94a3b8;display:flex;flex-wrap:wrap;gap:6px 12px}
footer a{color:#64748b}
"""


def page(
    *,
    title: str,
    heading: str,
    body_html: str,
    tone: str = "info",
    head_extra: str = "",
    status_code: int = 200,
) -> tuple[str, int]:
    """Return (html, status). `body_html` must already be escaped by the caller."""
    color, bg, path = _ICONS.get(tone, _ICONS["info"])
    icon = (
        f'<div class="icon" style="background:{bg};color:{color}">'
        f'<svg viewBox="0 0 24 24" aria-hidden="true">{path}</svg></div>'
    )
    doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>{html.escape(title)}</title><style>{_CSS}</style>{head_extra}</head>
<body><main class="card">
<div class="brand">{_LOGO}<span>MarginMark<small>by Plainsman Software</small></span></div>
{icon}<h1>{html.escape(heading)}</h1>
{body_html}
<footer><span>Need help? <a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a></span>
<a href="{PRIVACY_URL}">Privacy</a><a href="{TERMS_URL}">Terms</a></footer>
</main></body></html>"""
    return doc, status_code


def esc(value: str) -> str:
    return html.escape(value or "", quote=True)


def reset_form(token: str, error: str = "") -> tuple[str, int]:
    alert = f'<div class="alert error" role="alert">{esc(error)}</div>' if error else ""
    body = f"""<p>Pick a new password for your MarginMark account. You'll be signed out everywhere else.</p>
{alert}
<form method="post" action="/auth/reset" autocomplete="off">
<input type="hidden" name="token" value="{esc(token)}">
<label for="pw">New password</label>
<input id="pw" type="password" name="password" minlength="8" maxlength="128" required autocomplete="new-password">
<label for="pw2">Confirm new password</label>
<input id="pw2" type="password" name="confirm" minlength="8" maxlength="128" required autocomplete="new-password">
<ul class="rules"><li>At least 8 characters</li><li>At least 3 of: uppercase, lowercase, number, symbol</li></ul>
<button class="btn" type="submit">Save new password</button>
</form>"""
    return page(title="Reset your password · MarginMark", heading="Choose a new password", body_html=body, tone="lock", status_code=400 if error else 200)


def reset_invalid() -> tuple[str, int]:
    body = """<p>This reset link is invalid, already used, or older than 30 minutes.</p>
<p>Open MarginMark in Seller Center, choose <b>Log in → Forgot password?</b>, and we'll email a fresh link.</p>"""
    return page(title="Link expired · MarginMark", heading="This link has expired", body_html=body, tone="error", status_code=400)


def reset_done() -> tuple[str, int]:
    body = """<div class="alert ok">Your password was updated and other sessions were signed out.</div>
<ul class="steps"><li><b>1</b>Go back to TikTok Shop Seller Center.</li>
<li><b>2</b>Click the MarginMark icon and log in with your new password.</li></ul>"""
    return page(title="Password updated · MarginMark", heading="Password updated", body_html=body, tone="ok")


def billing_done(paid: bool) -> tuple[str, int]:
    if paid:
        body = """<p>Thanks for upgrading. Pro unlocks automatically within about a minute.</p>
<ul class="steps"><li><b>1</b>Close this tab and go back to Seller Center.</li>
<li><b>2</b>Open MarginMark. You'll see a <b>PRO</b> badge next to the logo.</li>
<li><b>3</b>Still showing Free? Open your account (person icon) and tap the refresh arrow next to <b>Plan &amp; billing</b>.</li></ul>
<p style="margin-top:12px;font-size:13px">Manage or cancel anytime from <b>Account → Manage billing</b>.</p>"""
        return page(title="You're on Pro · MarginMark", heading="Welcome to MarginMark Pro", body_html=body, tone="ok")
    body = """<p>No charge was made. You can upgrade anytime from the MarginMark panel in Seller Center.</p>"""
    return page(title="Checkout cancelled · MarginMark", heading="Checkout cancelled", body_html=body, tone="info")
