# MAP

| Path | Purpose | Symbols |
|---|---|---|
| `manifest.json` | MV3 hosts, SW, popup, content | — |
| `src/lib/profit.ts` | Net margin formulas | `computeProfit`, `marginTone` |
| `src/lib/sps.ts` | Proxy SPS + colors | `computeProxySps`, `spsLevel` |
| `src/lib/storage.ts` | chrome.storage wrappers | `getSettings`, `saveSku` |
| `src/lib/apiClient.ts` | Auth + Stripe + SKU sync | `apiFetch`, `createCheckoutUrl` |
| `src/background/serviceWorker.ts` | Messages, alarms | `onMessage`, `spsRefresh` |
| `src/content/mountOverlay.tsx` | Shadow DOM mount | `mountOverlayFromSettings` |
| `src/content/components/ProfitOverlay.tsx` | Profit card | `ProfitOverlay` |
| `src/content/scraper/parseProductPage.ts` | Product DOM scrape | `parseProductPage` |
| `src/content/scraper/domSelectors.ts` | Versioned selectors | `SELECTOR_VERSION` |
| `src/popup/Popup.tsx` | Tabs + Pro gate | `Popup` |
| `src/dashboard/SkuDashboard.tsx` | SKU table + recs | `SkuDashboard` |
| `src/dashboard/CreatorPerformance.tsx` | Pro creator tab | `CreatorPerformance` |
| `src/config.ts` | API URL, SKU cap, prices | `API_BASE_URL`, `FREE_SKU_LIMIT` |
| `backend/main.py` | FastAPI, Stripe, SKUs | `SERVICES["tiktok-seller-tool"]` |
| `backend/db.py` | SQLite/Postgres | `init_db`, `get_db` |
