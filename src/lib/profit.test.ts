import { describe, expect, it } from "vitest";
import {
  breakEvenRoas,
  computeProfit,
  formatUsd,
  marginTone,
  maxCpa,
  maxSafeCommissionPct,
  priceGuard,
} from "./profit";

describe("computeProfit", () => {
  it("matches hand-calculated fixture", () => {
    const r = computeProfit({
      listPrice: 10,
      unitsSold: 10,
      cogsPerUnit: 4,
      shippingOut: 1,
      adsPerUnit: 0.5,
      platformFeePct: 8,
      paymentFeePct: 2.9,
      paymentFixed: 0.3,
      refundRatePct: 3,
    });

    expect(r.grossRevenue).toBe(100);
    expect(r.platformFee).toBeCloseTo(8, 2);
    expect(r.paymentFee).toBeCloseTo(5.9, 2);
    expect(r.cogsTotal).toBe(40);
    expect(r.shippingTotal).toBe(10);
    expect(r.adsTotal).toBe(5);
    expect(r.refunds).toBeCloseTo(3, 2);
    expect(r.netProfit).toBeCloseTo(28.1, 1);
    expect(r.netMarginPct).toBeCloseTo(28.1, 1);
  });

  it("zero list price avoids divide by zero", () => {
    const r = computeProfit({
      listPrice: 0,
      unitsSold: 10,
      cogsPerUnit: 5,
      shippingOut: 1,
      adsPerUnit: 0,
      platformFeePct: 8,
      paymentFeePct: 2.9,
      paymentFixed: 0.3,
      refundRatePct: 3,
    });

    expect(r.grossRevenue).toBe(0);
    expect(r.netMarginPct).toBeNull();
    expect(r.netProfit).toBeLessThan(0);
  });

  it("loss when COGS exceeds revenue", () => {
    const r = computeProfit({
      listPrice: 10,
      unitsSold: 5,
      cogsPerUnit: 15,
      shippingOut: 0,
      adsPerUnit: 0,
      platformFeePct: 8,
      paymentFeePct: 2.9,
      paymentFixed: 0.3,
      refundRatePct: 3,
    });

    expect(r.netProfit).toBeLessThan(0);
    expect(marginTone(r.netProfit, r.netMarginPct)).toBe("loss");
  });
});

describe("computeProfit brief fixture", () => {
  it("matches high-volume SKU shape from product brief", () => {
    const r = computeProfit({
      listPrice: 15.99,
      unitsSold: 342,
      cogsPerUnit: 3,
      shippingOut: 1.5,
      adsPerUnit: 0.5,
      platformFeePct: 5,
      paymentFeePct: 3.5,
      paymentFixed: 0.3,
      refundRatePct: 2,
      salesTaxPct: 0,
      packagingPerUnit: 0.15,
    });

    expect(r.grossRevenue).toBeCloseTo(5468.58, 1);
    expect(r.netMarginPct).toBeGreaterThan(50);
    expect(r.netProfit).toBeGreaterThan(2500);
    expect(marginTone(r.netProfit, r.netMarginPct)).toBe("profit");
  });
});

const exampleA = {
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
};

describe("worked example A", () => {
  it("counts creator commission and break-even commission", () => {
    const r = computeProfit(exampleA);
    expect(r.contribution).toBeCloseTo(13.75, 2);
    expect(r.netPerUnitCreator).toBeCloseTo(10, 2);
    expect(r.affiliateTotal).toBeCloseTo(3.75, 2);
    expect(r.netPerUnit).toBeCloseTo(10, 2);
    const caps = maxSafeCommissionPct(exampleA, 15);
    expect(caps.breakEven).toBeCloseTo(55, 2);
    expect(caps.atTarget).toBeCloseTo(40, 2);
    expect(maxCpa(exampleA, 0).direct).toBeCloseTo(13.75, 2);
    expect(breakEvenRoas(exampleA, 0, "direct")).toBeCloseTo(1.82, 2);
  });
});

describe("worked example B", () => {
  const exampleB = {
    listPrice: 20,
    unitsSold: 1,
    cogsPerUnit: 9,
    shippingOut: 0,
    packagingPerUnit: 0.5,
    platformFeePct: 8,
    paymentFeePct: 0,
    paymentFixed: 0,
    refundRatePct: 5,
    affiliatePct: 20,
    affiliateSharePct: 100,
    adsPerUnit: 0,
    salesTaxPct: 0,
  };

  it("shows a 4× ROAS creator sale still loses money", () => {
    const quiet = computeProfit(exampleB);
    expect(quiet.contribution).toBeCloseTo(7.9, 2);
    expect(quiet.netPerUnitCreator).toBeCloseTo(3.9, 2);
    expect(maxCpa(exampleB, 0).creator).toBeCloseTo(3.9, 2);
    expect(breakEvenRoas(exampleB, 0, "creator")).toBeCloseTo(5.13, 2);
    expect(maxCpa(exampleB, 15).creator).toBeCloseTo(0.9, 2);
    expect(breakEvenRoas(exampleB, 15, "creator")).toBeCloseTo(22.22, 1);

    const atFourX = computeProfit({ ...exampleB, adsPerUnit: 5 });
    expect(atFourX.netPerUnitCreator).toBeCloseTo(-1.1, 2);
  });
});

describe("profit guards", () => {
  it("returns null when no price clears the fee rate", () => {
    const r = computeProfit({
      listPrice: 10,
      unitsSold: 1,
      cogsPerUnit: 1,
      shippingOut: 0,
      adsPerUnit: 0,
      platformFeePct: 80,
      paymentFeePct: 30,
      paymentFixed: 0,
      refundRatePct: 0,
    });
    expect(r.breakEvenPrice).toBeNull();
    expect(priceGuard({
      listPrice: 10,
      unitsSold: 1,
      cogsPerUnit: 1,
      shippingOut: 0,
      adsPerUnit: 0,
      platformFeePct: 80,
      paymentFeePct: 30,
      paymentFixed: 0,
      refundRatePct: 0,
    }, 15).kind).toBe("impossible");
  });

  it("returns null commission caps when price is zero", () => {
    expect(
      maxSafeCommissionPct(
        {
          listPrice: 0,
          unitsSold: 1,
          cogsPerUnit: 1,
          shippingOut: 0,
          adsPerUnit: 0,
          platformFeePct: 8,
          paymentFeePct: 0,
          paymentFixed: 0,
          refundRatePct: 0,
        },
        15,
      ).breakEven,
    ).toBeNull();
  });

  it("returns null ROAS when max CPA is not positive", () => {
    expect(
      breakEvenRoas(
        {
          listPrice: 10,
          unitsSold: 1,
          cogsPerUnit: 20,
          shippingOut: 0,
          adsPerUnit: 0,
          platformFeePct: 8,
          paymentFeePct: 0,
          paymentFixed: 0,
          refundRatePct: 0,
          affiliatePct: 20,
          affiliateSharePct: 100,
        },
        0,
        "creator",
      ),
    ).toBeNull();
  });
});

describe("formatUsd", () => {
  it("formats negatives, zero, and thousands", () => {
    expect(formatUsd(-1.1)).toBe("-$1.10");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(12345.67)).toBe("$12,345.67");
  });
});

describe("marginTone", () => {
  it("classifies warning band", () => {
    expect(marginTone(10, 12)).toBe("warning");
  });

  it("classifies profit band", () => {
    expect(marginTone(10, 20)).toBe("profit");
  });
});
