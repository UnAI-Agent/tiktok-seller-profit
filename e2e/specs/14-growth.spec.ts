import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { formatSignedUsd } from "../../src/lib/profit";
import { expect, test } from "../support/fixtures";
import { clickLeaving, email, makePro, seedToken } from "../support/session";

/**
 * The features that make a seller pay: creators, the weekly recap, SPS alerts,
 * bulk costs, the value receipt, a plan that unlocks by itself after checkout,
 * one number per product everywhere, and a panel that stays quiet on the network.
 * Every expected number comes from test-fixtures/lab/expected.json, written by
 * scripts/answer-key.py (which never imports the extension's code).
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
type Product = { key: string; skuId: string; title: string; cogsPerUnit: number; adsPerUnit: number; packagingPerUnit: number; net: number | null };
type Creator = { creator: string; net: number | null; verdict: string; label: string };
const key = JSON.parse(readFileSync(path.join(root, "test-fixtures", "lab", "expected.json"), "utf8")) as {
  products: Product[];
  creators: Creator[];
};
const AFFILIATE_CSV = path.join(root, "test-fixtures", "lab", "affiliate-orders.csv");

function product(k: string): Product {
  const found = key.products.find((row) => row.key === k);
  if (!found) throw new Error(`answer key has no product ${k}`);
  return found;
}

/** "sku, cost" lines for every product with a cost in the key (G has none). */
function pasteLines(override: Record<string, number> = {}): string {
  return key.products
    .filter((row) => row.cogsPerUnit > 0)
    .map((row) => `${row.skuId}, ${override[row.key] ?? row.cogsPerUnit}`)
    .join("\n");
}

async function openLab(page: Page, origin: string): Promise<Locator> {
  await page.goto(`${origin}/lab/product/manage/`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Products" }).click();
  await panel.getByRole("button", { name: /Sync/ }).first().click();
  await expect(panel.getByText(/Imported 10 from this page/)).toBeVisible({ timeout: 10_000 });
  return panel;
}

/** A field of a saved product, read from the extension's storage (what every screen reads). */
async function storedSku(extPage: Page, skuId: string, field: string): Promise<unknown> {
  const { skus } = (await extPage.evaluate(() => chrome.storage.local.get("skus"))) as { skus?: Record<string, Record<string, unknown>> };
  return skus?.[skuId]?.[field];
}

async function paste(panel: Locator, text: string): Promise<void> {
  await panel.getByRole("button", { name: /Paste costs for many products/ }).click();
  await panel.getByLabel("Costs to paste").fill(text);
  await panel.getByRole("button", { name: "Save costs" }).click();
}

test("E-BULK-COST pasted costs save for matching products and stop at the free limit", async ({ page, harness, context, extId }) => {
  const user = await harness.api.registerApi(email());
  await seedToken(context, extId, user.token);
  const panel = await openLab(page, harness.origin);
  // Mixed separators, as sellers paste them from sheets: comma, semicolon, tab.
  const lines = pasteLines().split("\n");
  lines[1] = lines[1].replace(", ", "; ");
  lines[2] = lines[2].replace(", ", "\t");
  await paste(panel, [...lines, "nope-sku, 3"].join("\n"));
  await expect(panel.getByText("Saved costs for 5 products.")).toBeVisible();
  await expect(panel.getByText(/4 more hit the free limit/)).toBeVisible();
  await expect(panel.getByText(/Not found: nope-sku/)).toBeVisible();
  // The five that saved now have a number; the rest still ask for a cost.
  const withCost = await panel.locator("li[data-sku-id]:not([data-tone='missing'])").count();
  expect(withCost).toBe(5);
  await expect(panel.getByText("Free costs saved: 5/5", { exact: false })).toBeVisible();
});

test("E-VALUE-RECEIPT a Free seller sees what MarginMark found before the paywall", async ({ page, harness, context, extId }) => {
  const user = await harness.api.registerApi(email());
  await seedToken(context, extId, user.token);
  const panel = await openLab(page, harness.origin);
  // B at $25 a unit loses money at its promo price; the other four are profitable on cost alone.
  await paste(panel, pasteLines({ B: 25 }));
  await expect(panel.getByText("Saved costs for 5 products.")).toBeVisible();
  await expect(panel.getByText(/1 product is losing money\. Pro shows the exact fix\./)).toBeVisible();
  await expect(panel.locator(`li[data-sku-id="${product("B").skuId}"]`)).toHaveAttribute("data-tone", "loss");

  // The sixth cost hits the limit, and the limit message carries the finding.
  const F = product("F");
  await page.goto(`${harness.origin}/product/edit/${F.skuId}`);
  await panel.locator("#mm-hero-cost").fill(String(F.cogsPerUnit));
  await clickLeaving(panel.getByRole("button", { name: "See my profit" }));
  await expect(panel.getByText("You've used all your free product costs.")).toBeVisible();
  // The lab list has no sales counts, so the finding is per sale rather than dollars lost so far.
  await expect(panel.getByText("1 of your products loses money on every sale. Pro shows the fix.")).toBeVisible();
});

test("E-COST-CONSISTENT a product's net is the same on its page, the Products tab and the board", async ({ page, harness, context, extId, extPage }) => {
  const user = await harness.api.registerApi(email());
  await makePro(harness.api, user.userId);
  await seedToken(context, extId, user.token);
  const panel = await openLab(page, harness.origin);
  const D = product("D");
  await page.goto(`${harness.origin}/product/edit/${D.skuId}`);
  await panel.locator("#mm-hero-cost").fill(String(D.cogsPerUnit));
  await clickLeaving(panel.getByRole("button", { name: "See my profit" }));
  const ads = panel.getByRole("spinbutton", { name: "Ads per order" });
  await ads.fill(String(D.adsPerUnit));
  await ads.blur();
  const hero = panel.getByTestId("hero-net");
  // D has no packaging or commission, so its product-page number is the answer key's.
  await expect(hero).toHaveAttribute("data-net", D.net!.toFixed(2));
  const net = (await hero.getAttribute("data-net"))!;
  await expect(hero).toHaveText(formatSignedUsd(Number(net)));

  // Leave at once, inside the 400ms autosave wait: the edit must still be saved.
  await page.goto(`${harness.origin}/lab/product/manage/`);
  await expect.poll(() => storedSku(extPage, D.skuId, "adsPerUnit")).toBe(D.adsPerUnit);
  // Same product, from the list page: the Products tab and the board must agree to the cent.
  await panel.getByRole("button", { name: "Overview" }).click();
  await expect(panel.locator(`[data-board-sku="${D.skuId}"]`)).toHaveAttribute("data-net", net);
  await panel.getByRole("button", { name: "Products" }).click();
  await expect(panel.locator(`li[data-sku-id="${D.skuId}"]`)).toHaveAttribute("data-net", net);
});

test("E-CREATORS-FREE Free sees creator totals and a lock on the per-creator detail", async ({ page, harness, context, extId }) => {
  const user = await harness.api.registerApi(email());
  await seedToken(context, extId, user.token);
  const panel = await openLab(page, harness.origin);
  await panel.getByRole("button", { name: "Creators" }).click();
  await panel.getByLabel("Creator orders file").setInputFiles(AFFILIATE_CSV);
  await expect(panel.getByText("Match your columns")).toBeVisible();
  await expect(panel.getByLabel("Creator", { exact: true })).toHaveValue("Creator Username");
  await panel.getByRole("button", { name: "Show creator profit" }).click();
  await expect(panel.getByText(`Imported 45 orders from ${key.creators.length} creators`, { exact: false })).toBeVisible();
  await expect(panel.getByTestId("creator-summary")).toBeVisible();
  await expect(panel.locator('[data-pro-lock="creators"]')).toHaveCount(1);
  // Free never sees which creator loses money.
  await expect(panel.locator("li[data-creator]")).toHaveCount(0);
});

test("E-CREATORS-PRO Pro sees profit and a verdict for every creator, matching the answer key", async ({ page, harness, context, extId, extPage }) => {
  test.setTimeout(120_000);
  const user = await harness.api.registerApi(email());
  await makePro(harness.api, user.userId);
  await seedToken(context, extId, user.token);
  const panel = await openLab(page, harness.origin);
  await paste(panel, pasteLines());
  await expect(panel.getByText("Saved costs for 9 products.")).toBeVisible();
  // Packaging is typed on the product page (the paste sets purchase cost only).
  for (const row of key.products.filter((p) => p.packagingPerUnit > 0)) {
    await page.goto(`${harness.origin}/product/edit/${row.skuId}`);
    // The pasted cost has loaded once the headline number shows; type after that, as a person would.
    await expect(panel.getByTestId("hero-net")).toBeVisible();
    const field = panel.getByRole("spinbutton", { name: "Packaging" });
    await field.fill(String(row.packagingPerUnit));
    await field.blur();
    await expect.poll(() => storedSku(extPage, row.skuId, "packagingPerUnit")).toBe(row.packagingPerUnit);
  }
  await page.goto(`${harness.origin}/lab/product/manage/`);
  await panel.getByRole("button", { name: "Creators" }).click();
  await panel.getByLabel("Creator orders file").setInputFiles(AFFILIATE_CSV);
  await panel.getByRole("button", { name: "Show creator profit" }).click();
  await expect(panel.getByText(/Imported 45 orders/)).toBeVisible();

  const rows = panel.locator("li[data-creator]");
  await expect(rows).toHaveCount(key.creators.length);
  expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-creator")))).toEqual(key.creators.map((c) => c.creator));
  for (const creator of key.creators) {
    const row = panel.locator(`li[data-creator="${creator.creator}"]`);
    await expect(row, creator.creator).toHaveAttribute("data-verdict", creator.verdict);
    await expect(row).toContainText(creator.label);
    await expect(row).toContainText(creator.net == null ? "—" : formatSignedUsd(creator.net));
  }
  await expect(panel.locator('[data-pro-lock="creators"]')).toHaveCount(0);
});

test("E-RECAP the weekly recap names new losers and fixes against last week", async ({ page, harness, context, extId, extPage }) => {
  const user = await harness.api.registerApi(email());
  await makePro(harness.api, user.userId);
  await seedToken(context, extId, user.token);
  const panel = await openLab(page, harness.origin);
  await paste(panel, pasteLines({ B: 25 }));
  await panel.getByRole("button", { name: "Overview" }).click();
  const recap = panel.locator('section[aria-label="Weekly recap"]');
  await expect(recap).toContainText("Weekly recap starts now");

  // Pretend last week the coat was losing and the candle was fine.
  const H = product("H");
  const snaps = (await extPage.evaluate(() => chrome.storage.local.get("weeklySnapshots"))).weeklySnapshots as Array<{
    week: string;
    losingIds: string[];
    leakUsd: number;
  }>;
  expect(snaps?.length).toBe(1);
  const current = snaps[0];
  expect(current.losingIds).toContain(product("B").skuId);
  await extPage.evaluate((rows) => chrome.storage.local.set({ weeklySnapshots: rows }), [
    { ...current, week: "2026-W01", losingIds: [H.skuId], leakUsd: 0 },
    current,
  ]);
  await page.reload();
  await panel.getByRole("button", { name: "Overview" }).click();
  await expect(recap).toContainText("This week vs last week");
  await expect(recap).toContainText(product("B").title);
  await expect(recap).toContainText(`Fixed: ${H.title}`);
});

test("E-SPS-READ the Shop Performance Score is read from Account Health and kept", async ({ page, harness, context, extId, extPage }) => {
  const user = await harness.api.registerApi(email());
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/account/health/4.3`);
  const panel = page.locator("#tiktok-seller-tool-root");
  const strip = panel.locator("[data-sps-level]");
  await expect(strip).toHaveAttribute("data-sps-level", "top", { timeout: 15_000 });
  await expect(strip).toContainText("4.3");
  await expect.poll(async () => (await extPage.evaluate(() => chrome.storage.local.get("sps"))).sps?.score).toBe(4.3);

  // A page that shows no score ("Not enough orders") must not erase the last real one.
  await page.goto(`${harness.origin}/account/health/none`);
  await page.waitForTimeout(3_000); // the reader watches the page for a while; give it time to (wrongly) save
  expect((await extPage.evaluate(() => chrome.storage.local.get("sps"))).sps?.score).toBe(4.3);
});

test("E-SPS-WARN a score under 3.5 warns about affiliate access, under 2.5 about Flash Deals", async ({ page, harness, context, extId }) => {
  const user = await harness.api.registerApi(email());
  await seedToken(context, extId, user.token);
  const panel = page.locator("#tiktok-seller-tool-root");
  await page.goto(`${harness.origin}/account/health/3.2`);
  const strip = panel.locator("[data-sps-level]");
  await expect(strip).toHaveAttribute("data-sps-level", "at-risk", { timeout: 15_000 });
  await expect(strip).toContainText("One dip from losing creators");
  await page.goto(`${harness.origin}/account/health/2.4`);
  await expect(strip).toHaveAttribute("data-sps-level", "critical", { timeout: 15_000 });
  await expect(strip).toContainText("Flash Deals and Shop Ads are off");
  // The warning follows the seller to the product list.
  await page.goto(`${harness.origin}/lab/product/manage/`);
  await expect(strip).toHaveAttribute("data-sps-level", "critical");
});

test("E-BILL-CHECKOUT-POLL after checkout opens, Pro unlocks on the open panel with no return visit", async ({ page, harness, context, extId, extPage }) => {
  test.setTimeout(90_000);
  const user = await harness.api.registerApi(email());
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await expect(panel.getByRole("button", { name: "Upgrade" })).toBeVisible();
  await page.evaluate(() => {
    (window as { __mmNoReload?: number }).__mmNoReload = 1;
  });

  // What createCheckoutUrl sends once Stripe Checkout opens. The seller pays in that tab and never comes back.
  expect((await extPage.evaluate(() => chrome.runtime.sendMessage({ type: "CHECKOUT_STARTED" }))).ok).toBe(true);
  await makePro(harness.api, user.userId);
  // The poll runs every 30 seconds; the first tick must find the new plan.
  await expect(panel.getByText("Pro unlocked. Every lock is open.")).toBeVisible({ timeout: 45_000 });
  expect(await page.evaluate(() => (window as { __mmNoReload?: number }).__mmNoReload)).toBe(1);
  // Once Pro is seen, the poll stops.
  await expect.poll(async () => extPage.evaluate(async () => Boolean(await chrome.alarms.get("checkoutPoll")))).toBe(false);
});

test("E-NET-BUDGET an idle open panel calls /auth/me at most twice a minute", async ({ page, harness, context, extId }) => {
  test.skip(process.env.E2E_REUSE_API === "1", "skip:counts requests in the API log; unset E2E_REUSE_API");
  test.setTimeout(120_000);
  const user = await harness.api.registerApi(email());
  await makePro(harness.api, user.userId);
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await expect(panel.getByText("PRO", { exact: true })).toBeVisible();
  await page.waitForTimeout(5_000); // let sign-in and page-load refreshes finish
  harness.api.resetAuthMeCount();
  await page.waitForTimeout(60_000);
  // Before the fix the panel asked the server every 2 seconds: 30 calls a minute per open tab.
  expect(harness.api.authMeCount()).toBeLessThanOrEqual(2);
  await expect(panel.getByText("PRO", { exact: true })).toBeVisible();
});
