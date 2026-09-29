# Testing before Chrome Web Store release

Three layers: **automated**, **in-extension self-test**, **manual** (mock page + real Seller Center).

## 1. Automated (run before every build)

```powershell
npm test
npm run build
```

Covers:

- Profit formulas, the 19-case answer key (`qa/golden-cases.json`), property tests, settings migration (`npm test`)
- Owner live checks for fees, product check, consent, kill switches, and Command Center: `marginmark-live-verification-v1.0.md`
- Built `dist/` must not contain `MarginGuard` or `TikTok Seller Tool` (`src/lib/distName.test.ts`)
- Release gates for the store zip, real pages, and a nonprod Stripe purchase: `qa/TEST_PLAN.md`
- Mock TikTok DOM scraping (`src/content/scraper/parseProductPage.test.ts`)

## 2. In-extension self-test (no TikTok login)

1. Load `dist` in Chrome (`chrome://extensions` → Load unpacked).
2. Open the Seller Center overlay → **Settings**.
3. Click **Run self-test**.
4. Expect the self-test to pass (green).

This uses the same mock HTML as unit tests; it does not hit the network.

## 3. Manual mock page (overlay UX)

Simulates Seller Center in your browser.

```powershell
npm run mock:page
```

Opens static server at `http://127.0.0.1:8765/mock-tiktok-product-page.html`.

**One-time:** In `chrome://extensions`, enable **Allow access to file URLs** is not needed; use the localhost URL above. The dev manifest includes `http://127.0.0.1:8765/*` for content scripts.

1. Reload extension after `npm run build`.
2. Open the mock URL in a tab.
3. Confirm profit overlay bottom-right, title + $29.99, no error banner.
4. Change **Retail price** → overlay should update within ~1s.

## 4. Manual on real TikTok Seller Center

Checklist:

- [ ] Logged into Seller Center, **add product** flow.
- [ ] Overlay on; product name appears under “Profit snapshot”.
- [ ] Before price: partial banner (not generic failure).
- [ ] After **Retail price** filled: gross/net update, banner gone.
- [ ] **Edit costs** → COGS/ship/ads → net recalculates.
- [ ] **Save to SKU** → overlay **Products** tab lists the item.
- [ ] Toggle overlay off in Settings → overlay disappears on refresh.
- [ ] On a non-seller tab the overlay is not injected.

## 5. Pre-submit gate

Do not publish until:

1. `npm test` — all green  
2. Overlay self-test — 4/4 (hidden on store builds)  
3. Mock page overlay sync  
4. One full pass on real product editor (your shop)

Optional: remove `http://127.0.0.1:8765/*` from `manifest.json` before store upload if you want zero localhost permissions (self-test + unit tests still work).

## 6. Auth, billing, errors (Phase 1 launch)

- [ ] Google / Facebook / TikTok buttons open provider login, then the overlay shows the signed-in email (not a 501 JSON page)
- [ ] New user sees 3-step splash (not Settings) → Create account
- [ ] Wrong password shows an error (not a silent fail)
- [ ] Forgot password stub returns a generic success message
- [ ] Header shows email/initials after refresh
- [ ] Log out from header or Settings, then log in as a different user
- [ ] Free user: costs on 5 products (knob: `src/tiers.json` free.skuLimit), warning at 3, the 6th cost is blocked with the upgrade prompt; price-only rows never block
- [ ] Overlay headline is **per sale**, with lifetime totals on a smaller line.
- [ ] Creator commission appears in the waterfall.
- [ ] Enter COGS in the overlay; "Saved ✓" and the default-cost chip goes away.
- [ ] Price below break-even turns the header red.
- [ ] Upgrade opens Stripe Checkout (or a checkout error, never a blank tab)
- [ ] **LLE:** `4242…` test card → `/billing/done` → overlay shows Pro within 60 seconds (webhook, not a fake grant)
- [ ] Stop the backend → overlay shows “Connection lost. Check your internet.”
- [ ] Scraper timeout on a non-product page → “Couldn't read page. Try refresh.”

