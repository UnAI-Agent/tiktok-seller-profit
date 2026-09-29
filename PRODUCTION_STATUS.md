# Production brief alignment

Tracks **MarginMark** (Plainsman Software) against this repo. Internal service id stays `tiktok-seller-tool`.

## Product (extension)

| Requirement | Status | Notes |
|-------------|--------|--------|
| MV3 + React 18 + TS + Vite + Tailwind | ✅ | repo root (`src/`) |
| Profit engine `computeProfit()` + `marginTone()` | ✅ | Commission, samples, break-even, max CPA / ROAS in `profit.ts` |
| Floating overlay (per-unit net, costs, guards) | ✅ | `ProfitOverlay.tsx` plus header, costs, commission, ads, waterfall |
| Per-SKU COGS entry | ✅ | Overlay blur-save and dashboard cell |
| Popup: Home \| Products \| Settings | ✅ | Creators demo hidden behind `VITE_SHOW_CREATOR_DEMO` |
| Loser flags + statement import | ✅ | Pro. Affiliate Center chip waits on a saved HTML fixture |
| Auto-scrape price + units sold | ✅ | DOM multi-strategy; `extractUnitsSold.ts` |
| SKU dashboard sort + filter | ✅ | `SkuDashboard.tsx` |
| Auto SKU sync + top Sync bar | ✅ | `AutoSyncBar.tsx`, `syncPageSkus.ts` |
| Free: **5 product costs** (price-only rows unlimited) | ✅ | One knob: `src/tiers.json` `free.skuLimit`. Extension and API both read it |
| Pro: **$14.99/mo** or **$120/yr** | ✅ | Display + Stripe interval on checkout |
| Pro: max commission, ad targets, statement import | ✅ | Free overlay still includes commission in the per-unit number |
| Pro: compare prices elsewhere | ✅ | `ExternalPriceCompare.tsx` — marketplace search tabs |
| Shipping only if seller pays | ✅ | `shippingPassedToBuyer` in Settings |
| Support | ✅ | Settings opens a local `mailto:` draft |
| Service worker + alarms | ✅ | `serviceWorker.ts` |

## Backend & monetization

| Requirement | Status | Notes |
|-------------|--------|--------|
| FastAPI backend | ✅ | MarginMark-only `backend/marginmark_app.py` |
| User auth + signed tokens | ✅ | 30-day HMAC-SHA256 token with expiry and token version |
| Stripe Checkout + webhooks | ✅ | Monthly + yearly price IDs |
| `is_pro` → extension | ✅ | `/auth/me`, `chrome.storage.subscription` |
| PostgreSQL | ✅ | Hosted on Neon via `DATABASE_URL`. Local runs can use SQLite. |
| CORS for `chrome-extension://` | ✅ | Explicit IDs from `EXTENSION_IDS`; Bearer requests use no credentials |
| Rate limit 429 + Retry-After | ✅ | Fly client IP plus email on auth routes |
| SKU/cost storage | ✅ | Local only; no SKU API routes |
| Forgot password | ⚠️ | Enumeration-safe stub (no email send yet) |
| Google / Facebook / TikTok OAuth | ⚠️ | Code live; needs provider app credentials in `.env` |
| API attack surface | ✅ | Auth, billing, config, telemetry, and protected owner operations only |
| Deploy Fly/Railway | ❌ | Ops — not in repo |

## Scraper reliability

| Requirement | Status | Notes |
|-------------|--------|--------|
| DOM fallbacks | ✅ | `parseProductPage`, `parseProductListPage`, labels |
| Playwright scraper | ⚠️ | Stub `playwrightScraper.ts`; **backend Playwright Phase 2** |
| TikTok Seller API | ❌ | Research / approval |

## Launch checklist (code-owned items)

- [x] Profit calc + overlay
- [x] Backend auth (email JWT)
- [x] Stripe checkout + webhook
- [x] `isPro` in popup (SKU limit + Pro features)
- [x] Mailto support flow
- [x] Auth splash + login errors + forgot-password stub
- [x] SKU cap warning at 8 / block at 11 locally
- [x] CWS metadata + placeholder privacy page
- [ ] Playwright on 5 live pages (Phase 2)
- [ ] Firebase OAuth (optional vs brief)
- [ ] Production deploy + CWS submission (Ops)
- [ ] Sentry / Posthog (Phase 2)
- [ ] Host privacy policy on a real HTTPS domain

## Env (backend)

```env
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_TIKTOK_SELLER=       # monthly $14.99
STRIPE_PRICE_TIKTOK_SELLER_YEARLY= # annual $120
```

## Env (extension build)

```env
VITE_API_BASE_URL=https://your-api.example.com
```

**Next ops actions:** Stripe products, deploy backend, set checkout success URLs for extension users, CWS listing.
