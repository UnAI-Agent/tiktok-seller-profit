import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { pythonCommand } from "../../scripts/python-cmd.mjs";
import type { Api } from "./backend";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let n = 0;

export function email(): string {
  n += 1;
  return `e2e+${Date.now()}-${n}@e2e.test`;
}

export const PASSWORD = "Valid-pass-1";

/** Click a control that removes itself. locator.click() retries until the test timeout. */
export async function clickLeaving(control: Locator): Promise<void> {
  await expect(control).toBeEnabled();
  await control.evaluate((el: HTMLElement) => el.click());
}

export async function wipeExtension(context: BrowserContext, extId: string, keep?: Page): Promise<void> {
  const keepUrl = keep?.url() ?? "";
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/oauth-finish.html`);
  // A previous overlay can still be open and will write its SKUs and session back
  // after a setup clear. Close those tabs, then drop storage. Keep the page under test.
  await page.evaluate(async (current) => {
    const tabs = await chrome.tabs.query({});
    const ids = tabs
      .filter((item) => (item.url ?? "").includes("/product/") && item.url !== current && item.id != null)
      .map((item) => item.id as number);
    if (ids.length) await chrome.tabs.remove(ids);
    await new Promise<void>((resolve) => chrome.storage.local.clear(resolve));
  }, keepUrl);
  await page.close();
}

export async function seedToken(context: BrowserContext, extId: string, token: string, keep?: Page): Promise<void> {
  await wipeExtension(context, extId, keep);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/oauth-finish.html`);
  await page.evaluate((value) => chrome.storage.local.set({ authToken: value }), token);
  await page.close();
}

export async function makePro(api: Api, userId: number): Promise<void> {
  const res = await api.webhook("checkout.session.completed", {
    id: "cs_e2e",
    object: "checkout.session",
    client_reference_id: String(userId),
    subscription: `sub_e2e_${userId}`,
    metadata: { user_id: String(userId), tier: "pro" },
  });
  if (!res.ok) throw new Error(`webhook ${res.status} ${await res.text()}`);
}

export async function sinkMessages(): Promise<{ to: string; subject?: string; body: string }[]> {
  const res = await fetch("http://127.0.0.1:1026/");
  return (await res.json()) as { to: string; subject?: string; body: string }[];
}

export async function codeFor(address: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  let last = "";
  while (Date.now() < deadline) {
    const messages = await sinkMessages();
    last = messages.map((msg) => msg.subject ?? "").join(",");
    const mine = [...messages].reverse().find((msg) => {
      const blob = `${msg.to}\n${msg.body}`.toLowerCase();
      return blob.includes(address.toLowerCase()) && /\b\d{6}\b/.test(msg.body);
    });
    const code = mine?.body.match(/\b(\d{6})\b/)?.[1];
    if (code) return code;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`no code for ${address} (subjects: ${last})`);
}

export function remoteDoc(patch: {
  flags?: Record<string, { enabled: boolean; rolloutPct: number }>;
  selectors?: Record<string, unknown>;
} = {}): unknown {
  const bundled = JSON.parse(readFileSync(path.join(root, "src", "flags.json"), "utf8")) as Record<
    string,
    { enabled: boolean; rolloutPct: number }
  >;
  const flags: Record<string, { enabled: boolean; rolloutPct: number }> = {};
  for (const [key, value] of Object.entries(bundled)) flags[key] = { enabled: value.enabled, rolloutPct: value.rolloutPct };
  Object.assign(flags, patch.flags ?? {});
  return {
    version: 1,
    issuedAt: "2026-09-27T00:00:00Z",
    expiresAt: "2027-09-27T00:00:00Z",
    minSupportedVersion: "1.3.0",
    flags,
    feePresets: {},
    selectors: patch.selectors ?? {},
    thresholds: { founderSlotsLeft: 1 },
    messages: {},
  };
}

export function signRemote(doc: unknown): unknown {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mm-sign-"));
  const input = path.join(dir, "config.json");
  writeFileSync(input, JSON.stringify(doc));
  const keyPath = readFileSync(path.join(root, "qa", "report", "e2e-key-path.txt"), "utf8").trim();
  const py = pythonCommand();
  const signed = execFileSync(py.cmd, [...py.prefix, path.join(root, "scripts", "sign-config.py"), input, keyPath], {
    cwd: root,
    encoding: "utf8",
  });
  return JSON.parse(signed);
}

/**
 * Publish a signed config and wait until the extension caches it.
 * Asks the worker to run the same fetch the 15-minute alarm uses, because
 * Chrome will not fire an alarm 50ms from now.
 */
/** Flags as a stable string: the worker stores them with sorted keys. */
function flagsKey(flags: unknown): string {
  const record = (flags ?? {}) as Record<string, { enabled: boolean; rolloutPct: number }>;
  return JSON.stringify(Object.keys(record).sort().map((key) => [key, record[key].enabled, record[key].rolloutPct]));
}

export async function pushRemoteConfig(api: Api, extPage: Page, doc: unknown): Promise<void> {
  const want = flagsKey((doc as { flags?: unknown }).flags);
  await api.publishConfig(signRemote(doc));
  const deadline = Date.now() + 15_000;
  let last = "";
  while (Date.now() < deadline) {
    // Chrome delays alarms shorter than ~30s, so ask the worker to fetch now.
    // That is the same refreshRemoteConfig the 15-minute alarm runs.
    const reply = await extPage.evaluate(() => chrome.runtime.sendMessage({ type: "REFRESH_REMOTE_CONFIG" }));
    const cached = await extPage.evaluate(() => chrome.storage.local.get("remoteConfigCache"));
    const flags = (cached.remoteConfigCache as { flags?: unknown } | undefined)?.flags;
    last = `reply=${JSON.stringify(reply)} cached=${JSON.stringify(flags ?? null)}`;
    if (flags && flagsKey(flags) === want) return;
  }
  throw new Error(`the extension did not cache the published config within 15s (${last})`);
}

/** Publish the bundled flags again so a kill-switch test cannot leak into later tests (the worker re-fetches on wake). */
export async function restoreBundledConfig(api: Api): Promise<void> {
  await api.publishConfig(signRemote(remoteDoc()));
}

export async function openSeller(page: Page, origin: string, urlPath: string): Promise<void> {
  await page.goto(`${origin}${urlPath}`);
}

export function panel(page: Page) {
  return page.locator("#tiktok-seller-tool-root");
}

/**
 * Upgrade the way a real purchase does: Stripe's signed checkout webhook, then
 * the seller lands on the success page (Stripe's success_url). The extension
 * refreshes the plan on that page, so open panels unlock without a reload.
 */
export async function upgradeLikeStripe(api: Api, context: BrowserContext, userId: number): Promise<void> {
  await makePro(api, userId);
  const done = await context.newPage();
  await done.goto("http://127.0.0.1:8000/billing/done?ok=1");
  // Named wait: the worker refreshes on the tab's "complete" event; give it one round trip.
  await done.waitForTimeout(1500);
  await done.close();
}

/** Cancel the subscription the way Stripe reports it, then let the extension re-read the plan. */
export async function cancelLikeStripe(api: Api, context: BrowserContext, userId: number): Promise<void> {
  const res = await api.webhook("customer.subscription.deleted", {
    id: `sub_e2e_${userId}`,
    object: "subscription",
    status: "canceled",
  });
  if (!res.ok) throw new Error(`webhook ${res.status} ${await res.text()}`);
  // A cancel has no success page; the seller sees it on the next plan check. Force one.
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:8000/billing/done?ok=1");
  await page.waitForTimeout(1500);
  await page.close();
}
