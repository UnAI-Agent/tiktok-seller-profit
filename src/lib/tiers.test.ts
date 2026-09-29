import { FREE_SKU_LIMIT, TIER_LIMITS } from "../config";
import { describe, expect, it } from "vitest";

describe("tier limits", () => {
  it("matches the pricing spec", () => {
    expect(FREE_SKU_LIMIT).toBe(TIER_LIMITS.free.skuLimit);
    expect(TIER_LIMITS.free.productChecksPerDay).toBe(5);
    expect(TIER_LIMITS.pro.monthlyUsd).toBe(14.99);
    expect(TIER_LIMITS.pro.yearlyUsd).toBe(120);
    expect(TIER_LIMITS.pro.aiPerMonth).toBe(300);
    expect(TIER_LIMITS.pro.trialDays).toBe(7);
    expect(TIER_LIMITS.diamond.monthlyUsd).toBe(39);
    expect(TIER_LIMITS.diamond.yearlyUsd).toBe(349);
    expect(TIER_LIMITS.diamond.aiPerMonth).toBe(1000);
    expect(TIER_LIMITS.diamond.trialDays).toBe(0);
  });
});
