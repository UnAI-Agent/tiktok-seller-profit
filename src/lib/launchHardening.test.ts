import { describe, expect, it } from "vitest";
import { parseErrorBody, parseRetryAfterMs } from "./apiErrors";
import { canAddSku, skuCountLabel, skuLimitWarning } from "./skuLimit";
import { isValidSku, sanitizeSkuList } from "./skuValidate";
import type { SkuRecord } from "../types/sku";

const validSku = (): SkuRecord => ({
  skuId: "sku-1",
  title: "Mug",
  listPrice: 12,
  cogsPerUnit: 3,
  shippingOut: 1,
  adsPerUnit: 0.5,
  unitsSold: 4,
  refundRatePct: 3,
  netMarginPct: 20,
  netProfit: 10,
  sourceUrl: "https://seller-us.tiktok.com/product/1",
  updatedAt: "2026-09-19T00:00:00.000Z",
});

describe("parseErrorBody", () => {
  it("reads FastAPI detail", () => {
    expect(parseErrorBody('{"detail":"Invalid email or password"}', 401)).toBe(
      "Invalid email or password",
    );
  });

  it("does not leak HTML", () => {
    expect(parseErrorBody("<html>stack</html>", 500)).toBe(
      "Request failed. Try again.",
    );
  });
});

describe("parseRetryAfterMs", () => {
  it("parses seconds", () => {
    expect(parseRetryAfterMs("5")).toBe(5000);
  });
});

describe("sku limits", () => {
  it("warns at 8 and blocks the 11th on free", () => {
    expect(skuLimitWarning(8, false)).toMatch(/8\/10/);
    expect(canAddSku(10, false, true)).toBe(false);
    expect(canAddSku(10, true, true)).toBe(true);
    expect(canAddSku(10, false, false)).toBe(true);
    expect(skuCountLabel(3, true)).toMatch(/Unlimited/);
  });
});

describe("sku validation", () => {
  it("accepts a complete row and skips garbage", () => {
    expect(isValidSku(validSku())).toBe(true);
    expect(isValidSku({ skuId: "x" })).toBe(false);
    const { skus, skipped } = sanitizeSkuList([validSku(), { bad: true }, null]);
    expect(skus).toHaveLength(1);
    expect(skipped).toBe(2);
  });
});
