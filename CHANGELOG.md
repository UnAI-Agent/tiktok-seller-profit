# Changelog

## 1.4.0

**Fixes**
- Pro accounts no longer show "Upgrade". Two causes: the API read a manually granted or older "active" subscription row as Free, and the Seller Center overlay could not read the login token and forced the plan to Free.
- API errors now reach the screen ("Verify your email to start your trial", "Current password is wrong") instead of "Request failed (403)".
- Statement import works inside the overlay (it saved its column mapping to storage the page cannot use).
- Sign-in buttons show only the providers the API has set up (TikTok stays hidden until it is configured). Enter now submits the login form.
- Changing a password signs out other devices and keeps this one signed in.
- Changing an email address requires verifying the new address before checkout.

**New**
- Profit is green or red everywhere: hero number with +/- sign, product cards with colored side bars, colored Losing / Thin / Healthy filters, and a "Where the money goes" breakdown.
- Free vs Pro: Free keeps live profit, break-even price, the loss warning, and costs on 5 products. Pro adds max creator commission, ad limits, fix advice, statement import, what-if, and CSV export. Locked cards show a blurred preview and one clear button.
- Plan screen with Free vs Pro comparison, yearly/monthly toggle, and auto-renewal disclosure. Pro unlocks in the open panel as soon as checkout finishes.
- New Account screen (plan, profile, verify email, password with strength meter, sign out everywhere, promo, delete) and Help & support center (bug, question, billing, feature).
- Branded password-reset, checkout-done, and sign-in-done web pages.
- Getting-started checklist, inline first-cost entry, and a single free-limit setting in `tiers.json`.

## 1.3.0

- Password reset emails, email verification before trial checkout, and Stripe sync that uses the stored customer only.
- Free tier stores unlimited price-only products and costs on 10 products.
- Edit-page discounts count toward the sale price.

## 1.2.0

- Overlay reads the edit-page retail price and the list promo price, and waits for a product cost before showing profit.
- Page API calls go through the service worker. Account delete, trial rules, and webhook billing state are on the API.

## 1.0.0

- US fee presets are 6% standard, 5% jewelry, and legacy 8% + 2.9% + $0.30. Only untouched 8% defaults migrate.
- Remote signed config, kill switches, and selector fallbacks. New features stay off until a signed config enables them.
- Product-check math, local review flags, and a manual card. Buyer-page parsing waits on HTML fixtures.
- Pro/Diamond tiers, anonymous trends, shared review insights, admin API, Command Center shell, and Grafana views.
