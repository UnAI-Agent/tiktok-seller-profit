# TikTok Seller Tool — Cursor implementation prompt

Use this document as the single source of truth when building or extending the TikTok Seller Tool Chrome extension in `ChromExtentionProjects`. Pivot target: replace the Etsy listing-analyzer direction with TikTok Shop seller workflows.

---

## 1. PROJECT OVERVIEW

### Product

**TikTok Seller Tool** — a Manifest V3 Chrome extension that overlays profit math, seller performance signals, and SKU intelligence on TikTok Shop Seller Center pages, with a popup for quick settings and Pro-tier creator analytics.

### Target users

| Segment | Pain | Free tier value | Pro tier value |
|---|---|---|---|
| TikTok Shop sellers (US / UK / EU) | Unclear net margin after fees, shipping, ads | Live profit overlay on product/SKU views | SKU dashboard + recommendations |
| High-volume SKU operators | Too many SKUs to eyeball | Sortable SKU list, margin flags | Bulk export, Firebase sync across devices |
| Seller + affiliate hybrid | Creator GMV hard to tie to SKUs | Basic creator stats in popup | Creator Performance dashboard |

### Monetization

| Tier | Price | Limits |
|---|---|---|
| **Free** | $0 | Profit overlay, SPS badge, up to 25 tracked SKUs locally, no cloud sync |
| **Pro** | $12/mo or $99/yr | Unlimited SKUs, Creator Performance, Firebase sync, priority scraping refresh |

Stripe Checkout + webhook on existing `ChromExtentionProjects/backend/main.py` pattern (new service slug: `tiktok-seller-tool`).

### Timeline

| Window | Outcome |
|---|---|
| Days 1–10 | MVP → soft launch on Chrome Web Store (unlisted → public) |
| Month 1–3 | 500 installs, 30 Pro subs (~$360 MRR stretch) |
| Month 6 | 2k installs, ~100 Pro (~$1.2k MRR) toward passive-income goal |

### Tech stack

- **Extension UI:** React 18, TypeScript, Tailwind CSS
- **Build:** Vite + `@crxjs/vite-plugin`
- **Extension APIs:** Manifest V3, `chrome.storage.local` / `chrome.storage.sync` (settings only), service worker background
- **Pro backend (optional day 1):** FastAPI + Stripe in `backend/`; Firebase Auth + Firestore for Pro sync only
- **No server required for Free tier**

Suggested repo path: `extensions/tiktok-seller-tool/` (rename or fork from `extensions/listing-analyzer/` scaffold).

---

## 2. TECHNICAL ARCHITECTURE

### Directory structure

```
extensions/tiktok-seller-tool/
├── manifest.json
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
├── index.html                    # popup entry
├── src/
│   ├── background/
│   │   └── serviceWorker.ts      # alarms, badge, message hub
│   ├── content/
│   │   ├── index.ts              # inject entry
│   │   ├── mountOverlay.tsx      # React root on seller pages
│   │   ├── scraper/
│   │   │   ├── domSelectors.ts   # versioned selectors + fallbacks
│   │   │   └── parseProductPage.ts
│   │   └── components/
│   │       ├── ProfitOverlay.tsx
│   │       └── SpsBadge.tsx
│   ├── popup/
│   │   ├── main.tsx
│   │   ├── Popup.tsx
│   │   ├── SettingsPanel.tsx
│   │   └── ProUpsell.tsx
│   ├── dashboard/                # optional full-tab or side panel later
│   │   ├── SkuDashboard.tsx
│   │   └── CreatorPerformance.tsx
│   ├── lib/
│   │   ├── profit.ts             # pure formulas
│   │   ├── sps.ts                # threshold + colors
│   │   ├── storage.ts            # chrome.storage wrappers
│   │   └── messages.ts           # typed chrome.runtime messages
│   ├── types/
│   │   ├── sku.ts
│   │   ├── settings.ts
│   │   └── creator.ts
│   └── index.css
└── public/
    └── icons/                    # 16, 48, 128
```

### Component breakdown

| Component | Layer | Responsibility |
|---|---|---|
| `serviceWorker.ts` | Background | Route messages, periodic SPS refresh alarm, optional Pro token refresh |
| `mountOverlay.tsx` | Content | Shadow DOM or fixed portal; avoid CSS bleed from TikTok |
| `ProfitOverlay.tsx` | Content | Show revenue, costs, net $ and % |
| `SpsBadge.tsx` | Content | Compact SPS chip near seller header when detectable |
| `Popup.tsx` | Popup | Nav: Summary / SKUs / Settings; Pro gate |
| `SkuDashboard.tsx` | Popup or side panel | Table, sort, recommendations |
| `CreatorPerformance.tsx` | Pro only | Creator-linked GMV, commission est. |
| `storage.ts` | Shared | Read/write typed JSON blobs |

### Message flow

```
Content script ──scrape──► parseProductPage ──► profit.ts
       │                              │
       └──── chrome.runtime.sendMessage ───► serviceWorker
                                              │
Popup ◄──── chrome.storage.onChanged ────────┘
```

---

## 3. FEATURE SPECIFICATIONS

### Feature 1: Profit Calculator Overlay

**When:** User is on a TikTok Seller Center product/SKU detail or edit page (URL patterns in §5).

**Inputs (scraped or user defaults):**

| Field | Key | Source |
|---|---|---|
| List price | `listPrice` | DOM or manual default |
| Units sold (period) | `unitsSold` | DOM if present else 0 |
| COGS per unit | `cogsPerUnit` | `storage.settings.defaultCogs` or per-SKU override |
| Shipping out per unit | `shippingOut` | settings |
| Platform commission % | `platformFeePct` | default 8% (configurable) |
| Payment processing % | `paymentFeePct` | default 2.9% |
| Payment fixed fee | `paymentFixed` | default $0.30 per order |
| Ads spend (allocated) | `adsPerUnit` | settings or SKU field |
| Refund rate % | `refundRatePct` | settings default 3% |

**Formulas (implement in `src/lib/profit.ts`):**

```text
grossRevenue     = listPrice * unitsSold
platformFee      = grossRevenue * (platformFeePct / 100)
paymentFee       = (grossRevenue * (paymentFeePct / 100)) + (paymentFixed * orderCount)
                   // orderCount: use unitsSold if single-unit orders else scraped order count or unitsSold
cogsTotal        = cogsPerUnit * unitsSold
shippingTotal    = shippingOut * unitsSold
adsTotal         = adsPerUnit * unitsSold
refunds          = grossRevenue * (refundRatePct / 100)

totalCosts       = platformFee + paymentFee + cogsTotal + shippingTotal + adsTotal + refunds
netProfit        = grossRevenue - totalCosts
netMarginPct     = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0
breakEvenPrice   = (cogsPerUnit + shippingOut + adsPerUnit + paymentFixed) / (1 - (platformFeePct + paymentFeePct + refundRatePct) / 100)
                   // simplify for display; document assumption in UI tooltip
```

**UI layout (overlay card — fixed bottom-right on desktop):**

```text
┌─────────────────────────────────────┐  width: 320px
│ Profit snapshot          [−] [×]   │  height: auto, max 420px
├─────────────────────────────────────┤
│ Net profit    $127.40   ▲ 18.2%    │  net line: 20px semibold
│ Gross         $698.00               │  14px regular
│ Costs         $570.60               │  expandable chevron
│   Platform    $55.84                │
│   Payment     $20.54                │
│   COGS        $400.00               │
│   Ship        $45.00                │
│   Ads         $30.00                │
│   Refunds     $20.94                │
│ [Edit costs]  [Save to SKU]         │  buttons 36px height
└─────────────────────────────────────┘
```

- **Profit green:** `netProfit > 0` and `netMarginPct >= 15`
- **Warning yellow:** `netProfit > 0` and `netMarginPct < 15`
- **Loss red:** `netProfit <= 0`

---

### Feature 2: SPS monitoring (Seller Performance Score)

**Definition:** Normalized 0–100 score derived from available seller-center signals (exact TikTok label may vary — map in `domSelectors.ts`).

**Acquisition priority:**

1. Parse visible score from dashboard/header if present
2. Else compute **proxy SPS** from extension-tracked metrics: late shipment rate, cancellation rate, review average (when scraped)

**Proxy formula (if native SPS not found):**

```text
proxySps = clamp(0, 100,
  100
  - (lateShipmentRatePct * 2)
  - (cancellationRatePct * 3)
  - max(0, (4.0 - avgRating) * 10)
)
```

**Threshold levels:**

| Range | Label | Color | Hex | Badge text |
|---|---|---|---|---|
| 90–100 | Excellent | Green | `#16A34A` | SPS 94 |
| 75–89 | Good | Blue | `#2563EB` | SPS 82 |
| 60–74 | Warning | Yellow | `#CA8A04` | SPS 68 |
| 0–59 | Critical | Red | `#DC2626` | SPS 52 |

**UI:** `SpsBadge.tsx` — 28px height pill, 12px font, placed top-right of overlay or injected near seller nav; clicking opens popup to SPS section.

**Background:** `chrome.alarms` every 6 hours on seller domain → re-scrape if tab open; update `storage.sps`.

---

### Feature 3: SKU dashboard

**Data:** Aggregated from saved SKU records (`storage.skus`).

**Columns:** SKU ID, title (trunc 40), list price, net margin %, net profit (est.), units sold, last updated, recommendation.

**Sorting (default: net margin % ascending — worst first):**

- net margin %, net profit, units sold, list price, title A–Z

**Recommendations (rule engine, no AI required for MVP):**

| Condition | Recommendation |
|---|---|
| `netMarginPct < 0` | Raise price or cut COGS/ads |
| `netMarginPct < 10` && `unitsSold > 10` | High volume, low margin — review fees |
| `refundRatePct > 8` | Check listing accuracy / quality |
| `unitsSold === 0` && age > 14d | Improve content or ads test |
| `netMarginPct >= 25` && `unitsSold >= 5` | Scale — duplicate listing pattern |

**Free tier:** max 10 SKUs in storage; show upsell when limit hit.

---

### Feature 4: Creator performance (Pro tier)

**Scope:** Summarize affiliate/creator-attributed performance when user is on creator or affiliate reports pages, or when manual creator IDs are linked to SKUs.

**Metrics:**

- Creator name / ID
- GMV (7d / 30d)
- Estimated commission (GMV × commission rate from settings)
- Top 5 SKUs by creator-driven revenue

**UI:** Separate tab in popup; table + mini bar chart (CSS only for MVP).

**Gate:** `storage.subscription.tier === 'pro'` and valid Stripe status from backend.

---

## 4. DATA STORAGE STRATEGY

### Free tier — Chrome Storage API only

| Store | Key | Sync? |
|---|---|---|
| `chrome.storage.local` | `skus`, `sps`, `lastScrape` | No |
| `chrome.storage.local` | `settings` | No |
| `chrome.storage.sync` | `settingsDisplay` (theme, overlay position) | Yes, small prefs only |

**Quota discipline:** Keep `skus` under ~100KB; prune oldest when > 25 (free) or > 500 (pro local).

### Pro tier — optional Firebase

- Firebase Auth (email magic link or Google)
- Firestore path: `users/{uid}/skus/{skuId}`, `users/{uid}/settings`
- Extension syncs on login and on `chrome.alarms` every 30 min if Pro
- Conflict: **last-write-wins** with `updatedAt` ISO timestamp

### JSON structures

**`settings`:**

```json
{
  "version": 1,
  "platformFeePct": 8,
  "paymentFeePct": 2.9,
  "paymentFixed": 0.3,
  "defaultCogs": 0,
  "defaultShippingOut": 0,
  "defaultAdsPerUnit": 0,
  "refundRatePct": 3,
  "affiliateCommissionPct": 10,
  "overlayEnabled": true,
  "overlayPosition": "bottom-right"
}
```

**`skus` (record):**

```json
{
  "skuId": "SKU-12345",
  "title": "Wireless Earbuds Pro",
  "listPrice": 29.99,
  "cogsPerUnit": 8.5,
  "shippingOut": 3.2,
  "adsPerUnit": 1.5,
  "unitsSold": 42,
  "refundRatePct": 3,
  "netMarginPct": 18.2,
  "netProfit": 127.4,
  "sourceUrl": "https://seller-us.tiktok.com/...",
  "updatedAt": "2026-09-17T16:00:00.000Z"
}
```

**`sps`:**

```json
{
  "score": 82,
  "source": "native|proxy",
  "lateShipmentRatePct": 2.1,
  "cancellationRatePct": 0.8,
  "avgRating": 4.6,
  "updatedAt": "2026-09-17T16:00:00.000Z"
}
```

**`subscription`:**

```json
{
  "tier": "free|pro",
  "stripeCustomerId": null,
  "expiresAt": null
}
```

---

## 5. CHROME EXTENSION SPECIFICS

### `manifest.json` template

```json
{
  "manifest_version": 3,
  "name": "TikTok Seller Tool — Profit & SKU",
  "version": "0.1.0",
  "description": "Profit calculator overlay, seller performance monitoring, and SKU dashboard for TikTok Shop sellers.",
  "permissions": ["storage", "alarms", "activeTab"],
  "host_permissions": [
    "https://seller-us.tiktok.com/*",
    "https://seller.tiktokglobalshop.com/*",
    "https://seller-us.tiktokglobalshop.com/*",
    "https://*.tiktokshop.com/*"
  ],
  "background": {
    "service_worker": "src/background/serviceWorker.ts",
    "type": "module"
  },
  "action": {
    "default_popup": "index.html",
    "default_title": "TikTok Seller Tool"
  },
  "content_scripts": [
    {
      "matches": [
        "https://seller-us.tiktok.com/*",
        "https://seller.tiktokglobalshop.com/*",
        "https://seller-us.tiktokglobalshop.com/*"
      ],
      "js": ["src/content/index.ts"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "public/icons/icon16.png",
    "48": "public/icons/icon48.png",
    "128": "public/icons/icon128.png"
  }
}
```

Adjust `matches` when target seller URLs are confirmed in VERIFY.

### Content script strategy

1. Wait for `document.body` and SPA route stability (debounce 500ms on `history.pushState` hook).
2. Mount React overlay in **closed Shadow DOM** root attached to `document.body`.
3. Use `MutationObserver` sparingly (throttle 1s) only on main content container.
4. Never inject scripts into page context (avoid CSP violations).

### Service worker requirements

- Listen for messages: `SCRAPE_PRODUCT`, `GET_SPS`, `SAVE_SKU`
- Persist to `chrome.storage.local`
- `chrome.alarms.create('spsRefresh', { periodInMinutes: 360 })`
- Optional: fetch Pro subscription status from backend (Bearer token)

### Page scraping approach

- **Versioned selectors** in `domSelectors.ts` with `SELECTOR_VERSION = 1`
- Fallback chain: `data-testid` → aria labels → structural CSS (document fragile classes in DECISIONS)
- Parse numbers with locale-safe helper (`parseMoney`, `parsePercent`)
- If scrape fails: show overlay with manual inputs + yellow banner “Couldn’t read page — enter values”

---

## 6. UI/UX SPECIFICATIONS

### Color scheme

| Role | Hex | Tailwind suggestion |
|---|---|---|
| Profit / success | `#16A34A` | `green-600` |
| Loss | `#DC2626` | `red-600` |
| Warning | `#CA8A04` | `yellow-600` |
| TikTok accent | `#FE2C55` | brand CTA (use sparingly) |
| Neutral bg | `#F8FAFC` | `slate-50` |
| Text primary | `#0F172A` | `slate-900` |
| Text muted | `#64748B` | `slate-500` |

### Typography

- Font stack: `Segoe UI`, `system-ui`, sans-serif (match Windows Chrome default)
- Popup title: 16px / 600
- Body: 14px / 400
- Table headers: 12px / 600 uppercase tracking-wide
- Monospace for SKU IDs: `ui-monospace`, 12px

### Popup dimensions

- Width: **380px** fixed
- Min height: **200px**
- Max height: **600px** (scroll body)
- Padding: **16px**
- Primary button: full width, **40px** height, 8px radius

### Content overlay

- Width **320px**, shadow `0 4px 24px rgba(0,0,0,0.12)`, radius **12px**, z-index **2147483646**

---

## 7. IMPLEMENTATION PRIORITY

### Phase 1 — Days 1–3: MVP core

- [ ] Scaffold `extensions/tiktok-seller-tool` (Vite + CRX + React 18 + TS + Tailwind)
- [ ] `profit.ts` + unit tests for formulas
- [ ] Content script + `ProfitOverlay` with mock/scraped data
- [ ] Popup shell with enable/disable overlay toggle
- [ ] `manifest.json` + load unpacked from `dist`

### Phase 2 — Days 4–5: Storage & settings

- [ ] `storage.ts` typed wrappers
- [ ] Settings panel (fee defaults, COGS defaults)
- [ ] Save SKU from overlay
- [ ] SKU list in popup (simple table)

### Phase 3 — Days 6–7: Pro features

- [ ] SPS badge + proxy score
- [ ] SKU dashboard sorting + recommendations
- [ ] Stripe Pro gate via `backend/main.py` service `tiktok-seller-tool`
- [ ] Creator Performance tab (Pro)

### Phase 4 — Days 8–10: Polish & testing

- [ ] Selector fallbacks + error banners
- [ ] Icons, store screenshots, privacy policy
- [ ] Full testing checklist (§8)
- [ ] Chrome Web Store submission

---

## 8. TESTING CHECKLIST

### Functional

- [ ] Overlay appears on supported seller product URL
- [ ] Profit math matches spreadsheet for 3 fixture scenarios
- [ ] Save SKU persists after browser restart
- [ ] Free tier blocks 26th SKU with upsell
- [ ] Pro unlock hides gate (mock or Stripe test mode)
- [ ] SPS badge color matches threshold table

### UI/UX

- [ ] Popup scrolls at 600px max height
- [ ] Overlay draggable or position setting works
- [ ] Readable on 1280×720 and 1920×1080
- [ ] Dark seller theme: overlay still readable (test contrast)

### Edge cases

- [ ] Missing DOM fields → manual entry path
- [ ] `listPrice = 0` → no divide-by-zero
- [ ] Non-seller tab → popup shows “Open Seller Center”
- [ ] Storage quota near limit → graceful prune message

### Compatibility

- [ ] Chrome stable (latest)
- [ ] Edge Chromium (load unpacked)
- [ ] Extension reload after `npm run build`

---

## 9. LAUNCH CHECKLIST

### Chrome Web Store

- [ ] Developer account ($5 one-time)
- [ ] Manifest icons 16/48/128
- [ ] 1280×800 screenshots (popup + overlay on seller page)
- [ ] Short description ≤ 132 chars
- [ ] Detailed description + feature list
- [ ] Privacy policy URL (data: local storage; Pro: Firebase + Stripe disclosed)
- [ ] Single purpose description: seller productivity / analytics
- [ ] Permissions justification for each host pattern

### Post-launch marketing

- [ ] TikTok Shop seller Facebook groups, Reddit r/TikTokShop, Discord communities
- [ ] Short demo video (overlay + SKU save)
- [ ] Landing page or Gumroad link for Pro (optional)
- [ ] Changelog in store listing after each update

---

## 10. PAYMENT & SUBSCRIPTION

### Stripe (Pro)

- Reuse `ChromExtentionProjects/backend/main.py` pattern
- Add `SERVICES["tiktok-seller-tool"]` with `pro_price_monthly: 12`, env `STRIPE_PRICE_TIKTOK_SELLER`
- Extension flow: popup → “Upgrade” → open backend `/checkout?service=tiktok-seller-tool` → return URL with session → backend sets JWT claim → extension stores `subscription`

### Pricing model

| Plan | Price | Notes |
|---|---|---|
| Free | $0 | 10 SKUs, no creator dashboard |
| Pro monthly | $12/mo | Unlimited SKUs + creator + sync |
| Pro annual | $99/yr | ~31% discount |

---

## 11. ERROR HANDLING

| Failure | Fallback |
|---|---|
| Scrape miss | Manual inputs; don’t block overlay |
| Storage write fail | Toast + retry; keep in-memory session |
| Backend down (Pro) | Degrade to local-only; show “sync paused” |
| Invalid fee config | Clamp percentages 0–50; log to console in dev |
| TikTok DOM change | `SELECTOR_VERSION` bump; show “update extension” if version mismatch |

**Graceful degradation:** Free tier must work offline except Stripe; never hard-crash content script — wrap mount in try/catch.

---

## 12. SUCCESS METRICS

### Growth targets

| Milestone | Installs | Pro subs | MRR |
|---|---|---|---|
| Launch + 30d | 200 | 10 | ~$120 |
| 90d | 800 | 40 | ~$480 |
| 180d | 2000 | 100 | ~$1,200 |

### KPIs to track

- DAU / WAU (popup opens)
- Overlay engagement rate (open on seller page)
- SKU save rate per active user
- Free → Pro conversion %
- Churn (monthly)
- Scrape success rate (telemetry, privacy-safe aggregate)
- Chrome Web Store impressions → installs

---

## Cursor agent instructions (paste with tasks)

1. Read `ChromExtentionProjects/.cursor/docs/INDEX.md` and this file.
2. Work only in `extensions/tiktok-seller-tool/` unless wiring backend service.
3. Match existing patterns from `extensions/listing-analyzer/` (Vite + CRX).
4. Surgical diffs; no new npm deps without approval.
5. Update `MAP.md` and `STATE.md` when a phase item ships.
6. Verify with `npm run build` and manual load of `dist` on a TikTok Seller Center URL.

---

*Document version: 1.0 — TikTok pivot (replaces Etsy Listing Analyzer product spec).*
