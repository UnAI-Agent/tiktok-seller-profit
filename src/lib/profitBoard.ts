import { diagnoseSku } from "./diagnose";
import { computeProfit } from "./profit";
import { profitInputFor } from "./skuEconomics";
import type { Settings } from "../types/settings";
import type { SkuRecord } from "../types/sku";

export type BoardBucket = "losing" | "thin" | "healthy" | "missing";

export type BoardTile = {
  id: BoardBucket;
  label: string;
  count: number;
  periodProfit: number;
};

export type BoardWorst = {
  skuId: string;
  title: string;
  periodProfit: number;
  netPerUnit: number;
  verdict: string;
  unitsSold: number;
};

export type BoardMember = {
  skuId: string;
  title: string;
  listPrice: number;
  originalPrice: number | null;
  purchaseCost: number;
  fix: string;
  downside: string;
  listingStatus: string | null;
  stock: number | null;
};

const TILE_LABEL: Record<BoardBucket, string> = {
  losing: "Losing",
  thin: "Thin",
  healthy: "Healthy",
  missing: "Missing cost",
};

function bucketFor(
  status: ReturnType<typeof diagnoseSku>["status"],
  netPerUnit: number,
  netMarginPct: number | null,
  target: number,
): BoardBucket {
  if (status === "missing-cost") return "missing";
  if (netPerUnit <= 0) return "losing";
  if (netMarginPct != null && netMarginPct < target) return "thin";
  return "healthy";
}

function downsideFor(
  status: ReturnType<typeof diagnoseSku>["status"],
): string {
  switch (status) {
    case "missing-cost":
      return "Enter what you paid to buy one unit. Resellers use the wholesale or supplier price, before TikTok fees. A promo can already sit under that cost.";
    case "promo-below-breakeven":
      return "The earlier price covered more of the purchase cost. This promo loses money on every order.";
    case "cut-commission":
      return "A lower commission can stop the loss and can also mean fewer creators post it.";
    case "cut-ads":
      return "A lower ad cap protects the margin and can bring fewer orders.";
    case "raise-price":
      return "A higher price covers the purchase cost and TikTok fees. It can also slow sales.";
    case "stop-selling":
      return "Fees plus the purchase cost are above a realistic price. Pausing the listing stops the loss.";
    case "below-target":
      return "It still makes money. A higher price, lower commission, or lower ads can hit the goal, and each of those can cut volume.";
    default:
      return "Leave it unless a promo drops the buyer price under the purchase cost.";
  }
}

/** Counts, period dollars, and the worst products on the list-page overview. */
export function buildProfitBoard(skus: readonly SkuRecord[], settings: Settings): {
  tiles: BoardTile[];
  worst: BoardWorst[];
  members: Record<BoardBucket, BoardMember[]>;
} {
  const counts: Record<BoardBucket, { count: number; periodProfit: number }> = {
    losing: { count: 0, periodProfit: 0 },
    thin: { count: 0, periodProfit: 0 },
    healthy: { count: 0, periodProfit: 0 },
    missing: { count: 0, periodProfit: 0 },
  };
  const ranked: Array<BoardWorst & { score: number }> = [];
  const members: Record<BoardBucket, BoardMember[]> = {
    losing: [],
    thin: [],
    healthy: [],
    missing: [],
  };
  const anySales = skus.some((sku) => sku.unitsSold > 0);

  for (const sku of skus) {
    const diagnosis = diagnoseSku(sku, settings);
    const profit = computeProfit(profitInputFor(sku, settings));
    const bucket = bucketFor(
      diagnosis.status,
      profit.netPerUnit,
      profit.netMarginPct,
      settings.targetMarginPct,
    );
    const periodProfit =
      bucket === "missing" ? 0 : profit.netPerUnit * Math.max(0, sku.unitsSold);
    counts[bucket].count += 1;
    counts[bucket].periodProfit += periodProfit;
    members[bucket].push({
      skuId: sku.skuId,
      title: sku.title,
      listPrice: sku.listPrice,
      originalPrice: sku.listPriceOriginal ?? null,
      purchaseCost: sku.cogsPerUnit,
      fix: diagnosis.label,
      downside: downsideFor(diagnosis.status),
      listingStatus: sku.listingStatus ?? null,
      stock: sku.stock ?? null,
    });
    if (bucket === "missing") continue;
    ranked.push({
      skuId: sku.skuId,
      title: sku.title,
      periodProfit,
      netPerUnit: profit.netPerUnit,
      verdict: diagnosis.label,
      unitsSold: sku.unitsSold,
      score: anySales ? periodProfit : profit.netPerUnit,
    });
  }

  ranked.sort((a, b) => a.score - b.score);
  const tiles = (Object.keys(TILE_LABEL) as BoardBucket[]).map((id) => ({
    id,
    label: TILE_LABEL[id],
    count: counts[id].count,
    periodProfit: counts[id].periodProfit,
  }));
  return {
    tiles,
    worst: ranked.map((row) => ({
      skuId: row.skuId,
      title: row.title,
      periodProfit: row.periodProfit,
      netPerUnit: row.netPerUnit,
      verdict: row.verdict,
      unitsSold: row.unitsSold,
    })),
    members,
  };
}
