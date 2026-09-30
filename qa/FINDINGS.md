# Findings

Product bugs fixed while building the harness. Test-only changes and dead code are listed too.

## Product bugs

- **Re-subscribe kept `stripe_status=canceled`.** `checkout.session.completed` calls `_set_sub`, which updated `stripe_sub_id` but left `stripe_status`, `current_period_end`, `interval`, and `amount_cents` from the previous subscription. A later `invoice.paid` whose Stripe retrieve failed then treated the new subscription as canceled, and `/auth/me` reported `plan_status: "canceled"` for a paying user. `_set_sub` now clears those columns when the incoming subscription id differs. Test: `@F-BILL-RESUB`.
- **`_retrieve_subscription` required a dict subclass.** It returned `None` unless `isinstance(remote, dict)`. Stripe 9.5 `Subscription` subclasses dict; a later major would not, and the live-lookup fix would silently turn off. The lookup now uses `to_dict_recursive()`, then `to_dict()`, then `dict()`. Webhook tests pass `stripe.Subscription.construct_from(...)`. Test: `@F-BILL-RETRIEVE`.
- **A failed tier read downgraded Pro to Free.** `readTier()` returned `"free"` when the service-worker message failed ("Extension reloaded"). `ProfitOverlay` applied that value. `readTier()` now returns `null` on failure, and callers apply only a non-null tier. A successful Free read still downgrades. Test: `@F-TIER-READ`.
- **`/billing/checkout` returned 500 when Stripe was not configured.** `stripe.Customer.create` raised and the global handler answered "Internal server error". A missing `STRIPE_SECRET_KEY` now returns `503 {"error":"Billing is not configured. Nothing was charged."}`. Any other `stripe.error.StripeError` from checkout or the portal returns `502 {"error":"Checkout could not start. Nothing was charged."}`. Tests: `@F-BILL-503`, `@F-BILL-502`.
- **v1 admin IP used the socket host.** `v1_routes._client_ip` read `request.client.host`, so a Fly `fly-client-ip` allowlist never matched. It now uses `netutil.client_ip`, the same header the rest of the API trusts. That is safe only because Fly's edge proxy overwrites `fly-client-ip`. A short `ADMIN_API_TOKEN` (under 32 bytes) is still rejected even when that IP is allowlisted.
- **The open overlay did not learn about a webhook.** The plan was read when `loggedIn` changed, not on the 2 second resync. That interval now also sends `AUTH_STATUS`, so Pro can unlock without a reload.
- **The list headline did not count missing costs.** When every product on the page is missing a cost, the headline is now `10 products · 10 missing costs`.
- **Statement size errors were replaced with a generic message.** `StatementImport` now shows the thrown limit text (`20 MB or smaller`, `50,000 rows`).
- **A signed remote config could not turn a bundled-off flag on, and the content script never applied remote selectors.** `evaluateFlag` now treats `enabled: true` as an on switch (a kill switch is still `enabled: false`). The content script verifies `remoteConfigCache` and prepends its CSS selectors. What-if and CSV export stay hidden until that signed doc turns them on. Diamond shows its price line only then.
- **Signup blocked a weak password with different words than the API.** The overlay now shows `Password needs at least 3 of: uppercase, lowercase, number, special character`.
- **Checkout for an unverified email left the plans view before the sentence could be read.** The plans alert now says `Verify your email to start your trial`, and Open Account routes to the code field.
- **A free import of more than the cost cap did not say that price-only rows are unlimited.** The sync line now adds that sentence when a free account imports more rows than `free.skuLimit`.
- **The overlay included the refund admin fee, so nets disagreed with the answer key.** Seller-facing estimates now pass `includeRefundAdminFee: false`. The fee stays out until a settlement states it.
- **A stopped API did not show the connection-lost banner.** The service worker turned a failed `API_CALL` fetch into "Background handler failed". It now answers `Connection lost. Check your internet.`
- **A signed remote price selector was ignored unless it matched an input.** List-price selectors, including the remote one, now also read an element's text. A span such as `[data-e2e-remote-price]` can supply the price.
- **A second sync of an unchanged list said "Imported" again.** `syncSkus` counted every row as saved. It now counts a row only when the title, price, units, or promo changed, so the overlay can say `Found 10. Already up to date.`
- **The save-button nudge ran before the card had a height, so it covered the page Save button.** A resize observer nudges again once the card is taller than 40px.
- **Typing in the panel re-parsed the page and replaced the cost field mid-keystroke.** Page `input` events from inside the overlay are ignored. Seller Center fields still resync the price.

## Test-only changes

- Overlay shadow root is `open` only when `VITE_E2E=1` (`npm run build:e2e` → `dist-e2e/`). Store builds stay `closed`. `checkProdBuild` rejects an open shadow root. Test: `@F-BUILD-E2E`.
- Each test unloads seller pages and clears extension storage. Signing in also closes leftover product tabs and clears storage again, because a previous overlay can write its SKUs back after the setup clear and the next test then opens a product that already has a cost.

## Dead code

- `src/popup/Popup.tsx` and popup-only children are unreachable for users. The service worker calls `chrome.action.setPopup({ popup: "" })` on load, install, startup, and every click, and nothing opens `index.html`. Recommendation: delete the popup entry after the overlay has replaced it. Shared pieces (`LoginScreen`, `SettingsPanel`, `ProfilePanel`, `SupportCenter`, `AutoSyncBar`) stay; the overlay uses them.

## Not automated

- Service worker stop is attempted with CDP `Target.closeTarget`, then the Stop button on `chrome://serviceworker-internals/?devtools`. If both fail, the exact errors are in `qa/report/sw-restart-errors.txt` and the passing substitute reloads the seller page. See `qa/MANUAL_CHECKLIST.md` only when that file exists.
- `E-STRIPE-REAL` runs only when `E2E_STRIPE` is set. `E-LIVE-SHOP` runs only when `LIVE_PRODUCT_URL` is set.
- Screenshot baselines are captured on this machine. A Linux CI run can differ by font and will need its own baselines.
- These flags have no product screen of their own: `productCheck`, `aiInsights`, `trendsTelemetry`, `trendsView`, `bulkScan`, `bulkCost`. The tests assert the bundled on/off state (no entry point when off).
- Blank pages are served as a short 404 document so `isMissingPage` shows the didn't-load alert. A zero-length body is not treated as missing.
- Delete account confirms with the password and **Delete my account**. The panel does not ask the seller to type DELETE.
- A $0 cost does not show a net. The no-price and live-edit tests enter a cost, then check the engine net.
