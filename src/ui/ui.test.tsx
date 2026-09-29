import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SkuDashboard from "../dashboard/SkuDashboard";
import { renewalDisclosure, yearlySavingsPct } from "../lib/billingDisclosure";
import { formatSignedUsd } from "../lib/profit";
import { DEFAULT_SETTINGS } from "../types/settings";
import type { SkuRecord } from "../types/sku";
import OverlayHeader from "../content/components/OverlayHeader";
import CommissionCard from "../content/components/CommissionCard";
import ProLock from "./ProLock";
import { toneForNet } from "./tone";
import { UpgradeContext } from "./upgrade";

function sku(partial: Partial<SkuRecord>): SkuRecord {
  return {
    skuId: "1",
    title: "Test Mug",
    listPrice: 20,
    listPriceOriginal: null,
    cogsPerUnit: 5,
    shippingOut: 0,
    adsPerUnit: 0,
    unitsSold: 10,
    refundRatePct: 3,
    netMarginPct: 0,
    netProfit: 0,
    sourceUrl: "http://x",
    updatedAt: "2026-09-28T00:00:00.000Z",
    costSource: "custom",
    ...partial,
  };
}

const losing = sku({ skuId: "loser", title: "Loser Lamp", listPrice: 10, cogsPerUnit: 12 });
const winner = sku({ skuId: "winner", title: "Winner Grip", listPrice: 30, cogsPerUnit: 4 });

describe("signed money + tone (green = keep, red = lose)", () => {
  it("formatSignedUsd shows the sign", () => {
    expect(formatSignedUsd(3.2)).toBe("+$3.20");
    expect(formatSignedUsd(-1.81)).toBe("-$1.81");
    expect(formatSignedUsd(0)).toBe("$0.00");
    expect(formatSignedUsd(0.001)).toBe("$0.00");
  });
  it("toneForNet", () => {
    expect(toneForNet(2)).toBe("profit");
    expect(toneForNet(-0.5)).toBe("loss");
    expect(toneForNet(0)).toBe("loss");
    expect(toneForNet(2, false)).toBe("neutral");
  });
});

describe("billing disclosure", () => {
  it("names the price, trial, renewal, and where to cancel", () => {
    expect(renewalDisclosure("monthly", true)).toBe(
      "$14.99/month after a 7-day free trial. Renews automatically until you cancel. Cancel anytime in Manage billing.",
    );
    expect(renewalDisclosure("yearly", true)).toContain("$120/year after a 7-day free trial");
    expect(renewalDisclosure("yearly", false)).toContain("charged today");
    expect(renewalDisclosure("yearly", false)).not.toContain("free trial");
  });
  it("yearly savings are derived, not hard-coded", () => {
    expect(yearlySavingsPct()).toBe(33);
  });
});

describe("hero", () => {
  const base = {
    title: "Mug",
    listPrice: 20,
    unitsSold: 0,
    netMarginPct: 20,
    priceKnown: true,
    costKnown: true,
    showTargetGuard: true,
    isPro: false,
    onUpgrade: () => undefined,
    onMinimize: () => undefined,
    onClose: () => undefined,
  } as const;

  it("PROFIT_hero_is_green_with_a_plus_sign", () => {
    const html = renderToStaticMarkup(
      createElement(OverlayHeader, { ...base, netPerUnit: 4.2, tone: "profit", guard: { kind: "ok" } }),
    );
    expect(html).toContain("+$4.20");
    expect(html).toContain("text-emerald-700");
    expect(html).not.toContain("text-red-700");
  });

  it("LOSS_hero_is_red_with_a_minus_sign_and_an_alert", () => {
    const html = renderToStaticMarkup(
      createElement(OverlayHeader, {
        ...base,
        netPerUnit: -1.81,
        tone: "loss",
        guard: { kind: "loss", lossPerSale: 1.81, minPrice: 21.9 },
      }),
    );
    expect(html).toContain("-$1.81");
    expect(html).toContain("text-red-700");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Minimum price");
  });

  it("FREE_shows_Upgrade_and_PRO_shows_the_badge_not_Upgrade", () => {
    const free = renderToStaticMarkup(
      createElement(OverlayHeader, { ...base, netPerUnit: 1, tone: "profit", guard: { kind: "ok" } }),
    );
    expect(free).toContain("Upgrade");
    expect(free).toContain("FREE");
    const pro = renderToStaticMarkup(
      createElement(OverlayHeader, { ...base, isPro: true, netPerUnit: 1, tone: "profit", guard: { kind: "ok" } }),
    );
    expect(pro).not.toContain(">Upgrade<");
    expect(pro).toContain("PRO");
  });

  it("missing_cost_asks_for_it_inline", () => {
    const html = renderToStaticMarkup(
      createElement(OverlayHeader, {
        ...base,
        costKnown: false,
        netPerUnit: 0,
        tone: "loss",
        guard: { kind: "ok" },
        costEntry: { onCommit: () => undefined },
      }),
    );
    expect(html).toContain("Add your product cost to see profit");
    expect(html).toContain("What does one unit cost you");
    expect(html).not.toContain("-$0.00");
  });
});

describe("Free vs Pro separation", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      storage: { local: { get: vi.fn().mockResolvedValue({}) } },
      runtime: { id: "test", sendMessage: vi.fn().mockResolvedValue({ ok: true }) },
    });
  });

  const render = (isPro: boolean) =>
    renderToStaticMarkup(
      createElement(SkuDashboard, { skus: [losing, winner], isPro, settings: DEFAULT_SETTINGS }),
    );

  it("both tiers see the colored per-sale profit", () => {
    for (const isPro of [false, true]) {
      const html = render(isPro);
      expect(html).toContain("text-red-700");
      expect(html).toContain("text-emerald-700");
      expect(html).toContain("-$");
      expect(html).toContain("+$");
    }
  });

  it("FREE_hides_fix_advice_and_max_commission_and_offers_the_upgrade", () => {
    const html = render(false);
    expect(html).not.toContain("Raise price to");
    expect(html).not.toMatch(/Max commission \d/); // no per-product value for Free
    expect(html).toContain("See the fix");
    expect(html).toContain("Free costs saved");
    expect(html).toContain("Use your real TikTok fees");
    expect(html).toContain("data-pro-lock");
  });

  it("PRO_shows_fix_advice_max_commission_and_export", () => {
    const html = render(true);
    expect(html).toContain("Raise price to");
    expect(html).toContain("Max commission");
    expect(html).toContain("Export CSV");
    expect(html).not.toContain("data-pro-lock");
    expect(html).not.toContain("Free costs saved");
  });

  it("commission card renders nothing for Free (the overlay shows one lock instead)", () => {
    const html = renderToStaticMarkup(
      createElement(CommissionCard, {
        input: { listPrice: 20, unitsSold: 1, cogsPerUnit: 5, shippingOut: 0, adsPerUnit: 0, platformFeePct: 6, paymentFeePct: 0, paymentFixed: 0, refundRatePct: 3 },
        currentPct: 10,
        creatorNet: 1,
        targetMarginPct: 15,
        isPro: false,
        losing: false,
      }),
    );
    expect(html).toBe("");
  });

  it("ProLock hides real data behind a blur and calls the upgrade handler", () => {
    const seen: string[] = [];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        createElement(
          UpgradeContext.Provider,
          { value: (placement: string) => seen.push(placement) },
          createElement(ProLock, {
            placement: "insights",
            title: "Max commission",
            blurb: "Pro shows it.",
            preview: createElement("b", null, "14.5%"),
          }),
        ),
      );
    });
    expect(host.querySelector("[aria-hidden='true']")?.className).toContain("blur");
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "Unlock with Pro");
    act(() => button?.click());
    expect(seen).toEqual(["insights"]);
    act(() => root.unmount());
    host.remove();
  });
});
