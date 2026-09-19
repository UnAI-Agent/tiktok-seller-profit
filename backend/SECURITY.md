# Security notes

## Chrome Web Store

The **database never ships inside the extension**. Only the API URL is configured at build time. All user accounts and telemetry live on **your backend** (`backend/data/platform.db` locally, Postgres when deployed).

## Passwords

- Stored as **bcrypt** hashes only (`security/passwords.py`).
- Policy on register: 8+ characters with at least 3 of: upper, lower, digit, special.
- Legacy SHA-256 hashes are upgraded to bcrypt on next successful login.
- Forgot-password always returns success (no account enumeration).

## SQL injection

All queries use **parameterized** `?` placeholders (SQLite / `%s` on Postgres). Never concatenate user input into SQL.

## XSS

- API returns **JSON**; no HTML rendering on the server.
- Extension UI is **React** (escaped by default). Do not use `dangerouslySetInnerHTML` for user or scraped content.
- Passwords are **not** stored in `chrome.storage` — only the JWT after login.

## CORS

Popup origin is `chrome-extension://<id>`. Credentials + `allow_origins=["*"]` is invalid. The API allows localhost plus `chrome-extension://` IDs via regex.

## Rate limits

120 requests / minute / IP. `Retry-After` is set on 429. Webhooks and `/health` are excluded.

## Error responses

Production (`ENV=production`) never returns stack traces. JWT_SECRET is required in production.

## Secrets

- Keep `.env`, `data/*.db`, and `TELEMETRY_ADMIN_KEY` out of git (see `.gitignore`).
- Rotate any password that was shared in chat or logs.

This is **not** a SOC 2 certification. It is the control set for launch: least-privilege storage, hashed passwords, no secrets in the extension, parameterized SQL, and no PII in client error dumps.
