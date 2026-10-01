import { effectiveShippingPerUnit } from "./shippingCost";
import type { ProfitInput } from "./profit";
import type { Settings } from "../types/settings";
import type { SkuRecord } from "../types/sku";

export function profitInputFor(
  sku: SkuRecord,
  settings: Settings,
  overrides: Partial<ProfitInput> = {},
  useActualFees = true,
): ProfitInput {
  const actual =
    useActualFees && sku.costSource === "settlement" ? sku.actualFees : undefined;
  const shipRaw = overrides.shippingOut ?? sku.shippingOut;
  const shipping =
    actual?.shippingPerUnit != null
      ? actual.shippingPerUnit
      : effectiveShippingPerUnit(shipRaw, settings.shippingPassedToBuyer ?? true);
  return {
    listPrice: overrides.listPrice ?? sku.listPrice,
    unitsSold: overrides.unitsSold ?? sku.unitsSold,
    cogsPerUnit: overrides.cogsPerUnit ?? sku.cogsPerUnit,
    shippingOut: shipping,
    adsPerUnit: overrides.adsPerUnit ?? sku.adsPerUnit,
    platformFeePct: actual?.platformFeePct ?? settings.platformFeePct,
    paymentFeePct: actual?.paymentFeePct ?? settings.paymentFeePct,
    paymentFixed: actual?.paymentFixed ?? settings.paymentFixed,
    refundRatePct: actual?.refundRatePct ?? settings.refundRatePct,
    salesTaxPct: settings.salesTaxPct,
    packagingPerUnit: overrides.packagingPerUnit ?? sku.packagingPerUnit ?? settings.packagingPerUnit,
    affiliatePct:
      overrides.affiliatePct ?? actual?.affiliatePct ?? sku.affiliatePct ?? settings.affiliateCommissionPct,
    affiliateSharePct:
      overrides.affiliateSharePct ??
      actual?.affiliateSharePct ??
      sku.affiliateSharePct ??
      settings.affiliateSharePct,
    samplesSent: sku.samplesSent ?? 0,
    sampleUnitCost: sku.sampleUnitCost,
    // TikTok keeps 20% of the referral fee (max $5 per SKU) on a refunded order.
    // A settlement statement already reports what was actually charged, so the
    // estimate is added only for costs the seller typed in.
    includeRefundAdminFee: overrides.includeRefundAdminFee ?? !actual,
    unrecoveredShipPerUnit:
      overrides.unrecoveredShipPerUnit ??
      (actual || !(settings.shippingPassedToBuyer ?? true) ? 0 : Math.max(0, shipRaw || 0)),
  };
}
