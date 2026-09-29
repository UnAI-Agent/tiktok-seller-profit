"""Signed remote-config schema. The private key never lives in this process."""

from __future__ import annotations

import base64
import json
import re
from datetime import datetime, timezone
from typing import Any

FLAG_KEYS = (
    "overlay",
    "productCheck",
    "aiInsights",
    "trendsTelemetry",
    "trendsView",
    "diamondEnabled",
    "statementImport",
    "bulkScan",
    "promoGuard",
    "whatIf",
    "csvExport",
    "creatorProfit",
    "bulkCost",
)
SURFACES = {"product-edit", "product-list"}
FIELDS = {"productTitle", "listPrice", "unitsSold", "spsScore"}
EXECUTABLE = re.compile(r"javascript:|<script|eval\(|new\s+function", re.I)


class ConfigError(ValueError):
    pass


def _js_numbers(value: Any) -> Any:
    """Match JSON.stringify: integral floats become integers, unicode stays raw."""
    if isinstance(value, dict):
        return {key: _js_numbers(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_js_numbers(item) for item in value]
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def canonical_body(doc: dict[str, Any]) -> bytes:
    body = {key: value for key, value in doc.items() if key != "signature"}
    return json.dumps(
        _js_numbers(body),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def _scan(value: Any) -> None:
    if isinstance(value, str) and EXECUTABLE.search(value):
        raise ConfigError("executable")
    if isinstance(value, list):
        for item in value:
            _scan(item)
    elif isinstance(value, dict):
        for item in value.values():
            _scan(item)


def validate_config(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ConfigError("shape")
    _scan(raw)
    if not isinstance(raw.get("version"), int) or raw["version"] < 1:
        raise ConfigError("version")
    if not isinstance(raw.get("signature"), str) or not 40 <= len(raw["signature"]) <= 200:
        raise ConfigError("signature")
    flags = raw.get("flags")
    if not isinstance(flags, dict) or set(flags) != set(FLAG_KEYS):
        raise ConfigError("flags")
    for key in FLAG_KEYS:
        row = flags[key]
        if not isinstance(row, dict) or not isinstance(row.get("enabled"), bool):
            raise ConfigError("flag")
        rollout = row.get("rolloutPct")
        if not isinstance(rollout, (int, float)) or rollout < 0 or rollout > 100:
            raise ConfigError("rollout")
        reason = row.get("reason")
        if reason is not None and (not isinstance(reason, str) or len(reason) > 120):
            raise ConfigError("reason")
        status = row.get("statusUrl")
        if status is not None and (not isinstance(status, str) or not status.startswith("https://")):
            raise ConfigError("statusUrl")
    if EXECUTABLE.search(json.dumps(raw)):
        raise ConfigError("executable")
    return raw


def verify_signature(doc: dict[str, Any], public_spki_b64: str) -> bool:
    if not public_spki_b64:
        return False
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.hazmat.primitives.serialization import load_der_public_key

        key = load_der_public_key(base64.b64decode(public_spki_b64))
        if not isinstance(key, Ed25519PublicKey):
            return False
        key.verify(base64.b64decode(doc["signature"]), canonical_body(doc))
        return True
    except Exception:
        return False


def expired(doc: dict[str, Any], now: datetime | None = None) -> bool:
    current = now or datetime.now(timezone.utc)
    try:
        exp = datetime.fromisoformat(str(doc["expiresAt"]).replace("Z", "+00:00"))
    except ValueError:
        return True
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    return exp <= current


def diamond_flag_enabled(doc: dict[str, Any] | None) -> bool:
    if not doc:
        return False
    flag = (doc.get("flags") or {}).get("diamondEnabled") or {}
    return bool(flag.get("enabled"))
