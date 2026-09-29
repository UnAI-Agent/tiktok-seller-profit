import { describe, expect, it } from "vitest";
import { isSellerCenterUrl } from "./sellerUrl";

describe("isSellerCenterUrl", () => {
  it("matches hyphen and dotted US hosts", () => {
    expect(
      isSellerCenterUrl("https://seller-us.tiktok.com/product/manage"),
    ).toBe(true);
    expect(
      isSellerCenterUrl("https://seller.us.tiktok.com/product/manage?shop_region=US"),
    ).toBe(true);
  });

  it("does not match consumer TikTok", () => {
    expect(isSellerCenterUrl("https://www.tiktok.com/@shop")).toBe(false);
    expect(isSellerCenterUrl("")).toBe(false);
  });
});
