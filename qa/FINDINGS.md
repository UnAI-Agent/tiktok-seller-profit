# Findings

Product bugs fixed while building the harness. Test-only changes and dead code are listed too.

## Product bugs

- **Re-subscribe kept `stripe_status=canceled`.** `checkout.session.completed` calls `_set_sub`, which updated `stripe_sub_id` but left `stripe_status`, `current_period_end`, `interval`, and `amount_cents` from the previous subscription. A later `invoice.paid` whose Stripe retrieve failed then treated the new subscription as canceled, and `/auth/me` reported `plan_status: "canceled"` for a paying user. `_set_sub` now clears those columns when the incoming subscription id differs. Test: `@F-BILL-RESUB`.
- **`_retrieve_subscription` required a dict subclass.** It returned `None` unless `isinstance(remote, dict)`. Stripe 9.5 `Subscription` subclasses dict; a later major would not, and the live-lookup fix would silently turn off. The lookup now uses `to_dict_recursive()`, then `to_dict()`, then `dict()`. Webhook tests pass `stripe.Subscription.construct_from(...)`. Test: `@F-BILL-RETRIEVE`.
- **A failed tier read downgraded Pro to Free.** `readTier()` returned `"free"` when the service-worker message failed ("Extension reloaded"). `ProfitOverlay` applied that value. `readTier()` now returns `null` on failure, and callers apply only a non-null tier. A successful Free read still downgrades. Test: `@F-TIER-READ`.
- **`/billing/checkout` returned 500 when Stripe was not configured.** `stripe.Customer.create` raised and the global handler answered "Internal server error". A missing `STRIPE_SECRET_KEY` now returns `503 {"error":"Billing is not configured. Nothing was charged."}`. Any other `stripe.error.StripeError` from checkout or the portal returns `502 {"error":"Checkout could not start. Nothing was charged."}`. Tests: `@F-BILL-503`, `@F-BILL-502`.
- **v1 admin IP used the socket host.** `v1_routes._client_ip` read `request.client.host`, so a Fly `fly-client-ip` allowlist never matched. It now uses `netutil.client_ip`, the same header the rest of the API trusts. That is safe only because Fly's edge proxy overwrites `fly-client-ip`. A short `ADMIN_API_TOKEN` (under 32 bytes) is still rejected even when that IP is allowlisted.
- **The open overlay did not learn about a webhook.** First fixed by sending `AUTH_STATUS` every 2 seconds, which cost one `/auth/me` call per open tab every 2 seconds. Replaced: see "Every open panel called the API every 2 seconds" below.
- **The list headline did not count missing costs.** When every product on the page is missing a cost, the headline is now `10 products · 10 missing costs`.
- **Statement size errors were replaced with a generic message.** `StatementImport` now shows the thrown limit text (`20 MB or smaller`, `50,000 rows`).
- **A signed remote config could not turn a bundled-off flag on, and the content script never applied remote selectors.** `evaluateFlag` now treats `enabled: true` as an on switch (a kill switch is still `enabled: false`). The content script verifies `remoteConfigCache` and prepends its CSS selectors. Diamond shows its price line only then. (What-if and CSV export now ship on; the plan picker promises them.)
- **Signup blocked a weak password with different words than the API.** The overlay now shows `Password needs at least 3 of: uppercase, lowercase, number, special character`.
- **Checkout for an unverified email left the plans view before the sentence could be read.** The plans alert now says `Verify your email to start your trial`, and Open Account routes to the code field.
- **A free import of more than the cost cap did not say that price-only rows are unlimited.** The sync line now adds that sentence when a free account imports more rows than `free.skuLimit`.
- **The overlay included the refund admin fee, so nets disagreed with the answer key.** First fixed by turning the fee off. Replaced: the fee is real (TikTok keeps 20% of the referral fee, up to $5, on each refund), so it is now included on typed costs everywhere and the answer key was rebuilt independently. See below.
- **A stopped API did not show the connection-lost banner.** The service worker turned a failed `API_CALL` fetch into "Background handler failed". It now answers `Connection lost. Check your internet.`
- **A signed remote price selector was ignored unless it matched an input.** List-price selectors, including the remote one, now also read an element's text. A span such as `[data-e2e-remote-price]` can supply the price.
- **A second sync of an unchanged list said "Imported" again.** `syncSkus` counted every row as saved. It now counts a row only when the title, price, units, or promo changed, so the overlay can say `Found 10. Already up to date.`
- **The save-button nudge ran before the card had a height, so it covered the page Save button.** A resize observer nudges again once the card is taller than 40px.
- **Typing in the panel re-parsed the page and replaced the cost field mid-keystroke.** Page `input` events from inside the overlay are ignored. Seller Center fields still resync the price.

### Found and fixed in the launch pass (30 September 2026)

- **Every open panel called the API every 2 seconds.** The plan check sent `AUTH_STATUS` (a live `/auth/me`) on a 2-second timer: 30 calls a minute per open Seller Center tab. Panels now read the cached plan (`GET_TIER`). The worker asks the server at most once a minute, and at once on sign-in, a token change, the billing success page, a toolbar click, and "Refresh plan". After checkout opens, a 30-second alarm checks for up to 15 minutes, so Pro unlocks on the open panel even if the seller never returns to the success page. Tests: `@F-TIER-REFRESH` (8 unit tests), `E-BILL-CHECKOUT-POLL`, `E-NET-BUDGET`.
- **The refund admin fee was left out of every estimate.** TikTok keeps 20% of the referral fee (max $5) on refunded orders. It is now part of every typed-cost estimate, on every screen, through one function (`profitInputFor`); a statement's actual fees replace it. `scripts/answer-key.py` recomputes every expected number in Python without importing the extension. Tests: `labAnswerKey.test.ts`, `E-LAB-NUMBERS`.
- **Two kill switches did nothing.** `statementImport` and `promoGuard` were in `flags.json` but no code read them, so turning them off in a signed config changed nothing. Both are now checked. Every live flag's E2E test now proves the feature is on by default and that `enabled: false` hides it. Tests: `E-FLAG-*`.
- **A cost typed just before leaving the page was lost.** Edits save 400ms after the last change. Leaving within that window (closing the tab, Seller Center navigating) dropped the edit, and the "Saved" tick from the previous save was still showing. A pending edit is now written on page hide, tab switch and panel close, and "Saved" clears while an edit is pending. Test: `E-COST-CONSISTENT` leaves the page immediately after typing.
- **A late load of the saved product could overwrite what the seller typed.** The panel reloads the saved record whenever settings change. It no longer replaces cost fields the seller has edited on that product.
- **Copy errors in the paywall and import messages.** "1 of your product loses money", "the exact fix for each" for a single product, and "Updated 1 products". Fixed; tests check the exact sentences.
- **Bulk paste split "Mug, Blue; 3.25" at the first comma.** Lines now split at the last tab, then semicolon, then comma. Test: `bulkCost.test.ts`.
- **The Shop Performance Score was on the wrong scale and never re-read.** TikTok's SPS is 0 to 5 (thresholds 2.5, 3.0, 3.5, 4.0). The old code used 0 to 100, and a 6-hour alarm only bumped the date. The score is now read from Account Health (signed remote selector first, then the label), a "Not enough orders" page never erases the last real score, and the panel warns at each threshold. Tests: `sps.test.ts`, `spsCapture.test.ts`, `E-SPS-READ`, `E-SPS-WARN`.
- **The coverage gate could not fail on untested code.** Surfaces nothing covered were listed but never counted as errors. The gate is now a pure function with its own 14 tests that prove each rule fails when it should. Test: `scripts/coverage-gate.test.mjs`.
- **The E2E harness could hang the API.** Uvicorn's stdout pipe was never read; after about 64 KB of access log the server blocked mid-suite. Both pipes are read now.
- **Row checks read only the first 50 database rows.** Signup, delete and billing checks now filter by the test's own email or subscription id.
- **CI could not run the extension tests.** Chromium runs headed for extensions and the Linux runner has no display; the job now uses `xvfb-run`. Screenshot baselines were Windows-only; they are now per OS and a manual CI run writes the Linux set.

## Test changes in the launch pass

- Rewritten so they can fail: the lab answer key (every product's net, margin and verdict, and exact bucket membership, before and after the statement; the xlsx import is applied, not just opened), the flag tests (default on plus kill switch), the service-worker restart (the panel is closed first and must come back from a new worker), API down, extension reload and the remote selector (fetched by the extension's own alarm, not written into storage by the test).
- New: `e2e/specs/14-growth.spec.ts` covers creators (Free and Pro, against the answer key), weekly recap, SPS read and warnings, bulk paste, the value receipt, one net everywhere, the post-checkout poll and the network budget.
- Deleted tests for flags with no screen (`aiInsights`, `trendsTelemetry`, `trendsView`, `bulkScan`, `productCheck`). They are listed in `qa/feature-map.json` `deadFlags` with a reason.

## Test-only changes

- Overlay shadow root is `open` only when `VITE_E2E=1` (`npm run build:e2e` → `dist-e2e/`). Store builds stay `closed`. `checkProdBuild` rejects an open shadow root. Test: `@F-BUILD-E2E`.
- Each test unloads seller pages and clears extension storage. Signing in also closes leftover product tabs and clears storage again, because a previous overlay can write its SKUs back after the setup clear and the next test then opens a product that already has a cost.

## Dead code

- The old popup (`Popup.tsx`, `main.tsx`, `index.html` and popup-only screens) is deleted. The toolbar button opens the in-page panel; creators moved into the panel's Creators tab. Shared pieces the panel uses (`LoginScreen`, `SettingsPanel`, `ProfilePanel`, `SupportCenter`, `AutoSyncBar`) stay.
- Also deleted: `uxFlags`, `marketPrice`, `productCheckQuota`, `promoChip`, `FeatureGate`, `ProductCheckCard`, `ReportProblemForm`, `CreatorPerformance`, `playwrightScraper`, and two one-off scripts.
- Kept but unreachable, each with a reason in `qa/feature-map.json` `deadCode`: `reviewFlags.ts`, `trendsClient.ts`.

## Not automated

- The service-worker restart test stops the worker with CDP, then with `chrome://serviceworker-internals`. If both fail, the test fails (it no longer passes on a page reload) unless `E2E_ALLOW_SW_FALLBACK=1`. The errors are in `qa/report/sw-restart-errors.txt`.
- `E-STRIPE-REAL` runs only when `E2E_STRIPE` is set. `E-LIVE-SHOP` runs only when `LIVE_PRODUCT_URL` is set.
- Screenshot baselines are per OS. `E-VIS-SNAPSHOTS` skips (naming `E2E_VISUAL_BASELINES`) where the OS has none; `npm run test:baselines` writes them for review. The old baselines were deleted because the panel changed.
- Flags with no screen: `productCheck`, `aiInsights`, `trendsTelemetry`, `trendsView`, `bulkScan`. They ship off.
- Blank pages are served as a short 404 document so `isMissingPage` shows the didn't-load alert. A zero-length body is not treated as missing.
- Delete account confirms with the password and **Delete my account**. The panel does not ask the seller to type DELETE.
- A $0 cost does not show a net. The no-price and live-edit tests enter a cost, then check the engine net.
