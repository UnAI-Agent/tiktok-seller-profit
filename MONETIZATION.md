# Monetization, tax model, and support

## Profit & tax (extension-side)

Net profit is **estimated**, not tax advice.

| Line | Meaning |
|------|---------|
| **Gross** | List price × units |
| **Platform / payment** | TikTok + card fees (% + $0.30/order) |
| **COGS** | Product cost per unit |
| **Ship out** | Your label cost per unit (Settings → Ship out / unit) |
| **Ads** | Ad spend allocated per unit |
| **Refunds** | % of gross assumed refunded |
| **Sales tax (est.)** | % of gross (Settings → Est. sales tax %) — use **0** if price is tax-inclusive |
| **Packaging** | Boxes/labels per unit |

Formula lives in `src/lib/profit.ts` → `computeProfit()`.

## Free vs Pro

| | Free | Pro ($9.99/mo or $99/yr) |
|---|------|----------------|
| SKUs stored locally | 10 max | Unlimited |
| Creator dashboard | No | Yes (Pro tab) |
| Cloud sync | No | Roadmap |

**Pricing:** $9.99/mo or $99/yr Pro (Stripe Price IDs on backend).

**Source of truth:** backend SQLite `subscriptions` table per `user_id` + `service=tiktok-seller-tool`.

Extension caches tier in `chrome.storage.local.subscription` after sign-in (`/auth/me`).

## Upgrade flow

1. Deploy `backend/` with env `STRIPE_PRICE_TIKTOK_SELLER` (Stripe Price ID).
2. Set extension `VITE_API_BASE_URL` to your API (see `.env.example`).
3. User: Popup → **Settings** → **Account & plan** → sign in → **Upgrade to Pro**.
4. Stripe Checkout opens; webhook sets `subscriptions.status = active`.
5. User reopens popup; `is_pro` unlocks unlimited SKUs.

Manage/cancel: add Stripe Customer Portal (backend `/stripe/portal`) — wire in UI when needed.

## Support tickets

1. **Preferred:** Settings → Support → **Submit support ticket** → `POST /support/ticket` (stored in `support_tickets`).
2. **Fallback:** opens `mailto:` if API is down.

Replace `SUPPORT_EMAIL` in `src/config.ts` with your real address.
