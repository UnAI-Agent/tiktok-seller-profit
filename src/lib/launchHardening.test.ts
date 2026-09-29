import { describe, expect, it } from "vitest";
import { errorTextFromJson, parseErrorBody, parseRetryAfterMs } from "./apiErrors";
import { canAddSku, FREE_SKU_WARN_AT, skuCountLabel, skuLimitWarning } from "./skuLimit";
import { FREE_SKU_LIMIT } from "../config";
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

describe("errorTextFromJson", () => {
  it("BUG_proxy_shows_detail_string_and_validation_list", () => {
    expect(errorTextFromJson({ detail: "Verify your email to start your trial" }, 403)).toBe(
      "Verify your email to start your trial",
    );
    expect(errorTextFromJson({ detail: [{ msg: "Field required" }] }, 422)).toBe("Field required");
    expect(errorTextFromJson({ error: "old shape" }, 400)).toBe("old shape");
    expect(errorTextFromJson(null, 500)).toBe("Request failed (500)");
  });
});

describe("parseRetryAfterMs", () => {
  it("parses seconds", () => {
    expect(parseRetryAfterMs("5")).toBe(5000);
  });
});

describe("sku limits", () => {
  it("warns near the cap and blocks the next cost on free", () => {
    expect(skuLimitWarning(FREE_SKU_WARN_AT, false)).toMatch(new RegExp(`${FREE_SKU_WARN_AT}/${FREE_SKU_LIMIT}`));
    expect(canAddSku(FREE_SKU_LIMIT, false, true)).toBe(false);
    expect(canAddSku(FREE_SKU_LIMIT, true, true)).toBe(true);
    expect(canAddSku(FREE_SKU_LIMIT, false, false)).toBe(true);
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
