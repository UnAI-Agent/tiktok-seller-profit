import { FREE_SKU_LIMIT } from "../config";

/** Warn free users before they hit the hard cap. */
export const FREE_SKU_WARN_AT = Math.max(1, FREE_SKU_LIMIT - 2);

/** `count` is products that already have a saved cost, not price-only rows. */
export function skuCountLabel(count: number, isPro: boolean): string {
  if (isPro) return `Unlimited products · ${count} with costs`;
  return `Costs saved: ${Math.min(count, FREE_SKU_LIMIT)}/${FREE_SKU_LIMIT} free`;
}

export function skuLimitWarning(count: number, isPro: boolean): string | null {
  if (isPro) return null;
  if (count >= FREE_SKU_LIMIT) {
    return `Costs saved: ${FREE_SKU_LIMIT}/${FREE_SKU_LIMIT} free. Upgrade to Pro to save costs on more products.`;
  }
  if (count >= FREE_SKU_WARN_AT) {
    return `Costs saved: ${count}/${FREE_SKU_LIMIT} free.`;
  }
  return null;
}

export function canAddSku(count: number, isPro: boolean, addingNewCost: boolean): boolean {
  if (isPro || !addingNewCost) return true;
  return count < FREE_SKU_LIMIT;
}

export function savedCostCount(
  rows: ReadonlyArray<{ costSource?: string | null }>,
): number {
  return rows.filter((row) => (row.costSource ?? "default") !== "default").length;
}
