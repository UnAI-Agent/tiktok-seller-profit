import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "@playwright/test";
import { pythonCommand } from "../../scripts/python-cmd.mjs";
import type { Api } from "./backend";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let n = 0;

export function email(): string {
  n += 1;
  return `e2e+${Date.now()}-${n}@e2e.test`;
}

export const PASSWORD = "Valid-pass-1";

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

export async function openSeller(page: Page, origin: string, urlPath: string): Promise<void> {
  await page.goto(`${origin}${urlPath}`);
}

export function panel(page: Page) {
  return page.locator("#tiktok-seller-tool-root");
}
