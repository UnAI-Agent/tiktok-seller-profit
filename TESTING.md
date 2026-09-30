# Testing MarginMark

Run these from the repo root on Windows. The same Node scripts run in GitHub Actions.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Vitest only. |
| `npm run test:backend` | Pytest in `backend/`, including the route recorder. |
| `npm run test:e2e` | `build:e2e` then Playwright. |
| `npm run test:gate` | Coverage gate against the latest `qa/report` files. |
| `npm run test:live` | Opt-in Seller Center smoke. Not part of the default run. |
| `npm run test:everything` | Typecheck, Vitest, pytest, e2e build guard, Playwright, coverage gate, and `qa/report/verification-bundle.zip`. |

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

## Screenshot baselines

Playwright stores baselines next to the spec. Update them with:

```
npx playwright test --update-snapshots
```

Review the images before committing. `maxDiffPixelRatio` is 0.01.

## Adding a feature

1. Add the test with a tag in the title or docstring, for example `@F-LIMIT-01`.
2. Add that id to `qa/feature-map.json` with the routes, messages, components, and flags it covers.
3. `npm run test:gate` fails if a discovered surface is missing, the tag is not in a test file, or the tagged test did not pass.
