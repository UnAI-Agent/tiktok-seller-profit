# DECISIONS

## D01 — This repo is the Git home

Chosen: `tiktok-seller-profit` on GitHub holds the extension at repo root plus `backend/`.
Rejected: leaving the only copy under unversioned `ChromExtentionProjects/extensions/tiktok-seller-tool`.
Why: user cloned an empty GitHub repo specifically to version the TikTok product.

## D02 — Copy shared FastAPI backend as-is

Chosen: copy `main.py` / `db.py` (still has shop-reply and listing-analyzer `SERVICES` blocks).
Rejected: extracting a TikTok-only FastAPI rewrite in the same move.
Why: Pro auth, Stripe, and SKU sync already depend on this file; a rewrite is a separate task.

## D03 — Email JWT instead of Firebase (for now)

Chosen: FastAPI email/password + JWT; SKU cloud via `/skus`.
Rejected: Firebase Auth + Firestore from the Cursor prompt.
Why: already shipped for alpha; Firebase is optional vs the production brief.

## D04 — OAuth on FastAPI, not Firebase

Chosen: Google / Facebook / TikTok authorization-code flow on `backend/oauth.py`, JWT via one-time ticket exchange.
Rejected: Firebase Auth, implicit grant, or putting client secrets in the extension.
Why: keeps API keys on the backend (invariant 1) and matches the existing email JWT.

## D05 — LLE is a second deploy, not a second git repo

Chosen: one repo; Fly apps `marginmark-api-lle` + `marginmark-api-prod`; Neon branches; `scripts/build-lle.ps1` / `build-prod.ps1`. App names updated in D20. The git repo stays `tiktok-seller-profit`.
Rejected: cloning a second GitHub repo for staging (it would drift).
Why: the extension is built with `VITE_API_BASE_URL`; the API is the only always-on service. See `DEPLOY.md`.

## D06 — LLE uses real accounts; only Stripe is test mode

Chosen: same code as prod; `APP_ENV=lle` refuses `sk_live_`; Pro unlocks only via Checkout + webhook.
Rejected: fake login, skip-payment Pro grants, or buying on live Stripe to “be sure.”
Why: the user-facing charge is the only prod-only network. Webhook fulfillment must be proven on LLE.

## D07 — Owner ops console on the API

Chosen: `/ops` HTML + `/admin/*` with `TELEMETRY_ADMIN_KEY`. Promo codes and remote config in the same DB. Account UI in Settings uses Stripe portal + `/billing/promo`.
Rejected: putting the master dashboard in the Chrome extension (users could extract it) or a second git app.
Why: one backend, many services; CWS is still the only way to ship new JS.

## D08 — Ops DB browser is identifier-only

Chosen: `/ops` Database tab lists tables from the live DB; rows are selected/updated/deleted with quoted identifiers + bound values. Secrets (`password_hash`, `code_verifier`) are redacted; new passwords are bcrypt-hashed.
Rejected: a free-form SQL box in the browser.
Why: owner still needs to inspect and patch rows; concatenating SQL from the page would bypass the parameterized-query rule.

## D09 — OAuth ticket claimed from the API tab

Chosen: service worker opens the OAuth tab, reads `location.href` via `scripting`, exchanges the ticket, then `openPopup()` or replaces that tab with the extension page.
Rejected: relying on `tabs.onUpdated` URL (hidden after a Google.com navigation) or leaving users on `/auth/oauth/done`.
Why: Chrome closes the popup when Google opens; logs showed tickets issued and **zero** `/auth/oauth/exchange` calls. New accounts stay Free.

## D10 — Seller Center uses the in-page overlay, not a second popup

Chosen: on Seller Center, the toolbar icon has no Chrome popup. It toggles the bottom-right in-page panel (login until signed in, profit overlay after). Off Seller Center, `index.html` popup stays.
Rejected: showing AuthSplash and the profit card at the same time.
Why: the user clicks the puzzle/icon and saw two UIs; the overlay is the product surface.

## D11 — Restart one environment at a time

Chosen: `scripts/dev-up.ps1` for laptop; `deploy-lle.ps1` then `deploy-prod.ps1` with Fly `--strategy rolling`. Never a combined restart.
Rejected: restarting local, LLE, and prod together, or assuming one Fly machine is zero-downtime.
## D12 — One bottom overlay, never a Seller Center popup fallback

Chosen: profit snapshot and compact login live in the same bottom-right card. `seller.us.tiktok.com` is a Seller Center host. Toolbar icon toggles that card only; `sendMessage` failure must not open `index.html`.
Rejected: AuthSplash Chrome popup stacked on the profit overlay, or gating the overlay on a stored token.
Why: icon click on Seller Center was opening the large popup while the overlay stayed visible; users were not logged in after Google because that popup is not the session surface.

## D13 — OAuth exchange must not clear a new JWT

Chosen: `/auth/oauth/exchange` uses a dedicated fetch; used-ticket 401 does not call `setStoredToken(null)`. Claimed tickets are remembered in `chrome.storage.local`.
Rejected: routing exchange through `apiFetch` (any 401 wiped the session).
Why: Chrome sleeps the service worker; popup `SCAN_OAUTH` retried the same ticket, got 401, and signed the user out after Google had already succeeded.

## D14 — Ops Users tab is the owner editor

Chosen: `/ops` Users tab patches email, password, Pro/free, Stripe ids, promo expiry, applies promo codes, and issues a one-time temp password. Telemetry events join `users.email`.
Rejected: expecting the owner to hunt `telemetry_events.user_id` or edit `subscriptions` by hand for every grant.
Why: Google login writes email on `users` + auth telemetry; owner support needs to query and mutate that row.

## D15 — OAuth done page pings the extension directly

Chosen: pass `chrome.runtime.id` as `client` on OAuth start (stored in `state`); done page `chrome.runtime.sendMessage` via `externally_connectable`; SW also `executeScript`s a claimer. Toolbar icon never opens the Chrome popup when a Seller Center tab exists — it `SHOW_INPAGE_PANEL`s bottom-right.
Rejected: asking the user to click the icon on the API done tab (that opens AuthSplash at the top).
Why: after Google the active tab is `/auth/oauth/done`, so the previous onClicked path opened the toolbar popup and still looked signed out.

## D17 — US fee preset excludes payment processing until a statement shows it

Chosen: `FEE_PRESETS` in `src/config.ts` uses 8% or 6% referral and **0% / $0** payment. Existing v1 settings keep their saved payment numbers (`feePreset: custom`).
Rejected: keeping 2.9% + $0.30 on new installs while sources disagree on whether that fee is already inside the referral.
Why: double-counting ~3% makes every product look worse. One constant change if a settlement has a separate processing line.

## D18 — Store name was MarginGuard (superseded by D20)

Chosen at the time: manifest name `MarginGuard — Profit for TikTok Shop sellers`.
Rejected: keeping "TikTok Seller Tool", which can read as an official TikTok product.
Why: Chrome Web Store names that imply the platform get rejected. D20 replaces this name.

## D20 — Product name is MarginMark by Plainsman Software

Chosen: user-visible name MarginMark. Store title `MarginMark — Profit Calculator for TikTok Shop Sellers`. Footer `MarginMark by Plainsman Software`. Fly apps `marginmark-api-lle` and `marginmark-api-prod`.
Rejected: renaming the service id, storage keys, or Stripe metadata.
Why: those ids are already saved on devices and in billing. The git repo name stays `tiktok-seller-profit`.

## D19 — Default creator share is 100%

Chosen: `affiliateSharePct` defaults to 100 so the commission setting is actually in the number.
Rejected: defaulting the share to 0, which would leave commission out again.
Why: the overlay was overstating profit on creator-heavy products. Sellers can lower the share in Settings.

## D21 — Real Seller Center HTML is the scrape acceptance source

Chosen: `test-fixtures/real/<name>.html` plus sibling `<name>.expected.json`. Unit tests load those files.
Rejected: treating `test-fixtures/mock-tiktok-product-page.html` as proof the overlay reads Seller Center.
Why: hashed class names on the live page made the mock-only self-test pass while Manage products showed Untitled product.

## D16 — Overlay is the signed-in app shell

Chosen: profit overlay hosts Overview / Add products / Upgrade / Settings. Tab opens (`OPEN_TAB`) go through the service worker.
Rejected: leaving SKU/upgrade/settings only in the Chrome popup after the icon stopped opening it on Seller Center.
Why: the toolbar click shows the bottom-right overlay; that panel has to be the full product, not just the snapshot.

## D23 — 2026 fee presets migrate only the untouched 8% default

Chosen: new installs use 6% with payment included. Jewelry is 5%. Legacy keeps 8% + 2.9% + $0.30. Settings version 3 rewrites only `us-standard` rows still at 8 / 0 / 0.
Rejected: rewriting every saved 8% or 6% value, and folding the refund admin fee into `qa/golden-cases.json`.
Why: sellers who edited fees must keep those numbers. The refund admin fee (20% of referral, cap $5 per SKU, plus unrecovered shipping) is in `src/lib/refundFees.ts` and the overlay, and stays out of the golden formula until one real settlement confirms it.

## D24 — Remote config is signed data, and buyer parsers wait for fixtures

Chosen: Ed25519 via WebCrypto (`minimum_chrome_version` 137). Unsigned, expired, or downgraded configs are ignored. Buyer product and search parsers are not guessed.
Rejected: bundling a private key, or inventing TikTok buyer selectors without saved HTML.
Why: a bad selector or a guessed host permission would ship to every install. Flags default off.

## D25 — Signing key stays on two hardware keys

Chosen: two YubiKeys hold the Ed25519 config-signing key. Sign on a PC with a key plugged in, then publish the signed config. The repo and `CONFIG_PUBLIC_KEY` get only the public key. Database passwords stay in a password manager, with the database URL in Fly secrets.
Rejected: one vault or Fly secret that holds both the signing key and the database password, and a single thumb drive as the only copy.
Why: Fly cannot see a hardware key, and one shared store is a single point of failure. This blocks the Chrome Web Store zip.

## D26 — Statement rows are orders, and a promo loss is its own verdict

Chosen: import sets `unitsSold` to the order count and keeps fee, affiliate, shipping, and refund amounts as absolute values. A statement id may match the product id or `skuIds` captured on the edit page. If the promo price is under break-even and the list price is not, the verdict is “Promo price is below break-even” before the commission check.
Rejected: treating a negative TikTok fee as a negative rate, and blaming commission whenever a promo is the thing that crossed break-even.
Why: otherwise “lost on recorded sales” stays $0, a 6% fee becomes −6%, and a promo loss is described as a commission problem.

## D27 — Local, LLE, and prod cannot share a database

Chosen: the same variable names, different values in `backend/.env`, Fly secrets on `marginmark-api-lle`, and later `marginmark-api-prod`. Startup refuses LLE or prod without `DATABASE_URL`, refuses a host other than `EXPECTED_DB_HOST`, and refuses local when the host is `EXPECTED_DB_HOST_LLE` or `EXPECTED_DB_HOST_PROD`.
Rejected: one Neon URL copied into every environment, and trusting `X-Forwarded-For` for rate limits.
Why: a local process pointed at LLE would mix test accounts with real ones, and a spoofed forward header would bypass the login limit.

## D28 — One inbox, four ticket kinds

Chosen: `/support/ticket` accepts `problem`, `support`, `help`, or `info`. Omitted kind is `support`. The email subject is `[kind] …` and the row stores the seller’s subject unchanged. Squarespace aliases forward to the same `SUPPORT_INBOX`.
Rejected: a separate SMTP login per address.
Why: a new form adds one kind. The send path, database row, and mailbox stay the same.

## D29 — List scrape follows the text, then a struck price

Chosen: a product row is found from `ID:` text or a product link, not one CSS class. The buyer price is a labeled promo (`Promotion`, `Promo`, `Sale price`, `Discounted price`) or the price next to a strikethrough. Stock and listing status are stored when the row text has them.
Rejected: a single Seller Center class name as the only way to read a product.
Why: TikTok renames classes. The id, the dollar amount, and a struck price still describe the listing.

## D30 — Free tier caps saved costs, not imported rows

Chosen: sync may store every visible title and price. The free cap of 10 applies when a new product gets a cost (`costSource` other than `default`).
Rejected: blocking the 11th imported row before the seller enters a cost.
Why: the first visit was filling the cap with whatever the list page showed, so the product the seller opened next could not be saved.

## D31 — Sign-in always offers Google, Facebook, and TikTok

Chosen: login and sign-up always show the three social buttons plus email and password. A provider completes sign-in when its app credentials are set.
Rejected: hiding TikTok, or hiding a button until `GET /auth/providers` lists it.
Why: the seller should see the same choices as before. Password reset stays the emailed link.

## D22 — Deploy a MarginMark-only API

Chosen: Fly runs `marginmark_app:app`; SKU/cost data remains local and the API exposes only auth, billing, remote config, telemetry, and protected owner operations.
Rejected: deploying the shared reply-generation process and cloud SKU sync.
Why: a separate app per extension limits credentials, routes, dependencies, and breach impact.

## D32 — Pro only when the subscription row says so

Chosen: a user is Free until `subscriptions.tier` is `pro` or `diamond` on an entitled row (Stripe id or unexpired promo), or an unexpired tier override says so. Sign-in does not grant Pro.
Rejected: treating a missing tier, `is_pro` alone, or `status=active` with no Stripe id and no promo expiry as Pro.
Why: new and existing accounts were shown as Pro without a verified subscription.

## D33 — Prod promotes the LLE image

Chosen: `deploy-lle.ps1` builds and stamps `GIT_SHA`. `promote-prod.ps1` ships that same image after LLE `/health` reports the same commit. `/health` adds `commit` only.
Rejected: rebuilding prod from the working tree, or a second git branch per environment.
Why: what you tested on LLE is what production runs. Configuration selects the environment.
