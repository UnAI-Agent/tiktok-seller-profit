# TikTok Seller Tool

Chrome extension: live profit overlay + SKU dashboard for TikTok Shop Seller Center.

Git home: [UnAI-Agent/tiktok-seller-profit](https://github.com/UnAI-Agent/tiktok-seller-profit). Product spec: `TIKTOK_SELLER_TOOL_CURSOR_PROMPT.md`.

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
python main.py
```

## Deploying to Production

1. **Backend** — Deploy FastAPI (`backend/`) to Fly.io, Railway, or AWS. Set `ENV=production`, `JWT_SECRET`, Stripe keys, and `DATABASE_URL` (Postgres). SQLite is alpha-only.
2. **HTTPS** — Terminate TLS at the platform. Do not expose the API over HTTP in production.
3. **Stripe** — `STRIPE_PRICE_TIKTOK_SELLER` ($9.99/mo), `STRIPE_PRICE_TIKTOK_SELLER_YEARLY` ($99/yr), `STRIPE_WEBHOOK_SECRET`. Forward webhooks to `https://<api>/billing/webhook`.
4. **Extension** — Build with the production API:

```powershell
$env:VITE_API_BASE_URL="https://api.yourdomain.com"
npm run build
```

Add the production API origin to `manifest.json` `host_permissions` before Chrome Web Store upload.

5. Upload `dist/` to the Chrome Web Store. Listing copy lives in `store/CHROME_WEB_STORE.md`. Host `store/privacy.html` at a public HTTPS URL and paste that URL into the CWS privacy field.

## Launch checklist

- [ ] Backend `/health` returns ok over HTTPS
- [ ] Stripe webhook receives `checkout.session.completed` within a few seconds
- [ ] `npm test` and `npm run build` pass
- [ ] Auth: register → login → logout → login as another user
- [ ] Free tier blocks the 11th SKU
- [ ] Overlay on mock page (`npm run mock:page`) and one real Seller Center product
- [ ] Upgrade to Pro opens Stripe Checkout (not a blank tab)
- [ ] Killing the backend shows "Connection lost. Check your internet."
