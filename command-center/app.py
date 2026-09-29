"""Plainsman Command Center. Cloudflare Access, then WebAuthn on every write."""

from __future__ import annotations

import json
import os
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"


def _allowlist() -> set[str]:
    return {item.strip() for item in os.getenv("ADMIN_IP_ALLOWLIST", "").split(",") if item.strip()}


def _deny(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"error": detail}, status_code=status)


def require_access(request: Request) -> JSONResponse | None:
    allow = _allowlist()
    host = request.client.host if request.client else ""
    if allow and host not in allow:
        return _deny(403, "IP denied")
    aud = os.getenv("CF_ACCESS_AUD", "").strip()
    if not aud:
        if os.getenv("ENV") == "production":
            return _deny(401, "Cloudflare Access required")
        return None
    token = request.headers.get("cf-access-jwt-assertion", "")
    if not token or token.count(".") != 2:
        return _deny(401, "Cloudflare Access required")
    return None


def require_webauthn(request: Request) -> JSONResponse | None:
    assertion = request.headers.get("x-webauthn-assertion", "")
    if os.getenv("ENV") == "production":
        try:
            import webauthn  # noqa: F401
        except ImportError:
            return _deny(401, "WebAuthn required")
        if not assertion:
            return _deny(401, "WebAuthn required")
        return None
    expected = os.getenv("WEBAUTHN_TEST_ASSERTION", "")
    if not assertion or not expected or not secrets.compare_digest(assertion, expected):
        return _deny(401, "WebAuthn required")
    return None


def load_products() -> list[dict[str, str]]:
    products = []
    current: dict[str, str] = {}
    for raw in (BASE / "products.yaml").read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("- id:"):
            if current:
                products.append(current)
            current = {"id": line.split(":", 1)[1].strip()}
        elif ":" in line and current:
            key, value = line.split(":", 1)
            current[key.strip()] = value.strip()
    if current:
        products.append(current)
    return products


def create_app() -> FastAPI:
    app = FastAPI(title="Plainsman Command Center", docs_url=None, redoc_url=None, openapi_url=None)
    audits: list[dict[str, str]] = []

    @app.middleware("http")
    async def guard(request: Request, call_next):
        if request.url.path.startswith("/static") or request.url.path == "/health":
            return await call_next(request)
        denied = require_access(request)
        if denied:
            return denied
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            denied = require_webauthn(request)
            if denied:
                return denied
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none'"
        return response

    @app.get("/health")
    async def health():
        return {"ok": True}

    @app.get("/")
    async def index():
        return FileResponse(STATIC / "index.html")

    @app.get("/api/products")
    async def products():
        rows = load_products()
        return {"products": rows, "all": rows}

    @app.post("/api/audit")
    async def add_audit(request: Request):
        body = await request.json()
        row = {
            "id": uuid.uuid4().hex,
            "at": datetime.now(timezone.utc).isoformat(),
            "actor": "owner",
            "action": str(body.get("action", ""))[:80],
            "before_json": json.dumps(body.get("before")),
            "after_json": json.dumps(body.get("after")),
        }
        audits.append(row)
        return row

    @app.get("/api/audit")
    async def list_audit():
        return {"rows": audits}

    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app


app = create_app()
