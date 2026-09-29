"""Shared Free / Pro / Diamond limits. Numbers live in src/tiers.json."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

def resolve_tiers_path() -> Path:
    override = os.getenv("TIERS_PATH", "").strip()
    if override:
        return Path(override)
    here = Path(__file__).resolve().parent
    bundled = here / "tiers.json"
    if bundled.is_file():
        return bundled
    return here.parent / "src" / "tiers.json"


TIERS = json.loads(resolve_tiers_path().read_text(encoding="utf-8"))
PLAN_NAMES = ("free", "pro", "diamond")


def price_id(plan: str, interval: str) -> Optional[str]:
    if plan == "pro" and interval == "monthly":
        return os.getenv("STRIPE_PRICE_PRO_MONTHLY") or os.getenv("STRIPE_PRICE_TIKTOK_SELLER")
    if plan == "pro" and interval == "yearly":
        return os.getenv("STRIPE_PRICE_PRO_YEARLY") or os.getenv("STRIPE_PRICE_TIKTOK_SELLER_YEARLY")
    if plan == "diamond" and interval == "monthly":
        return os.getenv("STRIPE_PRICE_DIAMOND_MONTHLY")
    if plan == "diamond" and interval == "yearly":
        return os.getenv("STRIPE_PRICE_DIAMOND_YEARLY")
    return None


def tier_for_price(price: Optional[str]) -> Optional[str]:
    if not price:
        return None
    for plan, interval in (("pro", "monthly"), ("pro", "yearly"), ("diamond", "monthly"), ("diamond", "yearly")):
        if price_id(plan, interval) == price:
            return plan
    return None


def _parse_time(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def effective_tier(row: Optional[dict[str, Any]], *, active: bool, now: Optional[datetime] = None) -> str:
    current = now or datetime.now(timezone.utc)
    if row:
        override = row.get("tier_override")
        if override in PLAN_NAMES:
            expires = _parse_time(row.get("tier_override_expires_at"))
            if expires is None or expires > current:
                return str(override)
    if not active:
        return "free"
    tier = (row or {}).get("tier")
    if tier in ("pro", "diamond"):
        return str(tier)
    # Paid or granted rows written before the tier column existed, or by a
    # manual grant, have tier NULL/'free'. Active always means at least Pro.
    return "pro"


def ai_monthly_limit(tier: str) -> int:
    return int(TIERS.get(tier, TIERS["free"])["aiPerMonth"])
