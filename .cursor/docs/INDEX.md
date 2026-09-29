# INDEX

| Doc | Read when |
|---|---|
| `STATE.md` | starting work — backlog, blockers |
| `MAP.md` | before touching source |
| `VERIFY.md` | validation step |
| `DECISIONS.md` | architecture choices |
| `DEPLOY.md` | LLE vs prod hosting |
| `ops/ALERTS.md` | New Relic alert list |
| `ops/grafana/README.md` | Grafana read-only views |
| `command-center/DEPLOY.md` | Command Center access |
| `TIKTOK_SELLER_TOOL_CURSOR_PROMPT.md` | product + feature spec (repo root) |
| `test-fixtures/real/README.md` | how to capture scrubbed Seller Center HTML |

## Project

Manifest V3 Chrome extension: per-unit profit overlay and SKU dashboard on TikTok Shop Seller Center. Pro auth/billing/SKU sync via FastAPI in `backend/`.

## Architecture

Content script scrapes seller pages → `profit.ts` → closed Shadow DOM overlay. Popup reads `chrome.storage.local`. Service worker validates messages + runs the 6h SPS alarm. Pro calls the dedicated `backend/marginmark_app.py`. Owner ops console: `GET /ops` (admin keys stay outside the extension).

## Invariants

1. API keys stay on the backend — never in the extension bundle.
2. Free tier works offline except Stripe; scrape miss must not crash the overlay.
3. Free SKU cap is 10 (`FREE_SKU_LIMIT` + backend `free_limit`).
4. Do not commit `.env` or local `*.db`.
