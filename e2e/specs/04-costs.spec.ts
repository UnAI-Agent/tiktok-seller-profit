import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeProfit, formatPct, formatSignedUsd } from "../../src/lib/profit";
import { expect, test } from "../support/fixtures";
import { email, seedToken } from "../support/session";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function login(page: import("@playwright/test").Page, context: import("@playwright/test").BrowserContext, extId: string, api: import("../support/backend").Api) {
  const user = await api.registerApi(email());
  await seedToken(context, extId, user.token);
  return user;
}

test("E-COST-ENTRY hero cost opens the grid and saves", async ({ page, harness, context, extId }) => {
  await login(page, context, extId, harness.api);
  await page.goto(`${harness.origin}/product/edit/1732672081725400001`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.locator("#mm-hero-cost").fill("8");
  await panel.getByRole("button", { name: "See my profit" }).click();
  await expect(panel.getByText("Your costs").first()).toBeVisible();
  await panel.getByRole("spinbutton", { name: "Packaging" }).fill("1");
  await panel.getByRole("spinbutton", { name: "Packaging" }).blur();
  await expect(panel.getByText("Saved")).toBeVisible();
});

test("E-COST-PERSIST saved costs survive a reload", async ({ page, harness, context, extId }) => {
  await login(page, context, extId, harness.api);
  await page.goto(`${harness.origin}/product/edit/1732672081725400001`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.locator("#mm-hero-cost").fill("8");
  await panel.getByRole("button", { name: "See my profit" }).click();
  await panel.getByRole("spinbutton", { name: "Packaging" }).fill("1.25");
  await panel.getByRole("spinbutton", { name: "Packaging" }).blur();
  await page.waitForTimeout(800); // cost autosave debounce is 400ms; wait for the save to finish
  await expect(panel.getByText("Saved")).toBeVisible();
  await page.reload();
  await expect(panel.getByRole("spinbutton", { name: "Product cost" })).toHaveValue("8");
  await expect(panel.getByRole("spinbutton", { name: "Packaging" })).toHaveValue("1.25");
});

test("E-COST-MATH net and margin match the engine and the golden value", async ({ page, harness, context, extId }) => {
  const golden = JSON.parse(readFileSync(path.join(root, "qa", "golden-cases.json"), "utf8")).cases[0];
  const input = golden.input;
  await login(page, context, extId, harness.api);
  const ext = await page.context().newPage();
  await ext.goto(`chrome-extension://${extId}/oauth-finish.html`);
  await ext.evaluate(async (next) => {
    const current = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings: {
        ...current.settings,
        feePreset: "custom",
        platformFeePct: next.platformFeePct,
        paymentFeePct: next.paymentFeePct,
        paymentFixed: next.paymentFixed,
        refundRatePct: next.refundRatePct,
        packagingPerUnit: 0,
        affiliateCommissionPct: next.affiliatePct,
        affiliateSharePct: next.affiliateSharePct,
        targetMarginPct: next.targetMarginPct,
        shippingPassedToBuyer: next.shippingPassedToBuyer,
      },
    });
  }, input);
  await ext.close();
  await page.goto(`${harness.origin}/product/edit/1732672081725400001`);
  await page.locator('[data-testid="retail-price"]').fill(String(input.price));
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.locator("#mm-hero-cost").fill(String(input.cogs));
  await panel.getByRole("button", { name: "See my profit" }).click();
  await panel.getByRole("spinbutton", { name: "Packaging" }).fill(String(input.packaging));
  await panel.getByRole("spinbutton", { name: "Creator commission" }).fill(String(input.affiliatePct));
  await panel.getByRole("spinbutton", { name: "Creator commission" }).blur();
  const result = computeProfit({
    listPrice: input.price,
    unitsSold: 0,
    cogsPerUnit: input.cogs,
    shippingOut: 0,
    adsPerUnit: input.adsPerUnit,
    platformFeePct: input.platformFeePct,
    paymentFeePct: input.paymentFeePct,
    paymentFixed: input.paymentFixed,
    refundRatePct: input.refundRatePct,
    packagingPerUnit: input.packaging,
    affiliatePct: input.affiliatePct,
    affiliateSharePct: input.affiliateSharePct,
  });
  expect(Math.abs(result.netPerUnit - golden.expected.netBlended)).toBeLessThanOrEqual(0.01);
  await expect(panel.getByText(formatSignedUsd(golden.expected.netBlended)).first()).toBeVisible();
  await expect(panel.getByText(formatPct(golden.expected.marginBlendedPct), { exact: false })).toBeVisible();
});

test("E-COST-PROLOCK a free user sees the lock, including the loss copy", async ({ page, harness, context, extId }) => {
  await login(page, context, extId, harness.api);
  await page.goto(`${harness.origin}/product/edit/1732672081725400001`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.locator("#mm-hero-cost").fill("8");
  await panel.getByRole("button", { name: "See my profit" }).click();
  await expect(panel.getByText("Max commission & ad limits")).toBeVisible();
  await panel.getByRole("spinbutton", { name: "Product cost" }).fill("80");
  await panel.getByRole("spinbutton", { name: "Product cost" }).blur();
  await expect(panel.getByText("See the fix for this loss")).toBeVisible();
  await expect(panel.getByText(/You lose \$/)).toBeVisible();
});

test("E-COST-HELP help opens and closes", async ({ page, harness, context, extId }) => {
  await login(page, context, extId, harness.api);
  await page.goto(`${harness.origin}/product/edit/1732672081725400001`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.locator("#mm-hero-cost").fill("8");
  await panel.getByRole("button", { name: "See my profit" }).click();
  await panel.getByRole("button", { name: "Your costs" }).click();
  await expect(panel.getByText("COGS is the supplier price")).toBeVisible();
  await panel.getByRole("button", { name: "← Back" }).click();
  await expect(panel.getByText("Your costs").first()).toBeVisible();
});
