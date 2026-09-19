# Production brief alignment

Tracks the **TikTok Shop Seller Tool — Production-Ready Cursor Brief** against this repo.

## Product (extension)

| Requirement | Status | Notes |
|-------------|--------|--------|
| MV3 + React 18 + TS + Vite + Tailwind | ✅ | repo root (`src/`) |
| Profit engine `computeProfit()` + `marginTone()` | ✅ | `src/lib/profit.ts` + Vitest |
| Floating overlay (price, sold, cost waterfall, net, break-even) | ✅ | `ProfitOverlay.tsx` |
| Auto-scrape price + units sold | ✅ | DOM multi-strategy; `extractUnitsSold.ts` |
| COGS/shipping/ads from Settings + saved SKU | ✅ | Settings once; overlay reads storage |
| Popup: Summary \| SKUs \| Settings \| Creators | ✅ | `Popup.tsx` |
| SKU dashboard sort + filter | ✅ | `SkuDashboard.tsx` |
| Auto SKU sync + top Sync bar | ✅ | `AutoSyncBar.tsx`, `syncPageSkus.ts` |
| Free: **10 SKUs** | ✅ | `config.ts` + backend `free_limit: 10` |
| Pro: **$9.99/mo** or **$99/yr** | ✅ | Display + Stripe interval on checkout |
| Pro: creator tab gated | ✅ | `CreatorPerformance.tsx` + `isPro` from `/auth/me` |
| Pro: compare prices elsewhere | ✅ | `ExternalPriceCompare.tsx` — marketplace search tabs |
| Shipping only if seller pays | ✅ | `shippingPassedToBuyer` in Settings |
| Support tickets | ✅ | `POST /support/ticket` + Settings UI |
| Service worker + alarms | ✅ | `serviceWorker.ts` |

## Backend & monetization

| Requirement | Status | Notes |
|-------------|--------|--------|
| FastAPI backend | ✅ | `backend/main.py` |
| User auth + JWT | ✅ | Email/password register/login (not Firebase yet) |
| Stripe Checkout + webhooks | ✅ | Monthly + yearly price IDs |
| `is_pro` → extension | ✅ | `/auth/me`, `chrome.storage.subscription` |
| PostgreSQL at scale | ⚠️ | **SQLite** today — migrate before 1000+ users (`DATABASE_URL`) |
| CORS for `chrome-extension://` | ✅ | Origin regex; not `*` + credentials |
| Rate limit 429 + Retry-After | ✅ | In-memory per IP |
| SKU API CRUD + free cap | ✅ | `GET /skus`, `PUT /skus/sync` → 402 at limit |
| Forgot password | ⚠️ | Enumeration-safe stub (no email send yet) |
| Firebase Google OAuth | ❌ | Brief target; use email auth for alpha |
| Pro API 100 req/day | ⚠️ | Service registered; AI routes unused for this SKU tool |
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
- [x] `isPro` in popup (Creators + SKU limit)
- [x] Support tickets
- [x] Auth splash + login errors + forgot-password stub
- [x] SKU cap warning at 8 / block at 11 (local + API)
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
STRIPE_PRICE_TIKTOK_SELLER=       # monthly $9.99
STRIPE_PRICE_TIKTOK_SELLER_YEARLY= # annual $99
```

## Env (extension build)

```env
VITE_API_BASE_URL=https://your-api.example.com
```

**Next ops actions:** Stripe products, deploy backend, set checkout success URLs for extension users, CWS listing.
