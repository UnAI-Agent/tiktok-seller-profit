import { describe, expect, it } from "vitest";
import { computeProfit, marginTone } from "./profit";

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
    expect(r.netMarginPct).toBe(0);
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

describe("marginTone", () => {
  it("classifies warning band", () => {
    expect(marginTone(10, 12)).toBe("warning");
  });

  it("classifies profit band", () => {
    expect(marginTone(10, 20)).toBe("profit");
  });
});
