# Path forward

## v1.4.0 (polish + Pro/Free separation)

Done, with tests:

| Area | What | Test |
|---|---|---|
| Pro shows "Upgrade" | API: an `active` subscription row with no Stripe id, promo date, or tier now reads Pro (`promo.effective_sub_status`, `tiers.effective_tier`). Ops-console grants also write `tier`. | `PRO1`–`PRO7` in `backend/test_pro_sync.py`, `backend/test_promo.py` |
| Pro shows "Upgrade" | Overlay: `fetchMe()` looked for the token in extension storage, which Seller Center pages cannot read, got `null`, and forced Free. It now goes through the service worker and a missing answer never downgrades. | `PRO_overlay_reads_plan_without_storage_access` |
| Swallowed API errors | Proxy read `.error`, FastAPI sends `.detail`. | `BUG_fastapi_detail_reaches_the_ui_not_request_failed`, `errorTextFromJson` |
| Sign-in buttons | Buttons now come from `GET /auth/providers`. TikTok hidden until configured. | `visibleProviders` |
| Password change | Revokes other sessions, returns a fresh token for this one. | `SEC1_password_change_revokes_old_tokens_and_returns_fresh_one` |
| UI | Green/red profit everywhere, Free vs Pro locks, plan screen, Account, Help & support, branded web pages. | `src/ui/ui.test.tsx`, `PAGE1`–`PAGE5` |
| Free limit | One knob: `src/tiers.json` `free.skuLimit` (now 5). Extension and API read it. | `L6_*` tests use the constant |

Owner actions for v1.4.0:

1. Deploy the API first (`.\scripts\deploy-prod.ps1`), then build and upload the extension. The new extension works against the old API, but the Pro fix needs the new API.
2. SMTP must be configured. Checkout requires a verified email, and the code is sent by email. Without SMTP nobody can start a trial.
3. To revoke a manual Pro grant, set the user to `free` in the ops console. A raw `active` row is now a permanent grant.
4. Set the free limit in `src/tiers.json` (`free.skuLimit`) and redeploy both sides if you change it.

## 1. Done

| ID | What | Test |
|---|---|---|
| L1 | Password reset stores a hashed 30-minute token, emails a link, and logs out old sessions. No SMTP returns 503. | `L1_reset_token_single_use`, `L1_reset_expires`, `L1_reset_bumps_token_version`, `L1_no_smtp_returns_503` |
| L2 | Register can email a 6-digit code. Checkout returns 403 until the email is verified. Google sign-in marks the email verified. Free use is not blocked. | `L2_checkout_requires_verified_email`, `L2_oauth_google_verified`, `L2_code_attempt_limit` |
| L3 | Stripe sync uses the stored customer id only, and only after a recent checkout or a verified Checkout Session. Plan changes update the tier. Diamond is not replaced by a Pro price. | `L3_no_customer_lookup_by_email`, `L3_me_skips_stripe_when_no_pending_checkout`, `L3_plan_change_updates_tier`, `L3_diamond_not_downgraded_by_sync` |
| L4 | Manifest permissions are `storage`, `alarms`, `scripting`. A 5,000-product plus 12-month line budget stays under 10 MB, so `unlimitedStorage` is gone. | `L4_manifest_permissions_used` |
| L5 | Sign-in buttons follow `GET /auth/providers`. TikTok is hidden. | `L5_unconfigured_providers_hidden` |
| L6 | Sync stores every price. The free cap applies when saving a cost on an 11th product. | `L6_sync_never_blocks_free`, `L6_11th_cost_prompts_upgrade`, `L6_existing_users_migrate` |
| L7 | The edit fixture's 20% discount becomes promo price $36 on a $45 retail price. | `L7_edit_page_discount_used` |
| L8 | `scripts/config-keygen.py` and `scripts/sign-config.py`. Prod builds require `VITE_CONFIG_PUBLIC_KEY`. Remote config can turn a bundled-on feature off, not turn Diamond on. | `L8_python_sign_ts_verify`, `L8_remote_selector_override_used`, `L8_killswitch_hides_feature` |
| S1 | Rate-limit memory drops stale buckets and stays at 50,000 keys. | `S1_rate_limit_memory_bounded` |
| S2 | API image runs as `appuser`, exec-form command, health check. | Dockerfile. Smoke not run on this machine. |
| S3 | Delete nulls telemetry user ids, deletes support tickets older than 30 days, and deletes the Stripe customer after cancel. | `S3_delete_purges_pii` |
| S4 | `POST /auth/refresh` rolls the 30-day token. The service worker refreshes when fewer than 7 days remain. | `S4_refresh_issues_a_new_token` |
| S5 | FastAPI 0.116.1, Starlette 0.47.3. | `pip` shows those versions |
| S6 | CI already runs tests, pip-audit, npm audit, gitleaks, and a Docker build. A health smoke step was added. | `.github/workflows/ci.yml` |
| C1–C5 | `store/terms.html`, checkout disclosure text, `store/CWS_DATA_DISCLOSURE.md`, affiliation line, versions aligned to 1.3.0, prices $14.99 / $120. | Disclosure string in `src/lib/billingDisclosure.ts` |
| U3, U5, U7, P3, P4 | Bulk matcher, yearly-first plan picker, local leak total, promo chip copy, new-leak counter. | `U3_bulk_paste_matches_by_sku_and_id`, `U7 sums leaks locally`, `P3_promo_chip_below_breakeven`, `P3_diagnose_promo_first`, `P4_checkin_counts_new_leaks_only` |

Extension tests: 135 passed, 3 skipped. Backend: 66 passed. Command center: 2 passed. `tsc -b` is clean.

## 2. Owner actions

1. Set SMTP so reset and verify emails can send: `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD`, `SUPPORT_INBOX`. All of those names are missing in local `.env`.
2. Generate the config key outside the repo and put only the printed public key in `VITE_CONFIG_PUBLIC_KEY` for prod builds, and in `CONFIG_PUBLIC_KEY` on the API:
   `python scripts/config-keygen.py C:\Users\dimar\secrets\marginmark-config.pem`
3. Stripe Dashboard → Settings → Billing → Subscriptions and emails: turn on the trial-ending reminder. Settings → Billing → Customer portal: allow customers to cancel.
4. Host `store/privacy.html` and `store/terms.html` at `https://plainsmansoftware.com/marginmark/privacy` and `https://plainsmansoftware.com/marginmark/terms`.
5. Set `EXTENSION_IDS` for the LLE Fly app to the unpacked extension id. It is missing locally.
6. Stripe price ids: `STRIPE_PRICE_TIKTOK_SELLER` and `STRIPE_PRICE_TIKTOK_SELLER_YEARLY` are set. `STRIPE_PRICE_PRO_MONTHLY` and `STRIPE_PRICE_PRO_YEARLY` are not. The API falls back to the `TIKTOK_SELLER` names.
7. Reload the extension after `.\scripts\dev-up.ps1 -Build`. Sign up, enter the code from the email (after SMTP is set), then start checkout with a test card.

## 3. Closed-beta checklist

Use the v2 release gate in `qa/TEST_PLAN.md`. Do not start it until SMTP works and the three sample files below exist.

## 4. Backlog

- Scrubbed samples still required before those screens are trusted: `test-fixtures/real/statement-sample.csv`, `test-fixtures/real/affiliate-orders-sample.csv`, and a promotion-creation HTML page. Do not guess column names.
- First-run checklist, inline cost on the hero, overview tiles that jump to the first empty cost, weekly check-in screen, and the header leak total are calculated in code and not all drawn in the overlay yet.
- TikTok Shop Partner Center finance API, after about 50 paying users.
- Opt-in weekly email (privacy policy and a physical address first).
- Multi-shop / agency tier.
- Diamond and AI review insights stay off in `src/flags.json`.
