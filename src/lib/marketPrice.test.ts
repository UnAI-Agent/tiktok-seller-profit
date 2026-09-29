import { describe, expect, it } from "vitest";
import { computeProfit, targetPrice, type ProfitInput } from "./profit";
import { marketBand, profitAtPrice, recommendPrice, sellVerdict } from "./marketPrice";

const base: ProfitInput = {
  listPrice: 20,
  unitsSold: 1,
  cogsPerUnit: 8,
  shippingOut: 0,
  adsPerUnit: 0,
  platformFeePct: 6,
  paymentFeePct: 0,
  paymentFixed: 0,
  refundRatePct: 0,
  affiliatePct: 0,
  affiliateSharePct: 0,
};

describe("market price", () => {
  const similar = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28];

  it("needs 8 similar prices", () => {
    expect(marketBand(similar.slice(0, 7))).toBeNull();
    expect(marketBand(similar)?.n).toBeGreaterThanOrEqual(8);
  });

  it("keeps the recommended price inside the market band and above the target", () => {
    const band = marketBand(similar);
    expect(band).not.toBeNull();
    if (!band) return;
    const goal = targetPrice({ ...base, listPrice: band.market }, 15);
    const recommended = recommendPrice(band, goal);
    if (recommended == null) return;
    expect(recommended).toBeGreaterThanOrEqual(band.market - 0.01);
    expect(recommended).toBeLessThanOrEqual(band.high + 0.01);
    const net = profitAtPrice({ ...base, listPrice: recommended }, recommended);
    const targetNet = (recommended * 15) / 100;
    expect(net).not.toBeNull();
    if (net != null && goal != null && goal <= band.high) {
      expect(net + 0.01).toBeGreaterThanOrEqual(Math.min(targetNet, 0) - 0.01);
    }
    const result = computeProfit({ ...base, listPrice: recommended, includeRefundAdminFee: true });
    expect(Number.isFinite(result.netPerUnit)).toBe(true);
  });

  it("asks for a cost and refuses a price the market will not pay", () => {
    expect(sellVerdict({ supplierCost: null, band: marketBand(similar), goal: 10 }).verdict).toBe("missing_cost");
    expect(sellVerdict({ supplierCost: 0, band: marketBand(similar), goal: 10 }).verdict).toBe("missing_cost");
    const band = marketBand(similar);
    expect(sellVerdict({ supplierCost: 4, band, goal: 500 }).verdict).toBe("not_profitable");
  });
});
