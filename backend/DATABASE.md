# Database & telemetry

## Where is the database today?

| Environment | Location | Engine |
|-------------|----------|--------|
| **Local dev** | `ChromExtentionProjects/backend/data/platform.db` (or `DB_PATH` in `.env`) | **SQLite** |
| **Production (recommended)** | Managed **PostgreSQL** on Railway, Fly.io, Neon, or Supabase | Postgres |

The FastAPI app lives in `backend/main.py`. On first run it creates tables: `users`, `subscriptions`, `usage`, `support_tickets`, `telemetry_events`, plus reply-extension tables.

**Important:** TikTok extension **SKUs and profit settings** are still in **Chrome `storage.local`** on the user’s machine. Only **auth, billing, support tickets, and telemetry** hit the backend unless you add cloud SKU sync later.

## What gets captured for telemetry?

All server-side `emit(...)` calls are written to **`telemetry_events`** (and logged).

Examples: `user.registered`, `stripe.upgraded`, `support.ticket`, `reply.generated`, etc.

Extensions can POST:

```http
POST /telemetry/event
Content-Type: application/json
Authorization: Bearer <optional user JWT>

{
  "service": "tiktok-seller-tool",
  "event": "popup.sku_sync",
  "properties": { "found": 12, "saved": 3 }
}
```

## Your second app (telemetry dashboard)

Use a **read-only API** with a secret key (not user JWTs):

```http
GET /admin/telemetry/events?service=tiktok-seller-tool&limit=500
X-Admin-Key: <TELEMETRY_ADMIN_KEY>

GET /admin/telemetry/summary?service=tiktok-seller-tool&days=7
X-Admin-Key: <TELEMETRY_ADMIN_KEY>
```

Point Metabase, Grafana, a small Next.js admin, or a Python script at these endpoints—or connect **directly to Postgres** with the same credentials (best for heavy analytics).

## Recommended hosting stack

1. **API:** Railway or Fly.io — deploy `backend/` (Dockerfile included). Set env vars from `.env.example`.
2. **Database:** Add **PostgreSQL** plugin on Railway (or Neon serverless Postgres). Set `DATABASE_URL`.
3. **Note:** If `DATABASE_URL` is set (Neon `neon link` → `.env`), the API uses **Postgres**; otherwise **SQLite** at `data/platform.db`.

### MVP (single server)

- Railway: Web service + Postgres
- `DB_PATH` unset; implement Postgres connection string (next infra task)
- Extension `VITE_API_BASE_URL=https://your-api.up.railway.app`

### Why Postgres for your telemetry app?

- Another application can **connect with standard SQL** (read replica or read-only user).
- Concurrent reads/writes from API + dashboard.
- SQLite on a laptop is fine for dev; **not** for multi-app production analytics.

## Quick local check

```powershell
cd ChromExtentionProjects\backend
python main.py
curl http://127.0.0.1:8000/health
```

After events occur, inspect SQLite:

```powershell
sqlite3 platform.db "SELECT event, COUNT(*) FROM telemetry_events GROUP BY event;"
```
