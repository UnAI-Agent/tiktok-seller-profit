# Manual checks

Run these only when the automated attempt cannot. The browser suite covers the click-through.

- **Stop the service worker.** If `qa/report/sw-restart-errors.txt` exists, both CDP `Target.closeTarget` and the Stop button on `chrome://serviceworker-internals/?devtools` failed. The file has the error text. Stop the MarginMark worker from that page by hand, then open the panel and confirm the saved costs are still there.
- **Real Stripe.** Set `E2E_STRIPE=1` with `sk_test_…` price ids and `stripe listen`. The opt-in spec is `e2e/stripe/real-stripe.spec.ts`.
- **Live Seller Center.** Set `LIVE_PRODUCT_URL` to one product edit URL. The opt-in spec is `e2e/live/seller-center.live.spec.ts`. It only reads the page.
