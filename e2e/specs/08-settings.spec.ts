import { computeProfit, formatSignedUsd } from "../../src/lib/profit";
import { expect, test } from "../support/fixtures";
import { clickLeaving, email, seedToken } from "../support/session";

async function loggedIn(page: import("@playwright/test").Page, context: import("@playwright/test").BrowserContext, extId: string, api: import("../support/backend").Api, origin: string) {
  const user = await api.registerApi(email());
  await seedToken(context, extId, user.token);
  await page.goto(`${origin}/product/edit/1732672081725400001`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.locator("#mm-hero-cost").fill("8");
  await clickLeaving(panel.getByRole("button", { name: "See my profit" }));
  await panel.getByRole("button", { name: "Settings" }).click();
  return panel;
}

test("E-SET-PRESETS fee presets change the net by the engine amount", async ({ page, harness, context, extId }) => {
  const panel = await loggedIn(page, context, extId, harness.api, harness.origin);
  await panel.getByLabel("TikTok fee preset").selectOption("us-jewelry");
  await panel.getByRole("button", { name: "Save settings" }).click();
  await panel.getByRole("button", { name: "Overview" }).click();
  const jewelry = computeProfit({
    listPrice: 39.99, unitsSold: 0, cogsPerUnit: 8, shippingOut: 0, adsPerUnit: 0,
    platformFeePct: 5, paymentFeePct: 0, paymentFixed: 0, refundRatePct: 3,
    packagingPerUnit: 0, affiliatePct: 10, affiliateSharePct: 100,
    includeRefundAdminFee: true,
  });
  await expect(panel.getByText(formatSignedUsd(jewelry.netPerUnit)).first()).toBeVisible();
});

test("E-SET-CUSTOM custom fees persist and show as custom", async ({ page, harness, context, extId }) => {
  const panel = await loggedIn(page, context, extId, harness.api, harness.origin);
  await panel.getByLabel("Platform fee %").fill("7");
  await panel.getByRole("button", { name: "Save settings" }).click();
  await expect(panel.getByLabel("TikTok fee preset")).toHaveValue("custom");
  await page.reload();
  await panel.getByRole("button", { name: "Settings" }).click();
  await expect(panel.getByLabel("TikTok fee preset")).toHaveValue("custom");
  await expect(panel.getByLabel("Platform fee %")).toHaveValue("7");
});

test("E-SET-TARGET target margin changes the verdict", async ({ page, harness, context, extId }) => {
  const panel = await loggedIn(page, context, extId, harness.api, harness.origin);
  await panel.getByLabel("Target margin %").fill("90");
  await panel.getByRole("button", { name: "Save settings" }).click();
  await panel.getByRole("button", { name: "Overview" }).click();
  await expect(panel.getByText("CAUTION")).toBeVisible();
});

test("E-SET-SHIPPING the shipping toggle shows the field and changes the net", async ({ page, harness, context, extId }) => {
  const panel = await loggedIn(page, context, extId, harness.api, harness.origin);
  await panel.getByRole("checkbox", { name: /Buyer pays shipping/ }).uncheck();
  await panel.getByRole("button", { name: "Save settings" }).click();
  await panel.getByRole("button", { name: "Overview" }).click();
  await expect(panel.getByLabel("Shipping label")).toBeVisible();
  await panel.getByLabel("Shipping label").fill("4");
  await panel.getByLabel("Shipping label").blur();
  const result = computeProfit({
    listPrice: 39.99, unitsSold: 0, cogsPerUnit: 8, shippingOut: 4, adsPerUnit: 0,
    platformFeePct: 6, paymentFeePct: 0, paymentFixed: 0, refundRatePct: 3,
    packagingPerUnit: 0, affiliatePct: 10, affiliateSharePct: 100,
    includeRefundAdminFee: true,
  });
  await expect(panel.getByText(formatSignedUsd(result.netPerUnit)).first()).toBeVisible();
});

test("E-SET-POSITION bottom-left pins the panel to the left", async ({ page, harness, context, extId, overlay }) => {
  const panel = await loggedIn(page, context, extId, harness.api, harness.origin);
  await panel.getByLabel("Panel position").selectOption("bottom-left");
  await panel.getByRole("button", { name: "Save settings" }).click();
  await expect.poll(async () => overlay(page).evaluate((el) => getComputedStyle(el).left)).toBe("16px");
});

test("E-SET-DISABLED turning the overlay off hides it until it is opened", async ({ page, harness, context, extId, overlay, openPanel }) => {
  const panel = await loggedIn(page, context, extId, harness.api, harness.origin);
  await panel.getByRole("checkbox", { name: /Show the profit panel/ }).uncheck();
  await panel.getByRole("button", { name: "Save settings" }).click();
  await page.reload();
  await expect(overlay(page)).toHaveCount(0);
  await openPanel(page);
  await expect(overlay(page)).toBeAttached();
});

test("E-SET-TRENDING-CONSENT trending consent is off and sends nothing while the flag is off", async ({ page, harness, context, extId }) => {
  const panel = await loggedIn(page, context, extId, harness.api, harness.origin);
  const box = panel.getByRole("checkbox", { name: /Share anonymous trending activity/ });
  await expect(box).not.toBeChecked();
  const before = await harness.api.telemetry();
  await box.check();
  await panel.getByRole("button", { name: "Save settings" }).click();
  await page.reload();
  const after = await harness.api.telemetry();
  expect(JSON.stringify(after)).toBe(JSON.stringify(before));
});

test("E-SET-PERSIST settings survive a reload", async ({ page, harness, context, extId }) => {
  const panel = await loggedIn(page, context, extId, harness.api, harness.origin);
  await panel.getByLabel("TikTok fee preset").selectOption("us-legacy");
  await panel.getByRole("button", { name: "Save settings" }).click();
  await page.reload();
  await panel.getByRole("button", { name: "Settings" }).click();
  await expect(panel.getByLabel("TikTok fee preset")).toHaveValue("us-legacy");
});
