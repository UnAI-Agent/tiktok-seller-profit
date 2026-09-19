import type { SkuRecord } from "../types/sku";

const MAX_TITLE = 500;
const MAX_SKU_ID = 128;
const MAX_URL = 2000;

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Drop corrupt SKU rows instead of crashing the dashboard. */
export function isValidSku(value: unknown): value is SkuRecord {
  if (!value || typeof value !== "object") return false;
  const sku = value as Partial<SkuRecord>;
  if (typeof sku.skuId !== "string" || sku.skuId.length < 1 || sku.skuId.length > MAX_SKU_ID) {
    return false;
  }
  if (typeof sku.title !== "string" || sku.title.length > MAX_TITLE) return false;
  if (!finiteNumber(sku.listPrice) || sku.listPrice < 0) return false;
  if (!finiteNumber(sku.cogsPerUnit) || sku.cogsPerUnit < 0) return false;
  if (!finiteNumber(sku.shippingOut) || sku.shippingOut < 0) return false;
  if (!finiteNumber(sku.adsPerUnit) || sku.adsPerUnit < 0) return false;
  if (!finiteNumber(sku.unitsSold) || sku.unitsSold < 0) return false;
  if (!finiteNumber(sku.refundRatePct)) return false;
  if (!finiteNumber(sku.netMarginPct)) return false;
  if (!finiteNumber(sku.netProfit)) return false;
  if (typeof sku.sourceUrl !== "string" || sku.sourceUrl.length > MAX_URL) return false;
  if (typeof sku.updatedAt !== "string" || sku.updatedAt.length < 8) return false;
  return true;
}

export function sanitizeSkuList(values: unknown[]): {
  skus: SkuRecord[];
  skipped: number;
} {
  const skus: SkuRecord[] = [];
  let skipped = 0;
  for (const value of values) {
    if (isValidSku(value)) skus.push(value);
    else skipped += 1;
  }
  return { skus, skipped };
}
