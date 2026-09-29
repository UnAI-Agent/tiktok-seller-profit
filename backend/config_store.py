"""Load the last signed config. No private key."""

from __future__ import annotations

import json
from typing import Any


def load_published() -> dict[str, Any] | None:
    import db as db_mod

    conn = db_mod.get_db()
    try:
        row = conn.execute(
            "SELECT document_json FROM signed_remote_config WHERE service=?",
            ("tiktok-seller-tool",),
        ).fetchone()
    except Exception:
        row = None
    finally:
        conn.close()
    if not row:
        return None
    try:
        return json.loads(row["document_json"])
    except json.JSONDecodeError:
        return None
