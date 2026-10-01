import { expect, test } from "../support/fixtures";
import { clickLeaving, email, makePro, remoteDoc, seedToken, signRemote } from "../support/session";

test("E-RES-API-DOWN a stopped API shows connection lost and the same profit", async ({ page, harness, context, extId }) => {
  const user = await harness.api.registerApi(email());
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/product/edit/1732672081725400001`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.locator("#mm-hero-cost").fill("8");
  await clickLeaving(panel.getByRole("button", { name: "See my profit" }));
  await expect(panel.getByText("Saved")).toBeVisible();
  const hero = panel.locator("p.text-3xl").first();
  const before = (await hero.textContent())?.trim() ?? "";
  expect(before).toMatch(/^[+-]\$\d/);
  await harness.api.down();
  try {
    await page.reload();
    await expect(panel.getByText("Connection lost. Check your internet.")).toBeVisible();
    await expect(panel.getByText("Profit on this page still works.")).toBeVisible();
    // The saved cost lives in the browser, so the same net shows with the API down.
    await expect(hero).toHaveText(before);
  } finally {
    await harness.api.up();
  }
});

test("E-RES-CACHED-PRO a cached Pro plan stays Pro while the API is down", async ({ page, harness, context, extId }) => {
  const user = await harness.api.registerApi(email());
  await makePro(harness.api, user.userId);
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await expect(panel.getByText("PRO", { exact: true })).toBeVisible();
  await harness.api.down();
  try {
    await page.reload();
    await expect(panel.getByRole("button", { name: "Upgrade" })).toHaveCount(0);
  } finally {
    await harness.api.up();
  }
});

test("E-RES-EXT-RELOAD reloading the extension does not flip Pro to Free", async ({ page, harness, context, extId }) => {
  const user = await harness.api.registerApi(email());
  await makePro(harness.api, user.userId);
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/product/edit/real`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await expect(panel.getByText("PRO", { exact: true })).toBeVisible();

  // Reload the extension the way a seller or an update does: chrome://extensions → Reload.
  // (chrome.runtime.reload() would close the Playwright context.)
  const manager = await context.newPage();
  // The list page (not ?id=) is where Chromium shows the Reload button; the test
  // profile holds only this extension, so there is exactly one.
  await manager.goto("chrome://extensions/");
  const devMode = manager.locator("#devMode");
  if ((await devMode.getAttribute("aria-pressed")) !== "true") await devMode.click();
  const reload = manager.locator("#dev-reload-button");
  await expect(reload).toHaveCount(1);
  await reload.first().click();
  await manager.close();

  await page.bringToFront();
  // The old content script is orphaned: it must say so and must not downgrade the plan.
  await expect(panel.getByText("Extension reloaded. Refresh this tab.")).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByRole("button", { name: "Upgrade" })).toHaveCount(0);
  await page.reload();
  await expect(panel.getByText("PRO", { exact: true })).toBeVisible();
});

test("E-RES-REMOTE-SELECTOR a signed remote selector reads a price the bundled selectors miss", async ({ page, harness, extPage }) => {
  const signed = signRemote(remoteDoc({
    selectors: { "product-edit": { version: 1, fields: { listPrice: { css: "[data-e2e-remote-price]" } } } },
  }));
  await harness.api.publishConfig(signed);
  // Same fetch the 15-minute alarm runs. A 50ms alarm does not fire in Chrome.
  const before = await extPage.evaluate(() => chrome.storage.local.get("remoteConfigCache"));
  await extPage.evaluate(() => chrome.runtime.sendMessage({ type: "REFRESH_REMOTE_CONFIG" }));
  await expect
    .poll(async () => JSON.stringify(await extPage.evaluate(() => chrome.storage.local.get("remoteConfigCache"))))
    .not.toBe(JSON.stringify(before));
  await page.goto(`${harness.origin}/product/edit/remote`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await expect(panel.getByText("$27.50").first()).toBeVisible();
});

test("E-RES-BAD-SIGNATURE a config with a bad signature is ignored", async ({ page, harness, extPage }) => {
  const doc = remoteDoc({
    selectors: { "product-edit": { version: 2, fields: { listPrice: { css: "[data-e2e-remote-price]" } } } },
  }) as { signature?: string };
  doc.signature = "a".repeat(64);
  await extPage.evaluate(async (value) => {
    await chrome.storage.local.set({ remoteConfigCache: value });
  }, doc);
  await page.goto(`${harness.origin}/product/edit/remote`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await expect(panel.getByText("$27.50")).toHaveCount(0);
  await expect(panel.getByLabel("Selling price")).toBeVisible();
});

test("E-RES-PERF the panel renders within 1.5s on the 50-row list", async ({ page, harness, overlay }) => {
  await page.goto(`${harness.origin}/product/manage-50`, { waitUntil: "domcontentloaded" });
  await expect(overlay(page)).toBeAttached({ timeout: 1500 });
});
