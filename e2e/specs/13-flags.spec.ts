import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../support/fixtures";
import { email, makePro, remoteDoc, seedToken, signRemote } from "../support/session";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const flags = JSON.parse(readFileSync(path.join(root, "src", "flags.json"), "utf8")) as Record<string, { enabled: boolean }>;

test("E-FLAG-overlay the bundled overlay flag shows the panel", async ({ page, harness, overlay }) => {
  expect(flags.overlay.enabled).toBe(true);
  await page.goto(`${harness.origin}/product/edit/real`);
  await expect(overlay(page)).toBeAttached();
});

test("E-FLAG-productCheck product check has no separate broken entry while the flag is on", async ({ page, harness, overlay }) => {
  expect(flags.productCheck.enabled).toBe(true);
  await page.goto(`${harness.origin}/product/edit/real`);
  await expect(overlay(page).getByText("$36.00")).toBeVisible();
});

test("E-FLAG-statementImport statement import is available", async ({ page, harness, context, extId }) => {
  expect(flags.statementImport.enabled).toBe(true);
  const user = await harness.api.registerApi(email());
  await makePro(harness.api, user.userId);
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/lab/product/manage/`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Products" }).click();
  await expect(panel.getByLabel("Import statement")).toBeVisible();
});

test("E-FLAG-promoGuard a loss shows the promo guard chip", async ({ page, harness, overlay }) => {
  expect(flags.promoGuard.enabled).toBe(true);
  await page.goto(`${harness.origin}/product/edit/1732672081725400001`);
  const panel = overlay(page);
  await panel.locator("#mm-hero-cost").fill("80");
  await panel.getByRole("button", { name: "See my profit" }).click();
  await expect(page.locator("#marginguard-price-guard")).toHaveCount(1);
});

test("E-FLAG-creatorProfit creator commission is on the cost grid", async ({ page, harness, context, extId }) => {
  expect(flags.creatorProfit.enabled).toBe(true);
  const user = await harness.api.registerApi(email());
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/product/edit/1732672081725400001`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.locator("#mm-hero-cost").fill("8");
  await panel.getByRole("button", { name: "See my profit" }).click();
  await expect(panel.getByRole("spinbutton", { name: "Creator commission" })).toBeVisible();
});

test("E-FLAG-bulkCost bulk cost has no separate paste control in the panel", async ({ page, harness, overlay }) => {
  expect(flags.bulkCost.enabled).toBe(true);
  await page.goto(`${harness.origin}/product/manage`);
  await expect(overlay(page).getByText("Paste costs")).toHaveCount(0);
});

test("E-FLAG-aiInsights AI insights stay hidden while the flag is off", async ({ page, harness, overlay }) => {
  expect(flags.aiInsights.enabled).toBe(false);
  await page.goto(`${harness.origin}/product/edit/real`);
  await expect(overlay(page).getByText("AI insight")).toHaveCount(0);
});

test("E-FLAG-trendsTelemetry trends telemetry has no view while the flag is off", async ({ page, harness, overlay }) => {
  expect(flags.trendsTelemetry.enabled).toBe(false);
  await page.goto(`${harness.origin}/product/edit/real`);
  await expect(overlay(page).getByText("Trending products")).toHaveCount(0);
});

test("E-FLAG-trendsView the trends view stays hidden", async ({ page, harness, overlay }) => {
  expect(flags.trendsView.enabled).toBe(false);
  await page.goto(`${harness.origin}/product/edit/real`);
  await expect(overlay(page).getByRole("button", { name: "Trends" })).toHaveCount(0);
});

test("E-FLAG-bulkScan bulk scan stays hidden", async ({ page, harness, overlay }) => {
  expect(flags.bulkScan.enabled).toBe(false);
  await page.goto(`${harness.origin}/product/manage`);
  await expect(overlay(page).getByText("Bulk scan")).toHaveCount(0);
});

test("E-FLAG-whatIf the what-if panel appears only after a signed config turns it on", async ({ page, harness, context, extId, extPage }) => {
  expect(flags.whatIf.enabled).toBe(false);
  const user = await harness.api.registerApi(email());
  await makePro(harness.api, user.userId);
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/product/edit/1732672081725400001`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.locator("#mm-hero-cost").fill("8");
  await panel.getByRole("button", { name: "See my profit" }).click();
  await expect(panel.getByText("What if I change…")).toHaveCount(0);
  const signed = signRemote(remoteDoc({ flags: { whatIf: { enabled: true, rolloutPct: 100 } } }));
  await harness.api.publishConfig(signed);
  await extPage.evaluate(async () => {
    const res = await fetch("http://127.0.0.1:8000/config/remote");
    await chrome.storage.local.set({ remoteConfigCache: await res.json() });
  });
  await page.reload();
  await expect(panel.getByText("What if I change…")).toBeVisible();
});

test("E-FLAG-csvExport export appears only after a signed config turns it on", async ({ page, harness, context, extId, extPage }) => {
  expect(flags.csvExport.enabled).toBe(false);
  const user = await harness.api.registerApi(email());
  await makePro(harness.api, user.userId);
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/lab/product/manage/`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Products" }).click();
  await expect(panel.getByRole("button", { name: "Export CSV" })).toHaveCount(0);
  const signed = signRemote(remoteDoc({ flags: { csvExport: { enabled: true, rolloutPct: 100 } } }));
  await harness.api.publishConfig(signed);
  await extPage.evaluate(async () => {
    const res = await fetch("http://127.0.0.1:8000/config/remote");
    await chrome.storage.local.set({ remoteConfigCache: await res.json() });
  });
  await page.reload();
  await panel.getByRole("button", { name: "Products" }).click();
  await expect(panel.getByRole("button", { name: "Export CSV" })).toBeVisible();
});

test("E-FLAG-diamondEnabled Diamond appears only after a signed config turns it on", async ({ page, harness, context, extId, extPage }) => {
  expect(flags.diamondEnabled.enabled).toBe(false);
  const user = await harness.api.registerApi(email());
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Upgrade" }).click();
  await expect(panel.getByText(/^Diamond/)).toHaveCount(0);
  const signed = signRemote(remoteDoc({ flags: { diamondEnabled: { enabled: true, rolloutPct: 100 } } }));
  await harness.api.publishConfig(signed);
  await extPage.evaluate(async () => {
    const res = await fetch("http://127.0.0.1:8000/config/remote");
    await chrome.storage.local.set({ remoteConfigCache: await res.json() });
  });
  await page.reload();
  await panel.getByRole("button", { name: "Upgrade" }).click();
  await expect(panel.getByText(/Diamond ·/)).toBeVisible();
});
