import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startBackend, type Api } from "./backend";
import { startMockSeller } from "./mockSeller";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(root, "dist-e2e");

/**
 * Console lines that are expected. Each entry needs a reason.
 * Empty until a real run shows a message the product emits on purpose.
 */
const CONSOLE_ALLOW: RegExp[] = [];

type Harness = { api: Api; origin: string; otherOrigin: string };

export const test = base.extend<
  {
    sw: Worker;
    extId: string;
    extPage: Page;
    storage: () => Promise<Record<string, unknown>>;
    openPanel: (page: Page) => Promise<void>;
    togglePanel: (page: Page) => Promise<void>;
    overlay: (page: Page) => ReturnType<Page["locator"]>;
    consoleErrors: string[];
  },
  { harness: Harness; extensionContext: BrowserContext }
>({
  harness: [
    async ({}, use) => {
      const api = await startBackend();
      const seller = await startMockSeller();
      await use({ api, origin: seller.origin, otherOrigin: seller.otherOrigin });
      await seller.stop();
      await api.stop();
    },
    { scope: "worker", auto: true },
  ],
  extensionContext: [
    async ({}, use) => {
      const context = await chromium.launchPersistentContext(mkdtempSync(path.join(os.tmpdir(), "mm-e2e-")), {
        channel: "chromium",
        headless: false,
        args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
      });
      await use(context);
      await context.close();
    },
    { scope: "worker" },
  ],
  context: async ({ extensionContext }, use) => {
    await use(extensionContext);
  },
  sw: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    await use(worker);
  },
  extId: async ({ sw }, use) => {
    await use(new URL(sw.url()).host);
  },
  extPage: async ({ context, extId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/oauth-finish.html`);
    await use(page);
    await page.close();
  },
  storage: async ({ extPage }, use) => {
    await use(() => extPage.evaluate(() => chrome.storage.local.get(null)));
  },
  openPanel: async ({ extPage }, use) => {
    await use(async (page: Page) => {
      const url = page.url();
      await expect.poll(async () => {
        const sent = await extPage.evaluate(async (target) => {
          const tabs = await chrome.tabs.query({});
          const matches = tabs.filter((item) => item.url === target && item.id);
          if (!matches.length) return false;
          for (const tab of matches) {
            try {
              await chrome.tabs.sendMessage(tab.id!, { type: "SHOW_INPAGE_PANEL" });
            } catch {
              /* the content script may still be starting */
            }
          }
          return true;
        }, url);
        if (!sent) return false;
        return (await page.locator("#tiktok-seller-tool-root").count()) === 1;
      }).toBe(true);
    });
  },
  togglePanel: async ({ extPage }, use) => {
    await use(async (page: Page) => {
      const url = page.url();
      await extPage.evaluate(async (target) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((item) => item.url === target);
        if (!tab?.id) throw new Error(`no tab for ${target}`);
        await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_INPAGE_PANEL" });
      }, url);
    });
  },
  overlay: async ({}, use) => {
    await use((page: Page) => page.locator("#tiktok-seller-tool-root"));
  },
  consoleErrors: async ({ context }, use) => {
    const errors: string[] = [];
    const note = (text: string) => {
      if (CONSOLE_ALLOW.some((pattern) => pattern.test(text))) return;
      errors.push(text);
    };
    context.on("page", (page) => {
      page.on("pageerror", (err) => note(err.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") note(msg.text());
      });
    });
    context.on("serviceworker", (worker) => {
      worker.on("console", (msg) => {
        if (msg.type() === "error") note(msg.text());
      });
    });
    await use(errors);
  },
});

test.afterEach(async ({ context, page, extPage, consoleErrors }) => {
  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  // Close the seller page here, before Playwright tears the page down, so its
  // final sync is finished before the next test's setup clear.
  await unloadSellerPages(context, page, extPage).catch(() => undefined);
  // Named timer: seller-page auto-sync debounce (800ms).
  await page.waitForTimeout(800).catch(() => undefined);
  await extPage.evaluate(() => new Promise<void>((resolve) => chrome.storage.local.clear(resolve))).catch(() => undefined);
});

export { expect };

async function unloadSellerPages(context: BrowserContext, page: Page, extPage: Page) {
  for (const extra of [...context.pages()]) {
    if (extra === extPage || extra.url().startsWith("chrome-extension://")) continue;
    if (extra === page) {
      if (!extra.url().startsWith("about:")) await extra.goto("about:blank").catch(() => undefined);
      continue;
    }
    await extra.close().catch(() => undefined);
  }
}

test.beforeEach(async ({ context, page, extPage }) => {
  // Unload seller pages before clearing storage. An open overlay writes its
  // in-memory draft back if storage is cleared underneath it, and a sync that
  // already read the old SKUs can write them back after the clear.
  await expect.poll(async () => {
    await unloadSellerPages(context, page, extPage);
    await extPage.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const ids = tabs
        .filter((item) => (item.url ?? "").includes("/product/") && item.id != null)
        .map((item) => item.id as number);
      if (ids.length) await chrome.tabs.remove(ids);
      await new Promise<void>((resolve) => chrome.storage.local.clear(resolve));
    });
    const tabs = await extPage.evaluate(() => chrome.tabs.query({}).then((items) => items.map((item) => item.url ?? "")));
    const urls = context.pages().map((item) => item.url());
    const left = await extPage.evaluate(() => chrome.storage.local.get("skus"));
    const skuCount = left.skus && typeof left.skus === "object" ? Object.keys(left.skus as object).length : 0;
    const open = [...tabs, ...urls].some((url) => url.includes("/product/"));
    return open || skuCount > 0 ? 1 : 0;
  }).toBe(0);
});
