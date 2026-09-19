import { FREE_SKU_LIMIT } from "../config";

/** Warn free users before they hit the hard cap. */
export const FREE_SKU_WARN_AT = 8;

export function skuCountLabel(count: number, isPro: boolean): string {
  if (isPro) return `Unlimited SKUs · ${count} stored`;
  return `${count} SKUs stored (${count}/${FREE_SKU_LIMIT})`;
}

export function skuLimitWarning(count: number, isPro: boolean): string | null {
  if (isPro) return null;
  if (count >= FREE_SKU_LIMIT) {
    return `Free tier limit reached (${FREE_SKU_LIMIT} SKUs). Upgrade to Pro for unlimited.`;
  }
  if (count >= FREE_SKU_WARN_AT) {
    return `You're close to the free limit (${count}/${FREE_SKU_LIMIT}). Upgrade to keep adding SKUs.`;
  }
  return null;
}

export function canAddSku(count: number, isPro: boolean, isNew: boolean): boolean {
  if (isPro || !isNew) return true;
  return count < FREE_SKU_LIMIT;
}
