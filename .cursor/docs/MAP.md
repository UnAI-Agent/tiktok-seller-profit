# MAP

| Path | Purpose | Symbols |
|---|---|---|
| `manifest.json` | MV3 hosts, SW, popup, content | — |
| `src/lib/sellerUrl.ts` | Seller Center hosts | `isSellerCenterUrl` |
| `src/lib/profit.ts` | Net margin formulas | `computeProfit`, `maxSafeCommissionPct`, `maxCpa`, `breakEvenRoas` |
| `src/lib/diagnose.ts` | Loser flags | `diagnose`, `portfolioStats` |
| `src/lib/profitBoard.ts` | List overview tiles and the Pro fix list | `buildProfitBoard` |
| `src/lib/reportProblem.ts` | Prefill a problem report | `reportProblemDraft` |
| `backend/support_mail.py` | Email one inbox; subject tag is the kind | `send_support_email`, `TICKET_KINDS` |
| `src/lib/statementImport.ts` | Client-side statement parse | `suggestMapping`, `aggregateStatement` |
| `src/lib/sps.ts` | Proxy SPS + colors | `computeProxySps`, `spsLevel` |
| `src/lib/storage.ts` | chrome.storage wrappers | `getSettings`, `saveSku` |
| `src/lib/apiClient.ts` | Auth, Stripe, remote config, telemetry | `apiFetch`, `exchangeOAuthTicket` |
| `src/lib/authCall.ts` | Service-worker email login POST | `postAuth` |
| `src/lib/openTab.ts` | Open http(s) tabs from overlay | `openTab` |
| `src/background/serviceWorker.ts` | Messages, alarms, OAuth claim | `claimOAuthTicket`, `onMessage` |
| `src/content/mountOverlay.tsx` | Shadow DOM mount | `mountOverlayFromSettings`, `toggleInPagePanel` |
| `src/content/components/OverlayAuth.tsx` | Compact login strip in overlay | `OverlayAuth` |
| `src/content/components/ProfitOverlay.tsx` | Overlay nav + per-unit profit | `ProfitOverlay` |
| `src/content/components/MarkLogo.tsx` | MarginMark mark | `MarkLogo` |
| `src/content/components/FieldHelp.tsx` | Hover hint and in-panel help | `InfoButton`, `HelpPanel` |
| `src/content/components/ProfitBoard.tsx` | List-page losing / thin / healthy tiles | `ProfitBoard` |
| `src/content/scraper/parseProductPage.ts` | Product DOM scrape | `parseProductPage` |
| `src/content/scraper/detectPageType.ts` | List / edit / create / affiliate / other | `detectPageType`, `portfolioHeadline` |
| `src/content/scraper/parseProductListPage.ts` | Manage-products scrape | `parseProductListPage`, `looksLikeProductTitle` |
| `src/content/scraper/realFixtures.test.ts` | Real HTML vs `*.expected.json` | skips until files exist |
| `test-fixtures/real/` | Scrubbed Seller Center pages | see `README.md` |
| `test-fixtures/lab/` | Stage 1 Seller Center page + statement | `expected.json` |
| `src/content/scraper/domSelectors.ts` | Versioned selectors | `SELECTOR_VERSION` |
| `src/popup/Popup.tsx` | Tabs + Pro gate | `Popup` |
| `src/dashboard/SkuDashboard.tsx` | SKU table + recs | `SkuDashboard` |
| `src/dashboard/CreatorPerformance.tsx` | Pro creator tab | `CreatorPerformance` |
| `src/config.ts` | API URL, SKU cap, prices, fee presets | `API_BASE_URL`, `FREE_SKU_LIMIT`, `FEE_PRESETS` |
| `src/tiers.json` | Free / Pro / Diamond limits | — |
| `src/lib/remoteConfig.ts` | Signed config verify and kill switches | `acceptPublishedConfig`, `evaluateFlag` |
| `src/lib/marketPrice.ts` | Should-I-sell price band | `marketBand`, `sellVerdict` |
| `src/lib/refundFees.ts` | Refund admin fee | `refundAdminFeePerSku` |
| `src/content/components/ProductCheckCard.tsx` | Product-check card | `ProductCheckCard` |
| `backend/v1_routes.py` | Insights, trends, admin API | `register_v1` |
| `backend/tiers.py` | Tier limits and Stripe price map | `effective_tier` |
| `command-center/app.py` | Owner command center | `create_app` |
| `ops/grafana/views.sql` | Grafana reporting views | — |
| `backend/marginmark_app.py` | MarginMark-only FastAPI auth, billing, admin, telemetry | `app`, `make_token`, `verify_token` |
| `backend/account_flow.py` | Reset tokens and email codes, hashes only | `issue_password_reset`, `check_email_code` |
| `src/lib/bulkCost.ts` | Match pasted cost rows to stored products | `matchBulkRows` |
| `src/lib/skuLimit.ts` | Free cap counts saved costs, not price-only rows | `canAddSku`, `savedCostCount` |
| `backend/legacy/main.py` | Legacy shared backend; Docker ignores `legacy/` | — |
| `backend/netutil.py` | Client IP from Fly, not X-Forwarded-For | `client_ip` |
| `backend/oauth.py` | Google/Facebook/TikTok OAuth | `authorize_url`, `exchange_code_for_profile` |
| `src/lib/oauthCallback.ts` | OAuth ticket from landing URL | `parseOAuthDoneUrl` |
| `src/content/oauthDone.ts` | Claim OAuth ticket from API tab | — |
| `src/popup/WelcomeGuide.tsx` | First-login Free guide | `WelcomeGuide` |
| `backend/db.py` | SQLite/Postgres | `init_db`, `get_db` |
| `backend/billing_env.py` | Stripe key and database host guards | `assert_database_isolation` |
| `backend/promo.py` | Promo redeem / Pro expiry | `redeem_promo`, `effective_sub_status` |
| `backend/admin_db.py` | Owner `/ops` table + user edit | `list_rows`, `patch_user`, `reset_user_password` |
| `backend/static/ops.html`, `ops.js` | CSP-safe owner dashboard | `/ops` |
| `src/popup/AccountPanel.tsx` | Promo + Stripe portal | `AccountPanel` |
| `src/popup/ProfilePanel.tsx` | Signed-in name, email, password, plan, sign-out | `ProfilePanel` |
| `scripts/dev-up.ps1` | Local API restart + optional build | — |
| `scripts/check-secrets.ps1` | Staged or `-All` secret scan | — |
| `scripts/setup-git.ps1` | Sets `core.hooksPath` to `.githooks` | — |
| `scripts/env-status.ps1` | Read-only LLE and prod `/health` vs HEAD | — |
| `scripts/promote-prod.ps1` | Promote the LLE image to prod | — |
| `.githooks/pre-commit` | Runs the secret scan | — |
| `.github/workflows/ci.yml` | PR and `main` CI, no deploy | — |
| `backend/fly.prod.toml` | Prod Fly app | rolling deploy |
| `src/lib/extManifestEnv.ts` | Bake API host into MV3 | `withBuildManifest` |
