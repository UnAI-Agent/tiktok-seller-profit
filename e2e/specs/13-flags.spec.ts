import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../support/fixtures";
import { clickLeaving, email, makePro, pushRemoteConfig, remoteDoc, restoreBundledConfig, seedToken } from "../support/session";

/**
 * One test per live flag. Each proves two things: the feature is there with the
 * bundled flags, and a signed config with enabled:false hides it (the kill
 * switch works without a store release). Flags that ship off with no screen
 * are listed in qa/feature-map.json "deadFlags" instead of tested here.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const flags = JSON.parse(readFileSync(path.join(root, "src", "flags.json"), "utf8")) as Record<string, { enabled: boolean }>;
const LAB_PRODUCT = "1732672081725400001";

function kill(flag: string) {
  return remoteDoc({ flags: { [flag]: { enabled: false, rolloutPct: 0 } } });
}

// A kill-switch test publishes a config the worker re-fetches on every wake. Put the bundled one back.
test.afterEach(async ({ harness }) => {
  await restoreBundledConfig(harness.api);
});

test("E-FLAG-overlay the bundled overlay flag shows the panel", async ({ page, harness, overlay }) => {
  expect(flags.overlay.enabled).toBe(true);
  await page.goto(`${harness.origin}/product/edit/real`);
  await expect(overlay(page)).toBeAttached();
  await expect(overlay(page).getByText("$36.00").first()).toBeVisible();
});

test("E-FLAG-statementImport statement import is on, and the kill switch hides it", async ({ page, harness, context, extId, extPage }) => {
  expect(flags.statementImport.enabled).toBe(true);
  const user = await harness.api.registerApi(email());
  await makePro(harness.api, user.userId);
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/lab/product/manage/`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Products" }).click();
  await panel.getByRole("button", { name: /Sync/ }).first().click();
  await expect(panel.getByText(/Imported 10 from this page/)).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByLabel("Import statement")).toBeVisible();

  await pushRemoteConfig(harness.api, extPage, kill("statementImport"));
  await page.reload();
  await panel.getByRole("button", { name: "Products" }).click();
  // Same screen, still rendered (CSV export sits where the import was)…
  await expect(panel.getByRole("button", { name: "Export CSV" })).toBeVisible();
  // …but the import is gone.
  await expect(panel.getByLabel("Import statement")).toHaveCount(0);
});

test("E-FLAG-promoGuard a loss puts the chip by the price field, and the kill switch removes it", async ({ page, harness, extPage, overlay }) => {
  expect(flags.promoGuard.enabled).toBe(true);
  await page.goto(`${harness.origin}/product/edit/${LAB_PRODUCT}`);
  const panel = overlay(page);
  await panel.locator("#mm-hero-cost").fill("80");
  await clickLeaving(panel.getByRole("button", { name: "See my profit" }));
  await expect(page.locator("#marginguard-price-guard")).toHaveCount(1);

  await pushRemoteConfig(harness.api, extPage, kill("promoGuard"));
  await page.reload();
  await expect(panel.getByText("You keep per sale").first()).toBeVisible();
  // The panel still shows the loss; only the chip on TikTok's page is gone.
  await expect(panel.getByText(/losing|loss/i).first()).toBeVisible();
  await expect(page.locator("#marginguard-price-guard")).toHaveCount(0);
});

test("E-FLAG-creatorProfit the Creators tab is on, and the kill switch hides it", async ({ page, harness, context, extId, extPage }) => {
  expect(flags.creatorProfit.enabled).toBe(true);
  const user = await harness.api.registerApi(email());
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/lab/product/manage/`);
  const panel = page.locator("#tiktok-seller-tool-root");
  const nav = panel.locator('nav[aria-label="MarginMark sections"]');
  await expect(nav.getByRole("button", { name: "Creators" })).toBeVisible();
  await nav.getByRole("button", { name: "Creators" }).click();
  await expect(panel.getByLabel("Creator orders file")).toBeAttached();

  await pushRemoteConfig(harness.api, extPage, kill("creatorProfit"));
  await page.reload();
  await expect(nav.getByRole("button", { name: "Products" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Creators" })).toHaveCount(0);
});

test("E-FLAG-bulkCost the paste box is on for Free, and the kill switch hides it", async ({ page, harness, context, extId, extPage }) => {
  expect(flags.bulkCost.enabled).toBe(true);
  const user = await harness.api.registerApi(email());
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/lab/product/manage/`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Products" }).click();
  await panel.getByRole("button", { name: /Sync/ }).first().click();
  await expect(panel.getByText(/Imported 10 from this page/)).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByRole("button", { name: /Paste costs for many products/ })).toBeVisible();

  await pushRemoteConfig(harness.api, extPage, kill("bulkCost"));
  await page.reload();
  await panel.getByRole("button", { name: "Products" }).click();
  // The Free statement upsell renders right after where the paste box was.
  await expect(panel.getByText("Use your real TikTok fees")).toBeVisible();
  await expect(panel.getByRole("button", { name: /Paste costs for many products/ })).toHaveCount(0);
});

test("E-FLAG-whatIf what-if is on for Pro, and the kill switch hides it", async ({ page, harness, context, extId, extPage }) => {
  expect(flags.whatIf.enabled).toBe(true);
  const user = await harness.api.registerApi(email());
  await makePro(harness.api, user.userId);
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/product/edit/${LAB_PRODUCT}`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.locator("#mm-hero-cost").fill("8");
  await clickLeaving(panel.getByRole("button", { name: "See my profit" }));
  await expect(panel.getByText("What if I change…")).toBeVisible();

  await pushRemoteConfig(harness.api, extPage, kill("whatIf"));
  await page.reload();
  await expect(panel.getByText("You keep per sale").first()).toBeVisible();
  await expect(panel.getByText("What if I change…")).toHaveCount(0);
});

test("E-FLAG-csvExport CSV export is on for Pro, and the kill switch hides it", async ({ page, harness, context, extId, extPage }) => {
  expect(flags.csvExport.enabled).toBe(true);
  const user = await harness.api.registerApi(email());
  await makePro(harness.api, user.userId);
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/lab/product/manage/`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Products" }).click();
  await panel.getByRole("button", { name: /Sync/ }).first().click();
  await expect(panel.getByText(/Imported 10 from this page/)).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByRole("button", { name: "Export CSV" })).toBeVisible();

  await pushRemoteConfig(harness.api, extPage, kill("csvExport"));
  await page.reload();
  await panel.getByRole("button", { name: "Products" }).click();
  await expect(panel.getByLabel("Import statement")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Export CSV" })).toHaveCount(0);
});

test("E-FLAG-diamondEnabled Diamond appears only after a signed config turns it on", async ({ page, harness, context, extId, extPage }) => {
  expect(flags.diamondEnabled.enabled).toBe(false);
  const user = await harness.api.registerApi(email());
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Upgrade" }).click();
  await expect(panel.getByText(/\$14\.99/).first()).toBeVisible();
  await expect(panel.getByText(/^Diamond/)).toHaveCount(0);

  await pushRemoteConfig(harness.api, extPage, remoteDoc({ flags: { diamondEnabled: { enabled: true, rolloutPct: 100 } } }));
  await page.reload();
  await panel.getByRole("button", { name: "Upgrade" }).click();
  await expect(panel.getByText(/Diamond ·/)).toBeVisible();
});
