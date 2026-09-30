import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../types/settings";
import type { ScrapedProduct } from "../scraper/parseProductPage";
import ProfitOverlay from "./ProfitOverlay";

const product: ScrapedProduct = {
  skuId: "sku-1",
  title: "Test Mug",
  listPrice: 20,
  unitsSold: 1,
  scrapeStatus: "complete",
  scrapeComplete: true,
  hints: { hasTitle: true, hasPriceField: true, onProductEditor: true },
};

describe("overlay plan follows storage", () => {
  const listeners: Array<(message: { type?: string; keys?: string[] }) => void> = [];
  let cachedTier: "pro" | "free" = "pro";

  afterEach(() => {
    listeners.length = 0;
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  function mount(): { host: HTMLDivElement; root: Root } {
    vi.stubGlobal("chrome", {
      runtime: {
        id: "ext",
        getManifest: () => ({ version: "1.4.0" }),
        sendMessage: (message: { type?: string }) => {
          if (message.type === "GET_TIER") return Promise.resolve({ ok: true, tier: cachedTier });
          if (message.type === "API_CALL") {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: { email: "test2@gmail.com", tier: "pro", is_pro: true },
            });
          }
          if (message.type === "GET_SKUS") return Promise.resolve({ ok: true, skus: [] });
          if (message.type === "GET_LOCAL") return Promise.resolve({ ok: true, local: {} });
          return Promise.resolve({ ok: true });
        },
        onMessage: {
          addListener: (fn: (message: { type?: string; keys?: string[] }) => void) => {
            listeners.push(fn);
          },
          removeListener: (fn: (message: { type?: string; keys?: string[] }) => void) => {
            const index = listeners.indexOf(fn);
            if (index >= 0) listeners.splice(index, 1);
          },
        },
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        createElement(ProfitOverlay, {
          product,
          settings: DEFAULT_SETTINGS,
          loggedIn: true,
          accountTier: "pro",
          onDismiss: () => undefined,
        }),
      );
    });
    return { host, root };
  }

  it("a paid-to-Free STORAGE_PUSH lowers the tier", async () => {
    cachedTier = "pro";
    const { host, root } = mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain("PRO");

    cachedTier = "free";
    await act(async () => {
      for (const listener of [...listeners]) {
        listener({ type: "STORAGE_PUSH", keys: ["subscription"] });
      }
      await Promise.resolve();
    });
    expect(host.textContent).toContain("FREE");
    expect(host.textContent?.includes("PRO")).toBe(false);
    act(() => root.unmount());
  });
});
