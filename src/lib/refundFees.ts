/** 20% of the referral fee charged on a refunded SKU. */
export const REFUND_ADMIN_FEE_RATE = 0.2;

/** Refund admin fee never exceeds this amount per SKU. */
export const REFUND_ADMIN_FEE_CAP_USD = 5;

export function refundAdminFeePerSku(referralFeeUsd: number): number {
  if (!Number.isFinite(referralFeeUsd) || referralFeeUsd <= 0) return 0;
  return Math.min(REFUND_ADMIN_FEE_RATE * referralFeeUsd, REFUND_ADMIN_FEE_CAP_USD);
}

/**
 * Expected refund admin fee and unrecovered shipping, already weighted by the
 * refund rate so the result is a per-unit cost. profitInputFor turns this on for
 * every cost the seller typed in; a settlement statement reports actual charges,
 * so settlement-costed products leave it off. scripts/answer-key.py computes the
 * same rule independently for the lab answer key.
 */
export function refundExtraPerUnit(input: {
  listPrice: number;
  platformFeePct: number;
  refundRatePct: number;
  unrecoveredShipPerUnit: number;
}): { adminFee: number; unrecoveredShipping: number; total: number } {
  const price = Number.isFinite(input.listPrice) ? input.listPrice : 0;
  const platformPct = Number.isFinite(input.platformFeePct) ? input.platformFeePct : 0;
  const rate = Number.isFinite(input.refundRatePct) ? Math.max(0, input.refundRatePct) / 100 : 0;
  const ship = Number.isFinite(input.unrecoveredShipPerUnit)
    ? Math.max(0, input.unrecoveredShipPerUnit)
    : 0;
  const adminFee = refundAdminFeePerSku((price * platformPct) / 100) * rate;
  const unrecoveredShipping = ship * rate;
  return { adminFee, unrecoveredShipping, total: adminFee + unrecoveredShipping };
}
