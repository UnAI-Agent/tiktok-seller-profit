# STATE

## Current

v1.3 launch blockers are in the tree: password reset, email verification, Stripe customer sync, and the free cost cap. SMTP, the config signing key, and real statement/creator/promo fixtures are still owner work. Three real-fixture tests still skip.

## Backlog

1. Host `store/privacy.html` on HTTPS + CWS submit
2. Production domain, Stripe live keys, backend deploy (first `fly apps create marginmark-api-lle` still ops)
3. Playwright on live Seller Center
4. Confirm a real settlement has no separate payment-processing line (D17, D23)
5. Save buyer fixtures before any buyer parser: `test-fixtures/buyer-pdp-*.html`, `buyer-search-*.html`, plus one settlement statement
6. Before public release (D25): two YubiKeys hold the Ed25519 signing key; public key only in `src/config/configPublicKey.ts` and `CONFIG_PUBLIC_KEY`. Database passwords live in a password manager plus Fly secrets, separate from that key.
7. New Relic OTLP key, Grafana Cloud import, Cloudflare Access + WebAuthn registration
8. Create Stripe prices and founder coupons (test, then live)
9. Enable prod flags one per day after LLE checks: overlay, productCheck, trendsTelemetry, aiInsights, trendsView, bulk tools, diamondEnabled
10. Remove the disabled legacy script body from `backend/static/ops.html`

## Done

- 2026-09-29: Local, LLE, and prod stay one repo; prod promotes the LLE image; secrets cannot be committed
- 2026-09-28: Reopening the overlay after sign-in shows the panel, not only the footer
- 2026-09-28: Overlay keeps Pro when the subscription row is an active Pro plan
- 2026-09-28: Sign-in stays Free unless the subscription row is Pro or Diamond
- 2026-09-28: Overlay sign-out clears the session from the service worker
- 2026-09-28: Signed-in overlay has an account icon for name, email, plan, password, sign-out, and delete
- 2026-09-28: Local builds include the laptop API address, so the Google button can open Google
- 2026-09-28: Login and sign-up always show Google, Facebook, and TikTok plus email and password
- 2026-09-27: Minimized overlay shows the MarginMark logo; column and cost labels explain the number
- 2026-09-27: Missing cost cards have Add purchase cost, which opens that product's cost box

## Notes

Prompt §1 says Free 25 SKUs; §3/§10 and code use **10**. Keep 10.

`backend/legacy/main.py` is the old shared app. Docker ignores `legacy/` and runs `marginmark_app:app`.
Buyer hosts stay out of `manifest.json` until the fixtures in backlog item 5 exist.
Command Center enforces Access and WebAuthn. Selector sandbox and New Relic tiles are not in that UI yet.
Do not submit the store zip until backlog item 6 is done.
