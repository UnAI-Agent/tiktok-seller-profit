import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  breakEvenRoas,
  computeProfit,
  maxCpa,
  maxSafeCommissionPct,
  profitModel,
  type ProfitInput,
} from "./profit";

function input(partial: {
  listPrice: number;
  cogsPerUnit: number;
  shippingOut: number;
  packagingPerUnit: number;
  platformFeePct: number;
  paymentFeePct: number;
  refundRatePct: number;
  salesTaxPct: number;
  affiliatePct: number;
  affiliateSharePct: number;
  adsPerUnit: number;
  paymentFixed: number;
}): ProfitInput {
  return { ...partial, unitsSold: 10, samplesSent: 0 };
}

const valid = fc.record({
  listPrice: fc.double({ min: 1, max: 400, noNaN: true }),
  cogsPerUnit: fc.double({ min: 0, max: 80, noNaN: true }),
  shippingOut: fc.double({ min: 0, max: 15, noNaN: true }),
  packagingPerUnit: fc.double({ min: 0, max: 5, noNaN: true }),
  platformFeePct: fc.double({ min: 0, max: 15, noNaN: true }),
  paymentFeePct: fc.double({ min: 0, max: 5, noNaN: true }),
  refundRatePct: fc.double({ min: 0, max: 15, noNaN: true }),
  salesTaxPct: fc.double({ min: 0, max: 10, noNaN: true }),
  affiliatePct: fc.double({ min: 0, max: 40, noNaN: true }),
  affiliateSharePct: fc.double({ min: 0, max: 100, noNaN: true }),
  adsPerUnit: fc.double({ min: 0, max: 20, noNaN: true }),
  paymentFixed: fc.double({ min: 0, max: 1, noNaN: true }),
});

describe("profit properties", () => {
  it("holds on 1000 random valid inputs", () => {
    fc.assert(
      fc.property(valid, (raw) => {
        const base = input(raw);
        const model = profitModel(base);
        const result = computeProfit(base);
        for (const value of [
          model.K,
          model.F,
          result.netPerUnit,
          result.netPerUnitDirect,
          result.netPerUnitCreator,
          result.breakEvenPrice,
          result.netMarginPct,
        ]) {
          if (value != null) expect(Number.isFinite(value)).toBe(true);
        }
        expect(result.netPerUnitDirect + 1e-9).toBeGreaterThanOrEqual(result.netPerUnit);
        expect(result.netPerUnit + 1e-9).toBeGreaterThanOrEqual(result.netPerUnitCreator);

        if (result.breakEvenPrice != null && result.breakEvenPrice > 0 && result.breakEvenPrice < 1e6) {
          const atEven = computeProfit({ ...base, listPrice: result.breakEvenPrice });
          expect(Math.abs(atEven.netPerUnit)).toBeLessThanOrEqual(0.02);
        }

        const caps = maxSafeCommissionPct(base, 15);
        if (caps.breakEven != null && caps.breakEven > 0 && caps.breakEven < 100 && base.listPrice > 0) {
          const atCap = computeProfit({
            ...base,
            affiliatePct: caps.breakEven,
            affiliateSharePct: 100,
          });
          expect(Math.abs(atCap.netPerUnitCreator)).toBeLessThanOrEqual(0.05);
        }
        if (caps.atTarget != null && caps.atTarget > 0 && caps.atTarget < 100 && base.listPrice > 0) {
          const atTarget = computeProfit({
            ...base,
            affiliatePct: caps.atTarget,
            affiliateSharePct: 100,
          });
          const margin = (atTarget.netPerUnitCreator / base.listPrice) * 100;
          expect(Math.abs(margin - 15)).toBeLessThanOrEqual(0.1);
        }

        const cpa = maxCpa(base, 0);
        const roas = breakEvenRoas(base, 0, "direct");
        if (cpa.direct != null && cpa.direct > 0 && roas != null) {
          expect(Math.abs(roas * cpa.direct - base.listPrice)).toBeLessThanOrEqual(0.02);
        }

        const richer = computeProfit({ ...base, listPrice: base.listPrice + 5 });
        expect(richer.netPerUnit + 1e-6).toBeGreaterThanOrEqual(result.netPerUnit);
        const moreComm = computeProfit({ ...base, affiliatePct: base.affiliatePct + 5 });
        expect(moreComm.netPerUnit).toBeLessThanOrEqual(result.netPerUnit + 1e-6);
        const moreCogs = computeProfit({ ...base, cogsPerUnit: base.cogsPerUnit + 1 });
        expect(moreCogs.netPerUnit).toBeLessThanOrEqual(result.netPerUnit + 1e-6);
        const moreAds = computeProfit({ ...base, adsPerUnit: base.adsPerUnit + 1 });
        expect(moreAds.netPerUnit).toBeLessThanOrEqual(result.netPerUnit + 1e-6);
      }),
      { numRuns: 1000 },
    );
  });
});
