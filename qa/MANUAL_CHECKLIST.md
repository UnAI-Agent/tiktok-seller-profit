# Manual checks

Run these only when the automated attempt cannot. The browser suite covers the click-through.

- **Stop the service worker.** E-INST-SW-RESTART stops the worker itself (CDP, then `chrome://serviceworker-internals`). If both fail, the test fails and `qa/report/sw-restart-errors.txt` has the errors. Stop the MarginMark worker from `chrome://serviceworker-internals` by hand, confirm the panel comes back with your costs, then rerun with `E2E_ALLOW_SW_FALLBACK=1` to accept the reload fallback for that run.
- **Screenshot baselines.** After a UI change, run `npm run test:baselines`, open the PNGs in `e2e/specs/12-visual-a11y.spec.ts-snapshots/`, and commit them if they look right. Each OS has its own files (`-win32`, `-linux`). For Linux (CI), run the `ci` workflow by hand with "baselines" ticked and commit the artifact.
- **Real Stripe.** Set `E2E_STRIPE=1` with `sk_test_…` price ids and `stripe listen`. The opt-in spec is `e2e/stripe/real-stripe.spec.ts`.
- **Live Seller Center.** Set `LIVE_PRODUCT_URL` to one product edit URL. The opt-in spec is `e2e/live/seller-center.live.spec.ts`. It only reads the page.

## Before launch

- **Mail must work, or nobody can start a trial.** A trial needs a verified email, and the code goes out over SMTP. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` on the production API, register a real address, and confirm the code arrives (check spam).
- **Run `npm run launch:check -- https://<prod API host>`.** It checks prices, flags, version, store copy and the API's readiness (mail, Stripe key, webhook secret, webhook events, price ids, config key, public URL), and prints the fix for each miss.
- **One real purchase.** With live keys, buy Pro monthly on your own account from the extension, confirm the panel says "Pro unlocked" within a minute without reopening it, then refund yourself in Stripe and confirm the panel goes back to Free after "Refresh plan".
- **Stripe prices.** The monthly price is $14.99/month and the yearly $120/year. The API refuses to start in LLE and logs an error in prod if they differ from `src/tiers.json`.
