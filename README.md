# MarginMark

Chrome extension: live profit overlay + SKU dashboard for TikTok Shop Seller Center. Publisher: Plainsman Software.

Git home: [UnAI-Agent/tiktok-seller-profit](https://github.com/UnAI-Agent/tiktok-seller-profit).

## Commands

```powershell
npm install
npm test
npm run build          # dist/ for Chrome → Load unpacked
npm run mock:page      # mock Seller Center at :8765
```

Backend (`backend/` in this repo):

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env   # then fill secrets
python marginmark_app.py
```

## Environments

Environments are deploy targets, not branches. One `main` branch. Configuration picks local, LLE, or prod.

| | Local | LLE | Prod |
|---|---|---|---|
| API host | `http://127.0.0.1:8000` | `https://api-lle.plainsmansoftware.com` | `https://api.plainsmansoftware.com` |
| Fly app | — | `marginmark-api-lle` | `marginmark-api-prod` |
| DB | local Postgres 16 | Neon `marginmark-lle` | Neon `marginmark-prod` |
| Stripe | test (`stripe listen`) | test | live |
| Extension build | `npm run dev:up` | `npm run build:lle` | `npm run build:prod` |
| Secrets | `backend/.env` (gitignored) | Fly secrets on the LLE app | Fly secrets on the prod app |
| Who deploys | you, on your machine | owner, `.\scripts\deploy-lle.ps1` | owner, `.\scripts\promote-prod.ps1` |

Flow: feature branch → pull request → CI green → merge to `main` → `.\scripts\deploy-lle.ps1` → test with `npm run build:lle` → `.\scripts\promote-prod.ps1` → `npm run build:prod` → Chrome Web Store.

Prod deploys the image already running on LLE. It does not build a second image. Once per clone: `.\scripts\setup-git.ps1`.

## Deploying (LLE + prod)

Do **not** clone a second git repo. Same codebase, two Fly apps. See Environments above.

```powershell
.\scripts\build-lle.ps1      # unpacked tester extension → LLE API
.\scripts\deploy-lle.ps1     # Fly app marginmark-api-lle
.\scripts\build-prod.ps1     # Chrome Web Store zip → prod API
.\scripts\deploy-prod.ps1    # Fly app marginmark-api-prod
```

## Deploying to Production

1. **Backend** — Deploy FastAPI (`backend/`) to Fly.io, Railway, or AWS. Set `ENV=production`, `JWT_SECRET`, Stripe keys, and `DATABASE_URL` (Postgres). SQLite is alpha-only.
2. **HTTPS** — Terminate TLS at the platform. Do not expose the API over HTTP in production.
3. **Stripe** — Pro $14.99/mo (`STRIPE_PRICE_PRO_MONTHLY` or `STRIPE_PRICE_TIKTOK_SELLER`) and $120/yr (`STRIPE_PRICE_PRO_YEARLY` or `STRIPE_PRICE_TIKTOK_SELLER_YEARLY`), plus `STRIPE_WEBHOOK_SECRET`. Subscribe `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`. Set `STRIPE_WEBHOOK_EVENTS_CONFIRMED=1` on LLE and prod.
3b. **OAuth** — `GOOGLE_CLIENT_ID` / `SECRET`, `FACEBOOK_APP_ID` / `SECRET`, `TIKTOK_CLIENT_KEY` / `SECRET`, and `PUBLIC_BASE_URL`. Register `{PUBLIC_BASE_URL}/auth/oauth/{google|facebook|tiktok}/callback` at each provider.
4. **Extension** — Build with the production API:

```powershell
$env:VITE_API_BASE_URL="https://api.yourdomain.com"
npm run build
```

Add the production API origin to `manifest.json` `host_permissions` before Chrome Web Store upload.

5. Upload `dist/` to the Chrome Web Store. Listing copy lives in `store/CHROME_WEB_STORE.md`. Host `store/privacy.html` at a public HTTPS URL and paste that URL into the CWS privacy field.

## Launch checklist

- [ ] Have the extension logo and the Stripe logo
- [ ] Backend `/health` returns ok over HTTPS
- [ ] Stripe webhook receives `checkout.session.completed` within a few seconds
- [ ] `npm test` and `npm run build` pass
- [ ] Auth: register → login → logout → login as another user
- [ ] Free tier blocks the 11th SKU
- [ ] Overlay on mock page (`npm run mock:page`) and one real Seller Center product
- [ ] Upgrade to Pro opens Stripe Checkout (not a blank tab)
- [ ] Killing the backend shows "Connection lost. Check your internet."
