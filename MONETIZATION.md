# Monetization, tax model, and support

MarginMark by Plainsman Software. Support: `support@plainsmansoftware.com`. Privacy: `https://plainsmansoftware.com/marginmark/privacy`. Terms: `https://plainsmansoftware.com/marginmark/terms`.

## Profit & tax (extension-side)

Net profit is **estimated**, not tax advice. Creator commission is `price × commission % × creator share %`. Break-even is `(fixed costs + ads) / (1 − variable rate)`.

| Line | Meaning |
|------|---------|
| **You keep / sale** | Blended net after fees, COGS, shipping, packaging, ads, refunds, and creator commission |
| **Creator commission** | Commission % on the share of sales that go through creators |
| **Platform / payment** | Fee preset. Payment is $0 unless a statement shows a separate processing line |
| **COGS** | Per product when entered, otherwise the Settings default |

Formula lives in `src/lib/profit.ts` → `computeProfit()`.

## Free, Pro, and Diamond

| | Free | Pro ($14.99/mo or $120/yr) | Diamond ($39/mo or $349/yr) |
|---|------|----------------|-----|
| Per-unit overlay, commission included | Yes | Yes | Yes |
| Product checks | 5/day | Unlimited | Unlimited |
| Products with your own COGS | 5 | Unlimited | Unlimited |
| AI review insight | Blurred teaser | 300/month | 1,000/month |
| Trending | Top 3 teaser | Top 10 | Full list, risers, competition |

Diamond checkout stays off until `diamondEnabled` is turned on in signed remote config. Pro has a 7-day trial. Founder coupons are Stripe coupons with `max_redemptions`.

**Pricing:** display prices are in `src/tiers.json`. Stripe Price IDs stay in backend secrets.

**Source of truth:** backend SQLite `subscriptions` table per `user_id` + `service=tiktok-seller-tool`.

Extension caches tier in `chrome.storage.local.subscription` after sign-in (`/auth/me`).

## Upgrade flow

1. Deploy `backend/` with env `STRIPE_PRICE_TIKTOK_SELLER` (Stripe Price ID).
2. Set extension `VITE_API_BASE_URL` to your API (see `.env.example`).
3. User: Popup → **Settings** → **Account & plan** → sign in → **Upgrade to Pro**.
4. Stripe Checkout opens; webhook sets `subscriptions.status = active`.
5. User reopens popup; `is_pro` unlocks unlimited SKUs.

Manage/cancel: Settings opens the Stripe Customer Portal through `/billing/portal`.

## Support

Settings → Support opens a `mailto:` draft. Support message content does not pass through the MarginMark API.

Replace `SUPPORT_EMAIL` in `src/config.ts` with your real address.
