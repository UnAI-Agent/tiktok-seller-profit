import { expect, test } from "../support/fixtures";

test("E-LIVE-SHOP read-only Seller Center smoke", async ({ page }) => {
  test.skip(!process.env.LIVE_PRODUCT_URL, "LIVE_PRODUCT_URL is not set");
  await page.goto(process.env.LIVE_PRODUCT_URL ?? "");
  await expect(page.locator("#tiktok-seller-tool-root")).toBeAttached();
});
