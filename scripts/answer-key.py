"""Independent answer key for the lab products.

This script re-implements the documented MarginMark money rules from scratch in
plain Python. It never imports or calls src/lib/profit.ts, so a bug in the app's
engine shows up as a mismatch in the unit and E2E tests instead of being copied
into the expected values.

Rules (per unit, price P, defaults from src/types/settings.ts):
  referral fee        = platformFeePct% x P        (US standard 6%)
  payment fee         = paymentFeePct% x P + paymentFixed
  refunds             = refundRatePct% x P         (revenue lost to refunds)
  sales tax           = salesTaxPct% x P
  creator commission  = affiliatePct% x P x affiliateSharePct%
  refund admin fee    = refundRatePct% x min(20% x referral fee, $5)
                        TikTok keeps 20% of the referral fee on a refunded SKU,
                        capped at $5. Added only for costs the seller typed in;
                        a settlement statement already reports actual charges.
  unrecovered label   = refundRatePct% x label cost, only when the buyer pays
                        shipping (the seller still paid for the label)
  net                 = P - every line above - COGS - seller shipping - packaging
                        - ads - samples
  margin              = net / P
  break-even price    = (fixed per-unit costs + ads) / (1 - percent costs)
                        with the admin fee counted at the current price, as the
                        app does

Usage:
  python scripts/answer-key.py            # rewrite test-fixtures/lab/expected.json
  python scripts/answer-key.py --check    # exit 1 if the file is out of date
"""

from __future__ import annotations

import csv
import json
import sys
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / "test-fixtures" / "lab"

DEFAULTS = {
    "platformFeePct": 6.0,
    "paymentFeePct": 0.0,
    "paymentFixed": 0.0,
    "refundRatePct": 3.0,
    "salesTaxPct": 0.0,
    "affiliateCommissionPct": 10.0,
    "affiliateSharePct": 100.0,
    "targetMarginPct": 15.0,
    "shippingPassedToBuyer": True,
    "packagingPerUnit": 0.0,
}

ADMIN_RATE = 0.20
ADMIN_CAP = 5.0

# Lab inputs. Prices and titles come from lab/product/manage/index.html; costs are
# the seller's typed values for each scenario.
PRODUCTS = [
    {"key": "A", "skuId": "1732672081725400001", "title": "Winner Ceramic Mug", "listPrice": 39.99, "listPriceOriginal": None, "cogsPerUnit": 8, "adsPerUnit": 3, "packagingPerUnit": 0, "affiliatePct": None},
    {"key": "B", "skuId": "1732672081725400002", "title": "Promo Candle Set", "listPrice": 19.99, "listPriceOriginal": 29.99, "cogsPerUnit": 14, "adsPerUnit": 4, "packagingPerUnit": 0, "affiliatePct": None},
    {"key": "C", "skuId": "1732672081725400003", "title": "Creator Commission Tee", "listPrice": 19.99, "listPriceOriginal": None, "cogsPerUnit": 9, "adsPerUnit": 0, "packagingPerUnit": 0, "affiliatePct": 40},
    {"key": "D", "skuId": "1732672081725400004", "title": "Ads Heavy Blender", "listPrice": 34.99, "listPriceOriginal": None, "cogsPerUnit": 10, "adsPerUnit": 22, "packagingPerUnit": 0, "affiliatePct": None},
    {"key": "E", "skuId": "1732672081725400005", "title": "Cheap Impulse Keychain", "listPrice": 4.99, "listPriceOriginal": None, "cogsPerUnit": 3.2, "adsPerUnit": 0, "packagingPerUnit": 1.2, "affiliatePct": None},
    {"key": "F", "skuId": "1732672081725400006", "title": "Thin Margin Notebook", "listPrice": 14.99, "listPriceOriginal": None, "cogsPerUnit": 10.5, "adsPerUnit": 0, "packagingPerUnit": 0, "affiliatePct": None},
    {"key": "G", "skuId": "1732672081725400007", "title": "No Cost Entered Lamp", "listPrice": 59.99, "listPriceOriginal": None, "cogsPerUnit": 0, "adsPerUnit": 0, "packagingPerUnit": 0, "affiliatePct": None},
    {"key": "H", "skuId": "1732672081725400008", "title": "Premium Wool Coat", "listPrice": 249.99, "listPriceOriginal": None, "cogsPerUnit": 90, "adsPerUnit": 0, "packagingPerUnit": 0, "affiliatePct": None},
    {"key": "I", "skuId": "1732672081725400009", "title": "Statement Fee Bottle", "listPrice": 29.99, "listPriceOriginal": None, "cogsPerUnit": 12, "adsPerUnit": 0, "packagingPerUnit": 0, "affiliatePct": None},
    {"key": "J", "skuId": "1732672081725400010", "title": "Ailun Screen Protector Lab", "listPrice": 36, "listPriceOriginal": 45, "cogsPerUnit": 15, "adsPerUnit": 0, "packagingPerUnit": 0, "affiliatePct": None},
]


def money(value: float) -> float:
    """Cents, half away from zero on the exact binary value (Intl.NumberFormat)."""
    return float(Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def one_decimal(value: float) -> float:
    return float(Decimal(value).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def usd(value: float) -> str:
    amount = Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    sign = "-" if amount < 0 else ""
    return f"{sign}${abs(amount):,.2f}"


def pct_label(value: float) -> str:
    return f"{Decimal(value).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)}%"


def economics(p: dict) -> dict:
    """Per-unit money for one product. p carries every rate explicitly."""
    price = p["price"]
    pf, pay, refund, tax = p["platformFeePct"], p["paymentFeePct"], p["refundRatePct"], p["salesTaxPct"]
    commission = p["affiliatePct"] / 100.0
    share = p["affiliateSharePct"] / 100.0
    percent_costs = (pf + pay + refund + tax) / 100.0
    admin = 0.0
    unrecovered = 0.0
    if p["adminFee"]:
        admin = (refund / 100.0) * min(ADMIN_RATE * price * pf / 100.0, ADMIN_CAP)
        unrecovered = (refund / 100.0) * p["unrecoveredLabel"]
    fixed = p["cogs"] + p["shipping"] + p["packaging"] + p["paymentFixed"] + admin + unrecovered
    ads = p["ads"]
    contribution = price * (1 - percent_costs) - fixed
    net = contribution - price * commission * share - ads
    denom = 1 - percent_costs - commission * share
    return {
        "price": price,
        "net": net,
        "margin": (net / price) * 100 if price > 0 else None,
        "breakEven": (fixed + ads) / denom if denom > 0 else None,
        "contribution": contribution,
        "commission": commission,
        "share": share,
        "ads": ads,
        "admin": admin,
    }


def verdict(p: dict, has_cost: bool, original: float | None, target: float) -> str:
    if not has_cost:
        return "Missing cost"
    e = economics(p)
    if e["net"] <= 0:
        be = e["breakEven"]
        if original is not None and original > p["price"] and be is not None and p["price"] < be and original >= be:
            return f"Promo price is below break-even ({usd(be)})"
        no_commission = economics({**p, "affiliatePct": 0.0, "affiliateSharePct": 0.0})
        if no_commission["net"] > 0:
            cap = (e["contribution"] - e["ads"]) / e["price"] * 100
            return f"Cut commission to ≤{pct_label(max(0.0, cap))}"
        no_ads = economics({**p, "ads": 0.0})
        if no_ads["net"] > 0:
            cap = e["contribution"] - e["price"] * e["commission"] * e["share"]
            return f"Cut ads to ≤{usd(max(0.0, cap))}/order"
        if be is None or p["price"] <= 0 or be > p["price"] * 2:
            return "Stop selling"
        return f"Raise price to ≥{usd(be)}"
    if e["margin"] is not None and e["margin"] < target:
        return "Below target"
    return "Healthy"


def bucket(p: dict, has_cost: bool, target: float) -> str:
    if not has_cost:
        return "missing"
    e = economics(p)
    if e["net"] <= 0:
        return "losing"
    if e["margin"] is not None and e["margin"] < target:
        return "thin"
    return "healthy"


def typed_inputs(product: dict) -> dict:
    s = DEFAULTS
    label = 0.0
    return {
        "price": float(product["listPrice"]),
        "cogs": float(product["cogsPerUnit"]),
        "shipping": 0.0 if s["shippingPassedToBuyer"] else label,
        "unrecoveredLabel": label if s["shippingPassedToBuyer"] else 0.0,
        "packaging": float(product["packagingPerUnit"] or s["packagingPerUnit"]),
        "ads": float(product["adsPerUnit"]),
        "platformFeePct": s["platformFeePct"],
        "paymentFeePct": s["paymentFeePct"],
        "paymentFixed": s["paymentFixed"],
        "refundRatePct": s["refundRatePct"],
        "salesTaxPct": s["salesTaxPct"],
        "affiliatePct": float(product["affiliatePct"] if product["affiliatePct"] is not None else s["affiliateCommissionPct"]),
        "affiliateSharePct": s["affiliateSharePct"],
        "adminFee": True,
    }


def statement_rates() -> dict:
    """Per-SKU rates from lab/statement.csv. TikTok exports fees as negatives; the rate is the size."""
    totals: dict[str, dict] = {}
    with (LAB / "statement.csv").open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            sku = row["SKU"].strip()
            amount = float(row["Order amount"])
            affiliate = abs(float(row["Affiliate commission"]))
            t = totals.setdefault(sku, {"orders": 0, "amount": 0.0, "referral": 0.0, "affiliate": 0.0, "aff_orders": 0, "aff_revenue": 0.0, "shipping": 0.0, "refund": 0.0})
            t["orders"] += 1
            t["amount"] += amount
            t["referral"] += abs(float(row["Referral fee"]))
            t["affiliate"] += affiliate
            if affiliate > 0:
                t["aff_orders"] += 1
                t["aff_revenue"] += amount
            t["shipping"] += abs(float(row["Shipping subsidy"]))
            t["refund"] += abs(float(row["Refund amount"]))
    out = {}
    for sku, t in totals.items():
        out[sku] = {
            "orders": t["orders"],
            "platformFeePct": t["referral"] / t["amount"] * 100 if t["amount"] > 0 else 0.0,
            "affiliatePct": t["affiliate"] / t["aff_revenue"] * 100 if t["aff_revenue"] > 0 else 0.0,
            "affiliateSharePct": t["aff_orders"] / t["orders"] * 100 if t["orders"] > 0 else 0.0,
            "refundRatePct": t["refund"] / t["amount"] * 100 if t["amount"] > 0 else 0.0,
            "shippingPerUnit": t["shipping"] / t["orders"] if t["orders"] > 0 else 0.0,
        }
    return out


def settled_inputs(product: dict, rates: dict) -> dict:
    base = typed_inputs(product)
    return {
        **base,
        "shipping": rates["shippingPerUnit"],
        "unrecoveredLabel": 0.0,
        "platformFeePct": rates["platformFeePct"],
        "paymentFeePct": 0.0,
        "paymentFixed": 0.0,
        "refundRatePct": rates["refundRatePct"],
        "affiliatePct": rates["affiliatePct"],
        "affiliateSharePct": rates["affiliateSharePct"],
        "adminFee": False,
    }


def creator_key(target: float) -> list:
    """Profit per creator from lab/affiliate-orders.csv, using each creator's actual
    commission on 100% of their rows, typed product costs, and no ad spend."""
    by_sku = {p["skuId"]: p for p in PRODUCTS}
    creators: dict[str, dict] = {}
    with (LAB / "affiliate-orders.csv").open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            name = row["Creator Username"].strip()
            name = name if name.startswith("@") else f"@{name}"
            c = creators.setdefault(name, {"orders": 0, "refunded": 0, "lines": {}, "unmatched": [0.0, 0.0]})
            if any(word in row["Order Status"].lower() for word in ("cancel", "refund", "return", "failed", "invalid")):
                c["refunded"] += 1
                continue
            c["orders"] += 1
            revenue = abs(float(row["Payment Amount"]))
            commission = abs(float(row["Est. Commission"]))
            qty = max(1, round(float(row["Quantity"])))
            sku = row["SKU ID"].strip()
            if sku not in by_sku:
                c["unmatched"][0] += revenue
                c["unmatched"][1] += commission
                continue
            line = c["lines"].setdefault(sku, {"units": 0, "revenue": 0.0, "commission": 0.0})
            line["units"] += qty
            line["revenue"] += revenue
            line["commission"] += commission
    out = []
    for name, c in creators.items():
        net = 0.0
        priced = 0.0
        revenue = c["unmatched"][0]
        commission = c["unmatched"][1]
        caps = []
        targets = []
        for sku, line in c["lines"].items():
            revenue += line["revenue"]
            commission += line["commission"]
            product = by_sku[sku]
            if product["cogsPerUnit"] <= 0:
                continue
            price = line["revenue"] / line["units"]
            p = {**typed_inputs(product), "price": price, "ads": 0.0,
                 "affiliatePct": line["commission"] / line["revenue"] * 100, "affiliateSharePct": 100.0}
            e = economics(p)
            net += e["net"] * line["units"]
            priced += line["revenue"]
            caps.append(((e["contribution"] - e["ads"]) / price * 100, line["revenue"]))
            targets.append(((e["contribution"] - e["ads"] - target / 100 * price) / price * 100, line["revenue"]))
        def weighted(values):
            total = sum(w for _, w in values)
            return sum(v * w for v, w in values) / total if total > 0 else None
        cap, goal = weighted(caps), weighted(targets)
        margin = net / priced * 100 if priced > 0 else None
        if priced <= 0:
            verdict, label = "add-costs", "Add product costs to see profit"
        elif net <= 0:
            verdict = "losing"
            label = (f"Losing money. Cap commission at {Decimal(max(0.0, cap)).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)}% or stop"
                     if cap is not None and cap > 0 else "Losing money even at 0% commission. Stop or raise price")
        elif margin is not None and margin < target:
            verdict = "renegotiate"
            label = (f"Below your {int(target)}% goal. Offer \u2264{Decimal(goal).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)}%"
                     if goal is not None and goal > 0 else f"Below your {int(target)}% goal")
        else:
            verdict, label = "keep", "Profitable. Ask for more videos"
        out.append({
            "creator": name,
            "orders": c["orders"],
            "refunded": c["refunded"],
            "revenue": money(revenue),
            "commission": money(commission),
            "net": money(net) if priced > 0 else None,
            "margin": one_decimal(margin) if margin is not None else None,
            "verdict": verdict,
            "label": label,
        })
    rank = {"losing": 0, "renegotiate": 1, "keep": 2, "add-costs": 3}
    return sorted(out, key=lambda r: (rank[r["verdict"]], r["net"] if r["net"] is not None else 0))


def build() -> dict:
    target = DEFAULTS["targetMarginPct"]
    rates = statement_rates()
    products = []
    before = {"losing": [], "thin": [], "healthy": [], "missing": []}
    after = {"losing": [], "thin": [], "healthy": [], "missing": []}
    for product in PRODUCTS:
        has_cost = product["cogsPerUnit"] > 0
        typed = typed_inputs(product)
        e = economics(typed)
        row = {
            "key": product["key"],
            "skuId": product["skuId"],
            "title": product["title"],
            "listPrice": product["listPrice"],
            "listPriceOriginal": product["listPriceOriginal"],
            "cogsPerUnit": product["cogsPerUnit"],
            "adsPerUnit": product["adsPerUnit"],
            "packagingPerUnit": product["packagingPerUnit"],
            "affiliatePct": product["affiliatePct"],
            "net": money(e["net"]) if has_cost else None,
            "margin": one_decimal(e["margin"]) if has_cost else None,
            "verdict": verdict(typed, has_cost, product["listPriceOriginal"], target),
            "refundAdminFee": money(e["admin"]),
        }
        if not has_cost:
            row["hiddenProfit"] = money(e["net"])
        before[bucket(typed, has_cost, target)].append(product["key"])
        settled = settled_inputs(product, rates[product["skuId"]])
        s = economics(settled)
        row["afterStatement"] = {
            "unitsSold": rates[product["skuId"]]["orders"],
            "net": money(s["net"]) if has_cost else None,
            "margin": one_decimal(s["margin"]) if has_cost else None,
            "verdict": verdict(settled, has_cost, product["listPriceOriginal"], target),
        }
        after[bucket(settled, has_cost, target)].append(product["key"])
        products.append(row)
    return {
        "url": "http://127.0.0.1:8765/lab/product/manage/",
        "generatedBy": "scripts/answer-key.py (independent of src/lib/profit.ts). Do not edit by hand.",
        "note": (
            "Default settings: 6% referral fee, 3% refunds, refund admin fee (20% of the referral fee, max $5) "
            "on typed costs, 10% creator commission on 100% of sales, 15% target. After statement.csv every costed "
            "product uses the statement's actual rates and no admin-fee estimate."
        ),
        "creators": creator_key(target),
        "overviewBeforeStatement": before,
        "overviewAfterStatement": after,
        "products": products,
    }


def main() -> int:
    data = build()
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    target = LAB / "expected.json"
    if "--check" in sys.argv:
        current = target.read_text(encoding="utf-8") if target.exists() else ""
        if current != text:
            print("test-fixtures/lab/expected.json is out of date. Run: python scripts/answer-key.py")
            return 1
        print("answer key up to date")
        return 0
    target.write_text(text, encoding="utf-8")
    print(f"wrote {target.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
