# INDEX

| Doc | Read when |
|---|---|
| `STATE.md` | starting work — backlog, blockers |
| `MAP.md` | before touching source |
| `VERIFY.md` | validation step |
| `DECISIONS.md` | architecture choices |
| `TIKTOK_SELLER_TOOL_CURSOR_PROMPT.md` | product + feature spec (repo root) |

## Project

Manifest V3 Chrome extension: profit overlay, SPS badge, and SKU dashboard on TikTok Shop Seller Center. Pro auth/billing/SKU sync via FastAPI in `backend/`.

## Architecture

Content script scrapes seller pages → `profit.ts` → Shadow DOM overlay. Popup reads `chrome.storage.local`. Service worker routes messages + 6h SPS alarm. Pro calls `backend/main.py` (`service=tiktok-seller-tool`).

## Invariants

1. API keys stay on the backend — never in the extension bundle.
2. Free tier works offline except Stripe; scrape miss must not crash the overlay.
3. Free SKU cap is 10 (`FREE_SKU_LIMIT` + backend `free_limit`).
4. Do not commit `.env` or local `*.db`.
