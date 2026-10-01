# Testing MarginMark

Run these from the repo root on Windows. The same Node scripts run in GitHub Actions.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Vitest only. |
| `npm run test:backend` | Pytest in `backend/`, including the route recorder. |
| `npm run test:e2e` | `build:e2e` then Playwright. |
| `npm run test:gate` | The gate's own self-test (proves each rule can fail), then the coverage gate against the latest `qa/report` files. |
| `npm run answer-key` | Rewrites `test-fixtures/lab/expected.json` from `scripts/answer-key.py` (plain Python, never imports the extension). `--check` fails if the file is stale. |
| `npm run test:baselines` | Writes screenshot baselines for this OS (review, then commit). |
| `npm run launch:check -- https://<api>` | Launch readiness: prices, flags, version, store copy, and the API's mail/Stripe/config readiness. |
| `npm run test:live` | Opt-in Seller Center smoke. Not part of the default run. |
| `npm run test:everything` | Typecheck, answer-key freshness, Vitest, pytest, e2e build guard, Playwright, gate self-test, coverage gate, and `qa/report/verification-bundle.zip`. |

`npm run test:everything` keeps going after a failed step and exits non-zero if any step failed. The zip path is printed at the end.

## Environment

The pytest session and the Playwright harness set these themselves so `backend/.env` cannot point tests at Neon, Stripe, or a real mailbox:

| Variable | Test value |
|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | empty |
| `DB_PATH` | a fresh temp file per run |
| `STRIPE_SECRET_KEY` | empty, unless `E2E_STRIPE=1` |
| `SMTP_HOST` / `SMTP_PORT` | `127.0.0.1` / `1025` (local sink) |
| `JWT_SECRET`, `ADMIN_KEY`, `TELEMETRY_READ_KEY` | random, 32+ bytes, all different |
| `E2E_PYTHON` | Python used to start the API and pytest. Default is `py -3` on Windows when that interpreter has the API packages, otherwise `py -3.12`, otherwise `python3`. |
| `E2E_REUSE_API=1` | Do not spawn the API; use one already on port 8000. |
| `E2E_STRIPE=1` | Real Stripe test-mode checkout. Skipped with a reason otherwise. |
| `LIVE_PRODUCT_URL` | Required for `npm run test:live`. |
| `LIVE_MANAGE_URL` | Defaults to the US manage-products page. |
| `E2E_VISUAL_BASELINES=1` | Run the screenshot test on an OS with no baselines yet (set for you by `npm run test:baselines`). |
| `E2E_ALLOW_SW_FALLBACK=1` | Accept a page reload when Chromium refuses to stop the service worker. Off by default: then the restart test fails. |

## Screenshot baselines

Baselines are per OS (`logged-out-win32.png`, `logged-out-linux.png`, ...) because fonts render differently. Write them with:

```
npm run test:baselines
```

Review the images in `e2e/specs/12-visual-a11y.spec.ts-snapshots/` before committing. `maxDiffPixelRatio` is 0.01. For Linux, run the `ci` workflow by hand with **baselines** ticked and commit the `linux-screenshot-baselines` artifact.

## The answer key

`test-fixtures/lab/` is a fake shop of 10 products (A to J), a settlement statement and an affiliate order export with 5 creators. `scripts/answer-key.py` computes every expected number by hand-written rules: net, margin, verdict and bucket per product, before and after the statement, and profit and verdict per creator. The unit tests (`labAnswerKey.test.ts`) and the browser tests (`05-lab-answer-key`, `14-growth`) must match it. If you change a fee rule, change it in both places; a mismatch is the point.

## Adding a feature

1. Add the test with a tag in the title or docstring, for example `@F-LIMIT-01`.
2. Add that id to `qa/feature-map.json` with the routes, messages, components, and flags it covers.
3. `npm run test:gate` fails if a discovered surface is missing, the tag is not in a test file, or the tagged test did not pass.
4. Every live flag needs an `E-FLAG-<name>` test that proves the feature is on and that a signed config with `enabled: false` hides it. A flag that ships off with no screen goes in `deadFlags` with a reason.
