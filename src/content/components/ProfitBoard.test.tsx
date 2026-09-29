import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OverlayHeader from "./OverlayHeader";
import SkuDashboard from "../../dashboard/SkuDashboard";
import { DEFAULT_SETTINGS } from "../../types/settings";
import type { SkuRecord } from "../../types/sku";
import ProfitBoard from "./ProfitBoard";

function sku(partial: Partial<SkuRecord> = {}): SkuRecord {
  return {
    skuId: "1732672081725330342",
    title: "Ailun Screen Protector Lab",
    listPrice: 36,
    listPriceOriginal: 45,
    cogsPerUnit: 0,
    shippingOut: 0,
    adsPerUnit: 0,
    unitsSold: 0,
    refundRatePct: 0,
    netMarginPct: 0,
    netProfit: 0,
    sourceUrl: "http://127.0.0.1:8765/lab/product/manage/",
    updatedAt: "2026-09-27T00:00:00.000Z",
    costSource: "default",
    ...partial,
  };
}

function mount(node: ReturnType<typeof createElement>): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return { host, root };
}

function buttonNamed(host: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === label);
}

describe("missing purchase cost", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      storage: { local: { get: vi.fn().mockResolvedValue({}) } },
      runtime: { id: "test", sendMessage: vi.fn().mockResolvedValue({ ok: true }) },
    });
  });

  it("opens the cost box for that product", () => {
    const opened: string[] = [];
    const { host, root } = mount(
      createElement(ProfitBoard, {
        skus: [sku()],
        settings: DEFAULT_SETTINGS,
        isPro: true,
        onAddCost: (id: string) => opened.push(id),
      }),
    );
    act(() => {
      [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Missing cost"))?.click();
    });
    const add = buttonNamed(host, "Add purchase cost");
    expect(add).toBeTruthy();
    act(() => {
      add?.click();
    });
    expect(opened).toEqual(["1732672081725330342"]);
    act(() => root.unmount());
    host.remove();
  });

  it("focuses the purchase-cost field", () => {
    const { host, root } = mount(
      createElement(SkuDashboard, {
        skus: [sku()],
        isPro: true,
        settings: DEFAULT_SETTINGS,
        editCost: { skuId: "1732672081725330342", token: 1 },
      }),
    );
    const input = host.querySelector("input[aria-label='Purchase cost']");
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(document.activeElement).toBe(input);
    act(() => root.unmount());
    host.remove();
  });

  it("shows the logo and explains how net profit is calculated", () => {
    const header = renderToStaticMarkup(
      createElement(OverlayHeader, {
        title: "Mug",
        listPrice: 20,
        unitsSold: 1,
        netPerUnit: 3,
        netMarginPct: 15,
        tone: "profit",
        priceKnown: true,
        costKnown: true,
        guard: { kind: "ok" },
        showTargetGuard: true,
        isPro: true,
        onUpgrade: () => undefined,
        onMinimize: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect(header).toContain("#34d399");
    expect(header).toContain("Buyer price minus your cost");
    expect(header).not.toContain('aria-label="Account"');

    const signedIn = renderToStaticMarkup(
      createElement(OverlayHeader, {
        title: "Mug",
        listPrice: 20,
        unitsSold: 1,
        netPerUnit: 3,
        netMarginPct: 15,
        tone: "profit",
        priceKnown: true,
        costKnown: true,
        guard: { kind: "ok" },
        showTargetGuard: true,
        isPro: true,
        loggedIn: true,
        onAccount: () => undefined,
        onUpgrade: () => undefined,
        onMinimize: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect(signedIn).toContain('aria-label="Account"');

    const table = renderToStaticMarkup(
      createElement(SkuDashboard, {
        skus: [sku()],
        isPro: true,
        settings: DEFAULT_SETTINGS,
      }),
    );
    expect(table).toContain("What you paid to buy one unit");
    expect(table).toContain("Highest creator commission");
  });
});
