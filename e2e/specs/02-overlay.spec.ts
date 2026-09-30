import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeProfit, formatSignedUsd } from "../../src/lib/profit";
import { expect, test } from "../support/fixtures";
import { wipeExtension } from "../support/session";

const FEES = {
  refundRatePct: 3,
  platformFeePct: 6,
  paymentFeePct: 0,
  paymentFixed: 0,
  affiliatePct: 10,
  affiliateSharePct: 100,
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("E-OVL-READ logged-out panel shows the title and the promo price", async ({ page, harness, overlay }) => {
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = overlay(page);
  await expect(panel.getByText("Ailun Screen Protector", { exact: false })).toBeVisible();
  await expect(panel.getByText("$36.00")).toBeVisible();
  await expect(panel.getByText("$45.00")).toBeVisible();
});

test("E-OVL-STRIP logged-out strip, footer, and help", async ({ page, harness, overlay }) => {
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = overlay(page);
  await expect(panel.getByText("Profit on this page works without an account.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Create free account" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Log in" })).toBeVisible();
  await expect(panel.getByText("Not affiliated with or endorsed by TikTok.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Help & support" })).toBeVisible();
});

test("E-OVL-LIVE-EDIT editing the page price updates the overlay net", async ({ page, harness, overlay }) => {
  await page.goto(`${harness.origin}/product/edit/1732672081725400001`);
  const panel = overlay(page);
  await expect(panel.getByText("Winner Ceramic Mug")).toBeVisible();
  await page.locator('[data-testid="retail-price"]').fill("50");
  await page.locator('[data-testid="retail-price"]').dispatchEvent("input");
  await expect(panel.getByText("List $50.00")).toBeVisible();
  await panel.locator("#mm-hero-cost").fill("8");
  await panel.getByRole("button", { name: "See my profit" }).click();
  const result = computeProfit({
    listPrice: 50,
    cogsPerUnit: 8,
    shippingOut: 0,
    adsPerUnit: 0,
    unitsSold: 0,
    refundRatePct: FEES.refundRatePct,
    platformFeePct: FEES.platformFeePct,
    paymentFeePct: 0,
    paymentFixed: 0,
    packagingPerUnit: 0,
    affiliatePct: FEES.affiliatePct,
    affiliateSharePct: FEES.affiliateSharePct,
  });
  await expect(panel.getByText(formatSignedUsd(result.netPerUnit)).first()).toBeVisible();
});

test("E-OVL-NOPRICE a page with no price asks for a selling price", async ({ page, harness, overlay }) => {
  await page.goto(`${harness.origin}/product/edit/noprice`);
  const panel = overlay(page);
  const input = panel.getByLabel("Selling price");
  await expect(input).toBeVisible();
  await input.fill("20");
  await panel.locator("#mm-hero-cost").fill("4");
  await panel.getByRole("button", { name: "See my profit" }).click();
  const result = computeProfit({
    listPrice: 20,
    cogsPerUnit: 4,
    shippingOut: 0,
    adsPerUnit: 0,
    unitsSold: 0,
    refundRatePct: FEES.refundRatePct,
    platformFeePct: FEES.platformFeePct,
    paymentFeePct: 0,
    paymentFixed: 0,
    packagingPerUnit: 0,
    affiliatePct: FEES.affiliatePct,
    affiliateSharePct: FEES.affiliateSharePct,
  });
  await expect(panel.getByText(formatSignedUsd(result.netPerUnit)).first()).toBeVisible();
});

test("E-OVL-BLANK a missing page shows no numbers", async ({ page, harness, overlay }) => {
  await page.goto(`${harness.origin}/product/edit/blank`);
  const panel = overlay(page);
  await expect(panel.getByText("This page didn't load")).toBeVisible();
  await expect(panel.getByText("$")).toHaveCount(0);
});

test("E-OVL-COLLAPSE minimize persists across reload", async ({ page, harness, overlay }) => {
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = overlay(page);
  await panel.getByRole("button", { name: "Minimize" }).click();
  await expect(panel.getByRole("button", { name: "Open MarginMark" })).toBeVisible();
  await page.reload();
  await expect(panel.getByRole("button", { name: "Open MarginMark" })).toBeVisible();
  await panel.getByRole("button", { name: "Open MarginMark" }).click();
  await expect(panel.getByRole("button", { name: "Create free account" })).toBeVisible();
});

test("E-OVL-CLOSE close hides the panel until it is opened again", async ({ page, harness, overlay, openPanel }) => {
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = overlay(page);
  await expect(panel).toBeAttached();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.reload();
  await expect(panel).toHaveCount(0);
  await openPanel(page);
  await expect(panel).toBeAttached();
});

test("E-OVL-SAVE-NUDGE the panel does not cover the page Save button", async ({ page, harness, overlay }) => {
  await page.goto(`${harness.origin}/product/edit/with-save`);
  const host = overlay(page);
  await expect(host).toBeAttached();
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeVisible();
  await expect.poll(async () => {
    const hostBox = await host.boundingBox();
    const saveBox = await save.boundingBox();
    if (!hostBox || !saveBox) return true;
    return hostBox.x < saveBox.x + saveBox.width && hostBox.x + hostBox.width > saveBox.x && hostBox.y < saveBox.y + saveBox.height && hostBox.y + hostBox.height > saveBox.y;
  }).toBe(false);
});

test("E-OVL-SPA navigation updates the title and price", async ({ page, harness, overlay }) => {
  await page.goto(`${harness.origin}/product/edit/1732672081725400001`);
  const panel = overlay(page);
  await expect(panel.getByText("Winner Ceramic Mug")).toBeVisible();
  const next = JSON.parse(readFileSync(path.join(root, "test-fixtures", "lab", "expected.json"), "utf8")).products[1];
  await page.evaluate((product) => {
    document.body.innerHTML = `<div data-testid="product-title">${product.title}</div><p>Promotion price: $${Number(product.listPrice).toFixed(2)}</p><input data-testid="retail-price" value="${product.listPriceOriginal}" />`;
    history.pushState({}, "", `/product/edit/${product.skuId}`);
  }, next);
  await expect(panel.getByText("Promo Candle Set")).toBeVisible();
  await expect(panel.getByText("$19.99")).toBeVisible();
});

test("E-OVL-GUARD-CHIP a loss product shows the price-guard chip", async ({ page, harness, overlay, context, extId }) => {
  await wipeExtension(context, extId, page);
  await page.goto(`${harness.origin}/product/edit/1732672081725400001`);
  const panel = overlay(page);
  const chip = page.locator("#marginguard-price-guard");
  await expect(chip).toHaveCount(0);
  await panel.locator("#mm-hero-cost").fill("80");
  await panel.getByRole("button", { name: "See my profit" }).click();
  await expect(chip).toHaveCount(1);
  await panel.getByRole("spinbutton", { name: "Product cost" }).fill("1");
  await panel.getByRole("spinbutton", { name: "Product cost" }).blur();
  await expect(chip).toHaveCount(0);
});
