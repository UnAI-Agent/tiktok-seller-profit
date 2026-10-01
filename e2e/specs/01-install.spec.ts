import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "@playwright/test";
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

/** Chrome stops an idle MV3 worker after ~30s. Stop it on purpose and prove a new one takes over. */
async function workerTargetId(context: BrowserContext, page: Page, extId: string): Promise<string | null> {
  const client = await context.newCDPSession(page);
  try {
    const listed = await client.send("Target.getTargets");
    const target = listed.targetInfos.find((item) => item.type === "service_worker" && item.url.includes(extId));
    return target?.targetId ?? null;
  } finally {
    await client.detach().catch(() => undefined);
  }
}

async function stopWorker(context: BrowserContext, page: Page, extId: string, errors: string[]): Promise<string | null> {
  const targetId = await workerTargetId(context, page, extId);
  if (targetId) {
    const client = await context.newCDPSession(page);
    try {
      await client.send("Target.closeTarget", { targetId });
      return "Target.closeTarget";
    } catch (err) {
      errors.push(`Target.closeTarget: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await client.detach().catch(() => undefined);
    }
  } else {
    errors.push("no service_worker target listed");
  }
  try {
    const internals = await context.newPage();
    await internals.goto("chrome://serviceworker-internals/");
    await internals.locator("button", { hasText: "Stop" }).first().click({ timeout: 5_000 });
    await internals.close();
    return "serviceworker-internals Stop";
  } catch (err) {
    errors.push(`serviceworker-internals Stop: ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

test("E-INST-SW-RESTART a stopped worker is replaced, keeps state, and the panel works again", async ({
  page,
  harness,
  context,
  extId,
  extPage,
  overlay,
  togglePanel,
  sw,
}) => {
  await page.goto(`${harness.origin}/product/edit/real`);
  await expect(overlay(page)).toBeAttached();
  await extPage.evaluate(() => chrome.storage.local.set({ e2eRestart: 1 }));

  // Close the panel first, so seeing it again proves something happened after the restart.
  const reply = await extPage.evaluate(async (target) => {
    const tabs = await chrome.tabs.query({});
    const matches = tabs.filter((item) => item.url === target && item.id);
    if (!matches.length) return { error: "no tab", urls: tabs.map((item) => item.url ?? "") };
    const replies = [];
    for (const tab of matches) {
      try {
        replies.push(await chrome.tabs.sendMessage(tab.id!, { type: "TOGGLE_INPAGE_PANEL" }));
      } catch (err) {
        replies.push(String(err));
      }
    }
    return { tabs: matches.length, replies };
  }, page.url());
  await expect(overlay(page), `toggle reply ${JSON.stringify(reply)}`).toHaveCount(0);

  // Mark the running worker. Its globals die with it; a restarted worker starts clean.
  await sw.evaluate(() => {
    (globalThis as { __e2eMark?: string }).__e2eMark = "first";
  });
  const errors: string[] = [];
  const how = await stopWorker(context, page, extId, errors);

  if (!how) {
    const reportDir = path.join(root, "qa", "report");
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(path.join(reportDir, "sw-restart-errors.txt"), errors.join("\n\n"));
    test.info().annotations.push({ type: "sw-restart", description: "fallback: page reload (worker was not stopped)" });
    // A reload does not stop the worker, so it proves nothing about restarts. Fail unless allowed.
    expect(process.env.E2E_ALLOW_SW_FALLBACK, `could not stop the worker:\n${errors.join("\n")}`).toBe("1");
    await page.reload();
    await expect(overlay(page)).toBeAttached();
    return;
  }
  test.info().annotations.push({ type: "sw-restart", description: how });

  // Any extension event wakes a fresh worker, and it must answer.
  await expect
    .poll(async () => {
      const res = await extPage.evaluate(() => chrome.runtime.sendMessage({ type: "GET_SETTINGS" }).catch(() => null));
      return res?.ok === true;
    })
    .toBe(true);
  // …and it is a new worker: the first one's context is gone (or its mark is).
  const mark = await sw
    .evaluate(() => (globalThis as { __e2eMark?: string }).__e2eMark ?? "none")
    .catch((err: Error) => `stopped: ${err.message.split("\n")[0]}`);
  expect(mark, "the first worker is still running").not.toBe("first");

  // State survived, and the panel on the open tab comes back and reads through the new worker.
  expect((await extPage.evaluate(() => chrome.storage.local.get("e2eRestart"))).e2eRestart).toBe(1);
  await page.evaluate(() => {
    delete document.documentElement.dataset.mmClosedAt;
    sessionStorage.removeItem("tiktok-seller-tool-overlay-dismissed");
  });
  await togglePanel(page);
  await expect(overlay(page)).toBeAttached();
  await expect(overlay(page).getByText("$36.00").first()).toBeVisible();
});
