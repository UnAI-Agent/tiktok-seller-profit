import { computeProfit, maxSafeCommissionPct } from "./profit";
import { profitInputFor } from "./skuEconomics";
import { absMoney, findSkuForStatementId, parseMoneyCell } from "./statementImport";
import type { Settings } from "../types/settings";
import type { SkuRecord } from "../types/sku";

/**
 * Profit per creator from TikTok's affiliate orders export.
 *
 * Each creator's sales are priced with the same economics as the rest of the
 * app (profitInputFor): your saved product cost, TikTok fees, refunds and the
 * refund admin fee, but with that creator's actual commission rate on 100% of
 * the rows. Your ad spend is left out, because a creator's video is not your ad.
 * Everything stays in the browser.
 */

export type CreatorField = "creator" | "sku" | "revenue" | "commission" | "commissionRate" | "quantity" | "status";
export type CreatorMapping = Partial<Record<CreatorField, string>>;

export const CREATOR_FIELD_LABELS: Array<[CreatorField, string]> = [
  ["creator", "Creator"],
  ["sku", "SKU / product id"],
  ["revenue", "Sale amount (GMV)"],
  ["commission", "Commission paid"],
  ["commissionRate", "Commission rate"],
  ["quantity", "Quantity"],
  ["status", "Order status"],
];

const MATCHERS: Array<[CreatorField, (header: string) => boolean]> = [
  ["commissionRate", (h) => h.includes("commission") && (h.includes("rate") || h.includes("%"))],
  ["commission", (h) => h.includes("commission") && !h.includes("rate") && !h.includes("%") && !h.includes("base")],
  ["creator", (h) => /creator|influencer|affiliate (name|user)|username|handle/.test(h) && !h.includes("commission") && !h.includes("id")],
  ["sku", (h) => /\bsku\b|sku id|product id|product_id|item id/.test(h)],
  ["revenue", (h) => /payment amount|\bgmv\b|order amount|revenue|sales amount|settlement amount|item price|price/.test(h) && !h.includes("commission")],
  ["quantity", (h) => /quantity|\bqty\b|units|item count/.test(h)],
  ["status", (h) => /status/.test(h)],
];

export function suggestCreatorMapping(headers: string[]): CreatorMapping {
  const mapping: CreatorMapping = {};
  const used = new Set<string>();
  for (const [field, match] of MATCHERS) {
    const hit = headers.find((header) => !used.has(header) && match(header.trim().toLowerCase()));
    if (hit) {
      mapping[field] = hit;
      used.add(hit);
    }
  }
  return mapping;
}

export type CreatorSkuLine = { skuId: string; units: number; revenue: number; commission: number };

export type CreatorAggregate = {
  creator: string;
  orders: number;
  /** Rows marked canceled or refunded. Left out of sales and profit. */
  refunded: number;
  lines: CreatorSkuLine[];
  /** Sales whose product is not in MarginMark yet. */
  unmatched: { units: number; revenue: number; commission: number };
};

export type CreatorStore = {
  importedAt: string;
  rows: number;
  creators: CreatorAggregate[];
};

const REFUND_STATUS = /cancel|refund|return|failed|invalid/i;

export function normalizeCreator(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  return text.startsWith("@") ? text : `@${text}`;
}

/** Group affiliate order rows by creator and product. Unknown products are kept as "unmatched". */
export function aggregateCreatorOrders(
  rows: Array<Record<string, unknown>>,
  mapping: CreatorMapping,
  skus: ReadonlyArray<{ skuId: string; skuIds?: string[] }>,
  now: Date = new Date(),
): CreatorStore {
  const byCreator = new Map<string, CreatorAggregate & { byId: Map<string, CreatorSkuLine> }>();
  let used = 0;
  for (const row of rows) {
    const creator = normalizeCreator(mapping.creator ? row[mapping.creator] : "");
    if (!creator) continue;
    const entry =
      byCreator.get(creator) ??
      { creator, orders: 0, refunded: 0, lines: [], unmatched: { units: 0, revenue: 0, commission: 0 }, byId: new Map() };
    byCreator.set(creator, entry);
    used += 1;
    if (mapping.status && REFUND_STATUS.test(String(row[mapping.status] ?? ""))) {
      entry.refunded += 1;
      continue;
    }
    entry.orders += 1;
    const revenue = mapping.revenue ? absMoney(row[mapping.revenue]) : 0;
    const quantity = mapping.quantity ? Math.max(1, Math.round(parseMoneyCell(row[mapping.quantity]))) : 1;
    let commission = mapping.commission ? absMoney(row[mapping.commission]) : 0;
    if (!commission && mapping.commissionRate) {
      const rate = absMoney(row[mapping.commissionRate]);
      commission = revenue * (rate > 1 ? rate / 100 : rate);
    }
    const rawId = mapping.sku ? String(row[mapping.sku] ?? "").trim() : "";
    const sku = rawId ? findSkuForStatementId(skus, rawId) : undefined;
    if (!sku) {
      entry.unmatched.units += quantity;
      entry.unmatched.revenue += revenue;
      entry.unmatched.commission += commission;
      continue;
    }
    const line = entry.byId.get(sku.skuId) ?? { skuId: sku.skuId, units: 0, revenue: 0, commission: 0 };
    line.units += quantity;
    line.revenue += revenue;
    line.commission += commission;
    entry.byId.set(sku.skuId, line);
  }
  const creators = [...byCreator.values()].map(({ byId, ...rest }) => ({ ...rest, lines: [...byId.values()] }));
  return { importedAt: now.toISOString(), rows: used, creators };
}

export type CreatorVerdict = "losing" | "renegotiate" | "keep" | "add-costs";

export type CreatorResult = {
  creator: string;
  orders: number;
  refunded: number;
  units: number;
  revenue: number;
  commission: number;
  /** Commission as a percent of this creator's sales. */
  commissionPct: number;
  /** Net profit on the sales with a known product cost. Null when none have one. */
  net: number | null;
  marginPct: number | null;
  /** Highest commission (percent) that still breaks even / hits the margin goal. */
  maxCommissionBreakEvenPct: number | null;
  maxCommissionTargetPct: number | null;
  /** Sales that could not be priced: unknown product or no saved cost. */
  unpricedRevenue: number;
  verdict: CreatorVerdict;
  label: string;
};

function weighted(values: Array<{ value: number | null; weight: number }>): number | null {
  let sum = 0;
  let weight = 0;
  for (const item of values) {
    if (item.value == null || !Number.isFinite(item.value) || item.weight <= 0) continue;
    sum += item.value * item.weight;
    weight += item.weight;
  }
  return weight > 0 ? sum / weight : null;
}

export function creatorResults(store: CreatorStore | null, skus: SkuRecord[], settings: Settings): CreatorResult[] {
  if (!store) return [];
  const byId = new Map(skus.map((sku) => [sku.skuId, sku]));
  const out: CreatorResult[] = [];
  for (const creator of store.creators) {
    let revenue = creator.unmatched.revenue;
    let commission = creator.unmatched.commission;
    let units = creator.unmatched.units;
    let unpricedRevenue = creator.unmatched.revenue;
    let net = 0;
    let pricedRevenue = 0;
    const caps: Array<{ value: number | null; weight: number }> = [];
    const targets: Array<{ value: number | null; weight: number }> = [];
    for (const line of creator.lines) {
      revenue += line.revenue;
      commission += line.commission;
      units += line.units;
      const sku = byId.get(line.skuId);
      const hasCost = sku && (sku.costSource ?? "default") !== "default" && sku.cogsPerUnit > 0;
      if (!sku || !hasCost || line.units <= 0 || line.revenue <= 0) {
        unpricedRevenue += line.revenue;
        continue;
      }
      const price = line.revenue / line.units;
      const input = profitInputFor(sku, settings, {
        listPrice: price,
        unitsSold: line.units,
        adsPerUnit: 0,
        affiliatePct: (line.commission / line.revenue) * 100,
        affiliateSharePct: 100,
      });
      const result = computeProfit({ ...input, orderCount: line.units, samplesSent: 0 });
      net += result.netProfit;
      pricedRevenue += line.revenue;
      const safe = maxSafeCommissionPct(input, settings.targetMarginPct);
      caps.push({ value: safe.breakEven, weight: line.revenue });
      targets.push({ value: safe.atTarget, weight: line.revenue });
    }
    const priced = pricedRevenue > 0;
    const marginPct = priced ? (net / pricedRevenue) * 100 : null;
    const commissionPct = revenue > 0 ? (commission / revenue) * 100 : 0;
    const maxBreakEven = weighted(caps);
    const maxTarget = weighted(targets);
    let verdict: CreatorVerdict;
    let label: string;
    if (!priced) {
      verdict = "add-costs";
      label = "Add product costs to see profit";
    } else if (net <= 0) {
      verdict = "losing";
      label =
        maxBreakEven != null && maxBreakEven > 0
          ? `Losing money. Cap commission at ${Math.max(0, maxBreakEven).toFixed(1)}% or stop`
          : "Losing money even at 0% commission. Stop or raise price";
    } else if (marginPct != null && marginPct < settings.targetMarginPct) {
      verdict = "renegotiate";
      label =
        maxTarget != null && maxTarget > 0
          ? `Below your ${settings.targetMarginPct}% goal. Offer ≤${maxTarget.toFixed(1)}%`
          : `Below your ${settings.targetMarginPct}% goal`;
    } else {
      verdict = "keep";
      label = "Profitable. Ask for more videos";
    }
    out.push({
      creator: creator.creator,
      orders: creator.orders,
      refunded: creator.refunded,
      units,
      revenue,
      commission,
      commissionPct,
      net: priced ? net : null,
      marginPct,
      maxCommissionBreakEvenPct: maxBreakEven,
      maxCommissionTargetPct: maxTarget,
      unpricedRevenue,
      verdict,
      label,
    });
  }
  const rank: Record<CreatorVerdict, number> = { losing: 0, renegotiate: 1, keep: 2, "add-costs": 3 };
  return out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || (a.net ?? 0) - (b.net ?? 0));
}

export function creatorSummary(results: CreatorResult[]): { creators: number; losing: number; lost: number; commission: number } {
  let losing = 0;
  let lost = 0;
  let commission = 0;
  for (const row of results) {
    commission += row.commission;
    if (row.verdict === "losing") {
      losing += 1;
      lost += Math.abs(row.net ?? 0);
    }
  }
  return { creators: results.length, losing, lost, commission };
}
