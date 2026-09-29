import { describe, expect, it } from "vitest";
import {
  REFUND_ADMIN_FEE_CAP_USD,
  refundAdminFeePerSku,
  refundExtraPerUnit,
} from "./refundFees";

describe("refund admin fee", () => {
  it("charges 20% of the referral fee", () => {
    expect(refundAdminFeePerSku(2)).toBeCloseTo(0.4, 2);
  });

  it("caps the fee at $5 per SKU", () => {
    expect(refundAdminFeePerSku(100)).toBe(REFUND_ADMIN_FEE_CAP_USD);
  });

  it("adds unrecovered shipping on the refunded share only", () => {
    const extra = refundExtraPerUnit({
      listPrice: 25,
      platformFeePct: 8,
      refundRatePct: 50,
      unrecoveredShipPerUnit: 4,
    });
    expect(extra.adminFee).toBeCloseTo(0.2, 2);
    expect(extra.unrecoveredShipping).toBeCloseTo(2, 2);
    expect(extra.total).toBeCloseTo(2.2, 2);
  });
});
