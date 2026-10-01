# Chrome Web Store listing: MarginMark

Paste these into the Developer Dashboard. Every claim below is something the
extension does today and a test checks (IDs in brackets are for you, not the
listing).

## Name (max 75)

MarginMark — Profit Calculator for TikTok Shop Sellers

## Summary (max 132, same as manifest.json "description")

See which TikTok Shop products and creators lose you money, and the exact fix. Real fees, break-even prices, SPS alerts.

## Category

Tools (alternative: Shopping)

## Description

Most TikTok Shop sellers find out a product lost money weeks after the payout. MarginMark shows it on the product page in Seller Center, before you run the promo.

WHAT YOU SEE
• Your real profit per sale on every product page: TikTok's referral fee, payment fee, creator commission, ads, packaging, shipping and refunds, already subtracted. [E-LAB-NUMBERS]
• A verdict, not just a number: "Promo price is below break-even ($22.23)", "Cut ads to ≤$18.33/order", "Cut commission to ≤2.8%". [E-LAB-NUMBERS]
• Every product sorted into Losing, Thin, Healthy and No cost, with the dollars you've already lost on the losing ones. [E-LAB-BUCKETS-BEFORE]
• Profit per creator from your affiliate order export: who makes you money, who to renegotiate and to what rate, who to stop working with. [E-CREATORS-PRO]
• Shop Performance Score alerts: open Account Health and MarginMark remembers your score, then warns you on every page when you're close to losing affiliate access, campaigns or Flash Deals. [E-SPS-READ, E-SPS-WARN]
• A weekly recap: which products started losing money this week and which ones you fixed. [E-RECAP]
• A red warning next to TikTok's own price field when a price or promo would sell at a loss. [E-FLAG-promoGuard]

FAST SETUP
• Open Manage products. Your listings import on their own.
• Paste costs for all your products at once from a spreadsheet (SKU and cost per line). [E-BULK-COST]
• Import your TikTok settlement statement (CSV or Excel) and MarginMark swaps its estimates for what TikTok actually charged you. [E-LAB-STATEMENT]

YOUR DATA STAYS ON YOUR COMPUTER
Costs, profit, statements, creator orders and your score are stored in Chrome on your computer. Nothing is uploaded. We never see your TikTok password or cookies.

PRICING
• Free: profit on every product page, costs on up to 5 products, creator totals, your score.
• Pro: $14.99/month or $120/year. 7-day free trial (one per person). Unlimited products, the exact fix for each losing product, profit and a verdict per creator, the weekly recap, real fees from your statement, what-if pricing and CSV export. Cancel anytime in Manage billing. Full refund within 7 days of your first charge.

MarginMark is made by Plainsman Software. It is not affiliated with or endorsed by TikTok. Profit figures are estimates until you import a statement; they are not financial or tax advice.

Support: support@plainsmansoftware.com

## Single purpose (Privacy practices tab)

Show TikTok Shop sellers their profit per product and per creator inside Seller Center, using the seller's own costs, so they can fix products and deals that lose money.

## Permission justifications

- storage: saves the seller's costs, products, settings, imported statements and creator orders on their computer.
- alarms: refreshes the signed feature config every 15 minutes, and checks for a completed upgrade every 30 seconds for 15 minutes after the seller opens checkout.
- scripting: shows the profit panel when the seller clicks the toolbar icon on a Seller Center tab that was open before install.
- Host access (Seller Center domains only): reads the product price, title and the Shop Performance Score shown to the seller, and draws the profit panel on those pages.

## Data usage disclosures

Collected and sent to our server: email address (account), subscription status (from Stripe), and anonymous usage event names with coarse counts. Not collected: costs, profit, statements, creator orders, product titles, page URLs, TikTok credentials. Not sold. Not used for credit or lending. Privacy policy: store/privacy.html (host it at plainsmansoftware.com/marginmark/privacy).

## Screenshots (1280×800)

Take these from the lab page (`npm run test:e2e` starts it) so no real shop data appears:
1. Product page: panel showing a losing product with its verdict and the red chip by the price field.
2. Overview: "Who is losing money" board plus the weekly recap.
3. Creators tab (Pro): the five lab creators with verdicts.
4. SPS strip at 3.2 ("One dip from losing creators").
5. Plan picker with $14.99 / $120 and the trial line.

## Before you submit

Run `npm run launch:check -- https://<your prod API host>` and fix every line it prints.
