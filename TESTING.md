# Testing before Chrome Web Store release

Three layers: **automated**, **in-extension self-test**, **manual** (mock page + real Seller Center).

## 1. Automated (run before every build)

```powershell
npm test
npm run build
```

Covers:

- Profit formulas (`src/lib/profit.test.ts`)
- Mock TikTok DOM scraping (`src/content/scraper/parseProductPage.test.ts`)

## 2. In-extension self-test (no TikTok login)

1. Load `dist` in Chrome (`chrome://extensions` → Load unpacked).
2. Open the extension popup → **Settings**.
3. Click **Run self-test**.
4. Expect **4/4 passed** (green).

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
- [ ] **Save to SKU** → popup **SKUs** tab lists item.
- [ ] Toggle overlay off in Settings → overlay disappears on refresh.
- [ ] Popup on non-seller tab shows “Open Seller Center” message.

## 5. Pre-submit gate

Do not publish until:

1. `npm test` — all green  
2. Popup self-test — 4/4  
3. Mock page overlay sync  
4. One full pass on real product editor (your shop)

Optional: remove `http://127.0.0.1:8765/*` from `manifest.json` before store upload if you want zero localhost permissions (self-test + unit tests still work).

## 6. Auth, billing, errors (Phase 1 launch)

- [ ] New user sees 3-step splash (not Settings) → Create account
- [ ] Wrong password shows an error (not a silent fail)
- [ ] Forgot password stub returns a generic success message
- [ ] Header shows email/initials after refresh
- [ ] Log out from header or Settings, then log in as a different user
- [ ] Free user: 10 SKUs stored, warning at 8, 11th blocked
- [ ] Creators tab shows Pro-only badge + Upgrade to Pro
- [ ] Upgrade opens Stripe Checkout (or a checkout error, never a blank tab)
- [ ] Stop the backend → popup shows “Connection lost. Check your internet.”
- [ ] Scraper timeout on a non-product page → “Couldn't read page. Try refresh.”

