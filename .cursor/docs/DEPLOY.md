# Deploy (LLE + prod)

Same git repo. Two Fly apps + two Neon branches. The Chrome extension is not a web server.

**LLE is a real product.** Accounts, OAuth, SKU cap, overlay, and Pro unlock are the same code as prod. The only fake network is **Stripe test mode** (`sk_test_`, card `4242…`). Checkout still creates a session, the webhook still fires, `subscriptions.status` still becomes `active`, and unlimited SKUs still unlock. You do not buy Pro on live Stripe to prove prod. You prove the **same webhook path** on LLE.

This app does not ship packages. Overlay “shipping” is a cost input. Fulfillment = Pro granted after `checkout.session.completed`.

| | LLE | Prod |
|---|---|---|
| API | `marginmark-api-lle` (scale to 0) | `marginmark-api-prod` (1 warm VM) |
| DB | Neon branch `lle`, pooled URL | Neon `production`, pooled URL |
| Stripe | `sk_test_` | `sk_live_` |
| Extension | unpacked `.\scripts\build-lle.ps1` | CWS zip `.\scripts\build-prod.ps1` |
| Privacy | one Vercel URL is enough | same |

## Cost (until ~100k installs)

Chrome Web Store hosts the UI. We pay for API + DB only.

- **LLE:** Fly 256 MB scale-to-zero + Neon free branch ≈ **$0–5/mo** idle.
- **Prod start:** Fly 512 MB always-on (~$5–8) + Neon Free/Launch (~$0–19) ≈ **$5–25/mo**.
- **100k installs** is not 100k concurrent. Typical popup traffic is tens of RPS at peak. This CRUD/JWT API on **1–2 Fly VMs + Neon pooler** covers that. Scale when CPU stays >70% or Neon hits compute limits — not at a user-count milestone.
- Skip Kubernetes, Redis, and a second frontend until you run **2+ API machines** and need a shared rate limiter.

## First-time LLE API

```powershell
winget install FlyIO.flyctl
fly auth login
cd backend
fly apps create marginmark-api-lle
fly secrets set --config fly.lle.toml ENV=production JWT_SECRET=... ADMIN_KEY=... TELEMETRY_READ_KEY=... ADMIN_IP_ALLOWLIST=... EXTENSION_IDS=... DATABASE_URL=... STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=... STRIPE_PRICE_TIKTOK_SELLER=... STRIPE_PRICE_TIKTOK_SELLER_YEARLY=... GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... FACEBOOK_APP_ID=... FACEBOOK_APP_SECRET=... TIKTOK_CLIENT_KEY=... TIKTOK_CLIENT_SECRET=...
.\..\scripts\deploy-lle.ps1
curl https://marginmark-api-lle.fly.dev/health
```

Neon: create branch `lle`, use the **-pooler** connection string as `DATABASE_URL`. Never share the prod database with LLE.

OAuth: add LLE callbacks `{PUBLIC_BASE_URL}/auth/oauth/{google|facebook|tiktok}/callback`.

Stripe LLE webhook: `https://api-lle.plainsmansoftware.com/billing/webhook` (test mode). Subscribe all six events and set `STRIPE_WEBHOOK_EVENTS_CONFIRMED=1`: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Pin the endpoint API version. Prod uses the same six events on `https://api.plainsmansoftware.com/billing/webhook`.

Local API matches prod: `.\scripts\dev-up.ps1` runs `marginmark_app:app` from `backend\venv` and requires `DATABASE_URL` (Postgres 16). `docker run -d --name mm-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16`.

| | Local | LLE | Prod |
|---|---|---|---|
| API | `marginmark_app:app` | same image | same image |
| DB | Postgres 16 | Neon `marginmark-lle` | Neon `marginmark-prod` |
| Domain | `127.0.0.1:8000` | `api-lle.plainsmansoftware.com` | `api.plainsmansoftware.com` |
| Stripe | test + `stripe listen` | test | live |
| Extension | unpacked | Private CWS item | Public CWS item |

Release gate: CI green, overlay email login, edit page shows title and price, no COGS shows Add cost, free blocks the 11th SKU, test-card checkout shows Pro within 60 seconds. Promote API to prod before the store zip. Roll back the API with `fly deploy --image <previous>`.

`/ops` unlock uses `X-Admin-Key` (`ADMIN_KEY`). Telemetry reads use `X-Telemetry-Key` (`TELEMETRY_READ_KEY`).

## LLE bill-to-Pro check (do this before prod)

1. Unpacked LLE extension + LLE API. Create a **real** account (email or OAuth).
2. Stay on Free: 11th SKU blocked.
3. Upgrade → Stripe Checkout (not a blank tab). Card `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.
4. Land on `/billing/done`. Reopen popup: **Pro**, SKU cap gone.
5. Stripe Dashboard (test) shows the webhook delivered. No live charge.

Prod uses the same build + `sk_live_` + live webhook URL. Do not skip step 4 with a “grant Pro” backdoor — that would not be what users hit.

## Owner ops (`/ops`)

Browser-only dashboard (not in the extension). Open `http://127.0.0.1:8000/ops` or `https://<api>/ops`. Unlock with `TELEMETRY_ADMIN_KEY`. Create promo codes (N days of Pro), view users/telemetry, push an announcement string the popup reads. Chrome Web Store is still how JS updates ship.

## Extension

```powershell
copy deploy\lle.env.example deploy\lle.env   # edit URL if Fly hostname differs
.\scripts\build-lle.ps1
```

Load `dist/` unpacked. Keep the public CWS listing on the prod API.

Prod: `copy deploy\prod.env.example deploy\prod.env` then `.\scripts\build-prod.ps1`. Add the prod API origin is automatic via `VITE_API_BASE_URL`. `VITE_STRIP_DEV_HOSTS=1` drops localhost from the store zip.

## Day-to-day: test on LLE, then promote

**A. Data only (promos, announcements, user/telemetry)** — no Chrome review.
1. Change it on LLE `/ops` (`https://marginmark-api-lle.fly.dev/ops`) and confirm in the unpacked LLE extension.
2. Repeat the same click on prod `/ops`. Users already on the store build pick it up from the API.

**B. Code (popup, overlay, scraper, new endpoints)**
1. Local: `npm test` then `npm run build` + local API if you want a laptop pass.
2. LLE API: `.\scripts\deploy-lle.ps1` (same git commit).
3. LLE extension: `.\scripts\build-lle.ps1` → Chrome → Load unpacked `dist/` (keep the store listing installed separately; LLE is named `MarginMark (LLE)`).
4. Run the LLE bill-to-Pro check if billing/auth changed.
5. Prod API: `.\scripts\promote-prod.ps1` (the LLE image, not a new build).
6. Bump `version` in `manifest.json`, then `.\scripts\build-prod.ps1`. Zip `dist/`, upload to the **Chrome Web Store** listing → Submit for review. Store users get it after Google approves.

Do not point the public store zip at the LLE API. Do not put `sk_live_` on LLE.

## Rolling restarts (do not take everything down)

Three separate processes: **laptop API**, **LLE Fly**, **prod Fly**. Never restart two in the same command.

| Step | Command | What stays up |
|---|---|---|
| 1. Laptop | `.\scripts\dev-up.ps1 -Build` | Fly apps untouched |
| 2. LLE | `.\scripts\deploy-lle.ps1` then wait for `/health` | Prod Fly + local |
| 3. Prod | `.\scripts\promote-prod.ps1` | LLE Fly + local |

Both Fly configs use `[deploy] strategy = "rolling"`. With **one** machine there is still a short blip on that app only. True no-blip prod: `fly scale count 2 --config fly.prod.toml` later (about 2× VM cost). In-memory rate limits stay per machine.

## Prod API

Same as LLE with `fly.prod.toml`, live Stripe, prod Neon, `min_machines_running = 1`. Later: `fly scale count 2 --config fly.prod.toml` (in-memory rate limits stay per machine — acceptable until then).
