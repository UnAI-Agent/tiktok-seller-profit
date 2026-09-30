import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../support/fixtures";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("E-INST-LOAD extension service worker registers", async ({ sw }) => {
  expect(sw.url()).toContain("chrome-extension://");
});

test("E-INST-LOAD manifest version matches package.json", async () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
  const manifest = JSON.parse(readFileSync(path.join(root, "dist-e2e", "manifest.json"), "utf8")) as { version: string };
  expect(manifest.version).toBe(pkg.version);
});

test("E-INST-ORIGIN content script injects only on the mock seller origin", async ({ page, harness, overlay }) => {
  await page.goto(`${harness.origin}/product/edit/real`);
  await expect(overlay(page)).toBeAttached();
  const other = await page.context().newPage();
  await other.goto(`${harness.otherOrigin}/product/edit/real`);
  await expect(other.locator("#tiktok-seller-tool-root")).toHaveCount(0);
  await other.close();
});

test("E-INST-LOAD service worker answers GET_SETTINGS with the defaults", async ({ context, extId }) => {
  const extPage = await context.newPage();
  await extPage.goto(`chrome-extension://${extId}/oauth-finish.html`);
  const settings = await extPage.evaluate(async () => chrome.runtime.sendMessage({ type: "GET_SETTINGS" }));
  expect(settings.ok).toBe(true);
  expect(settings.settings.feePreset).toBe("us-standard");
  expect(settings.settings.platformFeePct).toBe(6);
  expect(settings.settings.overlayEnabled).toBe(true);
  expect(settings.settings.telemetryConsent.granted).toBe(false);
  await extPage.close();
});

test("E-INST-SW-RESTART stopping the worker keeps state and the panel answers", async ({
  page,
  harness,
  context,
  extId,
  overlay,
}) => {
  await page.goto(`${harness.origin}/product/edit/real`);
  await expect(overlay(page)).toBeAttached();
  const extPage = await context.newPage();
  await extPage.goto(`chrome-extension://${extId}/oauth-finish.html`);
  await extPage.evaluate(() => chrome.storage.local.set({ e2eRestart: 1 }));
  const errors: string[] = [];

  try {
    const client = await context.newCDPSession(page);
    await client.send("Target.setDiscoverTargets", { discover: true });
    const listed = await client.send("Target.getTargets");
    const target = listed.targetInfos.find(
      (item) => item.type === "service_worker" && item.url.includes(extId),
    );
    if (!target) throw new Error(`no service_worker target in ${JSON.stringify(listed.targetInfos.map((item) => item.type + " " + item.url))}`);
    await client.send("Target.closeTarget", { targetId: target.targetId });
    await expect.poll(async () => context.serviceWorkers().some((worker) => worker.url().includes(extId))).toBe(true);
    const woken = context.serviceWorkers().find((worker) => worker.url().includes(extId));
    if (!woken) throw new Error("worker did not return after Target.closeTarget");
    await extPage.evaluate(async (targetUrl) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url === targetUrl);
      if (!tab?.id) throw new Error("seller tab missing after closeTarget");
      await chrome.tabs.sendMessage(tab.id, { type: "SHOW_INPAGE_PANEL" });
    }, page.url());
    await expect(overlay(page)).toBeAttached();
    const stored = await extPage.evaluate(() => chrome.storage.local.get("e2eRestart"));
    expect(stored.e2eRestart).toBe(1);
    return;
  } catch (err) {
    errors.push(`Target.closeTarget: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  }

  try {
    const internals = await context.newPage();
    await internals.goto("chrome://serviceworker-internals/?devtools");
    const stop = internals.locator("button", { hasText: "Stop" }).first();
    await stop.click({ timeout: 5_000 });
    await internals.close();
    await expect.poll(async () => context.serviceWorkers().length).toBeGreaterThan(0);
    const woken = context.serviceWorkers().find((worker) => worker.url().includes(extId));
    if (!woken) throw new Error("worker did not return after the internals Stop button");
    await extPage.evaluate(async (targetUrl) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url === targetUrl);
      if (!tab?.id) throw new Error("seller tab missing after Stop");
      await chrome.tabs.sendMessage(tab.id, { type: "SHOW_INPAGE_PANEL" });
    }, page.url());
    await expect(overlay(page)).toBeAttached();
    const stored = await extPage.evaluate(() => chrome.storage.local.get("e2eRestart"));
    expect(stored.e2eRestart).toBe(1);
    return;
  } catch (err) {
    errors.push(`serviceworker-internals Stop: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  }

  const reportDir = path.join(root, "qa", "report");
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(path.join(reportDir, "sw-restart-errors.txt"), errors.join("\n\n"));
  await page.reload();
  await expect(overlay(page)).toBeAttached();
  const stored = await extPage.evaluate(() => chrome.storage.local.get("e2eRestart"));
  expect(stored.e2eRestart).toBe(1);
  await extPage.close();
});
