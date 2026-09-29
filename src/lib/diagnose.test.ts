import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../types/settings";
import type { SkuRecord } from "../types/sku";
import { diagnose, portfolioStats } from "./diagnose";
import type { ProfitInput } from "./profit";

function input(partial: Partial<ProfitInput>): ProfitInput {
  return {
    listPrice: 25,
    unitsSold: 1,
    cogsPerUnit: 8,
    shippingOut: 0,
    packagingPerUnit: 0.5,
    platformFeePct: 8,
    paymentFeePct: 0,
    paymentFixed: 0,
    refundRatePct: 3,
    affiliatePct: 15,
    affiliateSharePct: 100,
    adsPerUnit: 0,
    salesTaxPct: 0,
    ...partial,
  };
}

describe("diagnose", () => {
  it("flags default costs before profit", () => {
    expect(diagnose(input({}), "default", 15).status).toBe("missing-cost");
  });

  it("tells the seller to cut commission when that alone fixes the loss", () => {
    const row = diagnose(input({ affiliatePct: 60 }), "custom", 15);
    expect(row.status).toBe("cut-commission");
    expect(row.label).toContain("55");
  });

  it("tells the seller to cut ads when commission is not the cause", () => {
    const row = diagnose(input({ affiliatePct: 0, affiliateSharePct: 0, adsPerUnit: 20 }), "custom", 15);
    expect(row.status).toBe("cut-ads");
  });

  it("asks for a higher price when neither lever is enough", () => {
    const row = diagnose(input({ cogsPerUnit: 30, affiliatePct: 0, affiliateSharePct: 0 }), "custom", 15);
    expect(row.status).toBe("raise-price");
  });

  it("says stop selling when the required price is more than double", () => {
    const row = diagnose(input({ cogsPerUnit: 80, affiliatePct: 0, affiliateSharePct: 0 }), "custom", 15);
    expect(row.status).toBe("stop-selling");
  });

  it("marks a thin but positive margin as below target", () => {
    const row = diagnose(input({ cogsPerUnit: 16 }), "custom", 15);
    expect(row.status).toBe("below-target");
  });

  it("marks example A as healthy", () => {
    expect(diagnose(input({}), "custom", 15).status).toBe("healthy");
  });

  it("blames a promo that falls under break-even while the list price does not", () => {
    const row = diagnose(
      input({
        listPrice: 19.99,
        cogsPerUnit: 14,
        adsPerUnit: 4,
        packagingPerUnit: 0,
        platformFeePct: 6,
        affiliatePct: 10,
      }),
      "custom",
      15,
      29.99,
    );
    expect(row.status).toBe("promo-below-breakeven");
    expect(row.label).toBe("Promo price is below break-even ($22.22)");
  });
});

describe("portfolioStats", () => {
  it("sums recorded-sales leaks and counts real costs", () => {
    const loser: SkuRecord = {
      skuId: "a",
      title: "Loss",
      listPrice: 20,
      cogsPerUnit: 9,
      shippingOut: 0,
      adsPerUnit: 5,
      unitsSold: 10,
      refundRatePct: 5,
      netMarginPct: 0,
      netProfit: 0,
      sourceUrl: "https://seller-us.tiktok.com/p",
      updatedAt: "2026-09-23T00:00:00.000Z",
      packagingPerUnit: 0.5,
      affiliatePct: 20,
      affiliateSharePct: 100,
      costSource: "custom",
    };
    const stats = portfolioStats([loser], {
      ...DEFAULT_SETTINGS,
      platformFeePct: 8,
      paymentFeePct: 0,
      paymentFixed: 0,
      refundRatePct: 5,
      salesTaxPct: 0,
      packagingPerUnit: 0,
      shippingPassedToBuyer: true,
    });
    expect(stats.losing).toBe(1);
    expect(stats.realCosts).toBe(1);
    expect(stats.leak).toBeCloseTo(11, 1);
    expect(stats.worstCreatorLoss?.title).toBe("Loss");
  });
});
