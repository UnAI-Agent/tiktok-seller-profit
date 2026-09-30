import { describe, expect, it, beforeEach } from "vitest";
import { DEFAULT_SETTINGS } from "../types/settings";
import type { SkuRecord } from "../types/sku";
import { saveSku, getSkus, getSettings, migrateSettings, syncSkus } from "./storage";
import { FREE_SKU_LIMIT } from "../config";

function sku(id: string): SkuRecord {
  return {
    skuId: id,
    title: `Product ${id}`,
    listPrice: 10,
    cogsPerUnit: 2,
    shippingOut: 1,
    adsPerUnit: 0,
    unitsSold: 1,
    refundRatePct: 3,
    netMarginPct: 20,
    netProfit: 5,
    sourceUrl: "https://seller-us.tiktok.com/p",
    updatedAt: "2026-09-19T00:00:00.000Z",
  };
}

describe("migrateSettings", () => {
  it("loads a v1 store without wiping fee numbers", () => {
    const v1 = {
      version: 1 as const,
      platformFeePct: 5,
      paymentFeePct: 2.9,
      paymentFixed: 0.3,
      defaultCogs: 4,
      defaultShippingOut: 1.25,
      shippingPassedToBuyer: false,
      defaultAdsPerUnit: 0.4,
      refundRatePct: 2,
      salesTaxPct: 0,
      packagingPerUnit: 0.2,
      affiliateCommissionPct: 12,
      overlayEnabled: true,
      overlayPosition: "bottom-left" as const,
      overlayCollapsed: true,
    };
    const next = migrateSettings(v1);
    expect(next.version).toBe(3);
    expect(next.platformFeePct).toBe(5);
    expect(next.paymentFeePct).toBe(2.9);
    expect(next.paymentFixed).toBe(0.3);
    expect(next.defaultCogs).toBe(4);
    expect(next.affiliateCommissionPct).toBe(12);
    expect(next.overlayPosition).toBe("bottom-left");
    expect(next.overlayCollapsed).toBe(true);
    expect(next.shippingPassedToBuyer).toBe(false);
    expect(next.targetMarginPct).toBe(DEFAULT_SETTINGS.targetMarginPct);
    expect(next.affiliateSharePct).toBe(DEFAULT_SETTINGS.affiliateSharePct);
    expect(next.feePreset).toBe("custom");
    expect(next.version).toBe(3);
  });

  it("moves only the untouched 8% default to the 6% preset", () => {
    const next = migrateSettings({
      version: 2,
      feePreset: "us-standard",
      platformFeePct: 8,
      paymentFeePct: 0,
      paymentFixed: 0,
      defaultCogs: 3,
    });
    expect(next.platformFeePct).toBe(6);
    expect(next.paymentFeePct).toBe(0);
    expect(next.paymentFixed).toBe(0);
    expect(next.feePreset).toBe("us-standard");
    expect(next.defaultCogs).toBe(3);
  });

  it("keeps a custom 8% fee and the old 6% legacy choice", () => {
    const custom = migrateSettings({
      version: 2,
      feePreset: "custom",
      platformFeePct: 8,
      paymentFeePct: 0,
      paymentFixed: 0,
    });
    expect(custom.platformFeePct).toBe(8);
    expect(custom.feePreset).toBe("custom");
    const oldLegacy = migrateSettings({
      version: 2,
      feePreset: "us-legacy",
      platformFeePct: 6,
      paymentFeePct: 0,
      paymentFixed: 0,
    });
    expect(oldLegacy.platformFeePct).toBe(6);
    expect(oldLegacy.paymentFeePct).toBe(0);
    expect(oldLegacy.feePreset).toBe("us-standard");
  });

  it("ignores corrupted types and keeps the SKU list usable", () => {
    const next = migrateSettings({
      platformFeePct: "8%",
      paymentFeePct: Number.NaN,
      overlayPosition: "middle",
      shippingPassedToBuyer: "yes",
    });
    expect(next.platformFeePct).toBe(DEFAULT_SETTINGS.platformFeePct);
    expect(next.paymentFeePct).toBe(DEFAULT_SETTINGS.paymentFeePct);
    expect(next.overlayPosition).toBe("bottom-right");
    expect(next.shippingPassedToBuyer).toBe(true);
    expect(migrateSettings("nope").version).toBe(3);
  });
});

describe("storage SKU cap", () => {
  beforeEach(() => {
    const mem: Record<string, unknown> = {};
    // @ts-expect-error test stub
    globalThis.chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: mem[key] }),
          set: async (obj: Record<string, unknown>) => {
            Object.assign(mem, obj);
          },
        },
      },
    };
  });

  it("L6_11th_cost_prompts_upgrade", async () => {
    for (let i = 1; i <= FREE_SKU_LIMIT; i += 1) {
      const res = await saveSku({ ...sku(`id-${i}`), costSource: "custom" }, "free");
      expect(res.ok).toBe(true);
    }
    const blocked = await saveSku({ ...sku(`id-${FREE_SKU_LIMIT + 1}`), costSource: "custom" }, "free");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("limit");
    const priced = await saveSku(sku(`id-${FREE_SKU_LIMIT + 2}`), "free");
    expect(priced.ok).toBe(true);
    const list = await getSkus();
    expect(list).toHaveLength(FREE_SKU_LIMIT + 1);
  });

  it("L6_sync_never_blocks_free", async () => {
    const incoming = Array.from({ length: 15 }, (_, i) => sku(`row-${i}`));
    const result = await syncSkus(incoming, "free");
    expect(result.saved).toBe(15);
    expect(result.skipped).toBe(0);
    const again = await syncSkus(incoming, "free");
    expect(again.saved).toBe(0);
  });

  it("L6_existing_users_migrate", async () => {
    for (let i = 1; i <= 12; i += 1) {
      expect((await saveSku(sku(`old-${i}`), "free")).ok).toBe(true);
    }
    const withCost = await saveSku({ ...sku("old-1"), costSource: "custom" }, "free");
    expect(withCost.ok).toBe(true);
  });

  it("upgrades a stored v1 settings object in place", async () => {
    const mem: Record<string, unknown> = {
      settings: {
        version: 1,
        platformFeePct: 7,
        paymentFeePct: 2.9,
        paymentFixed: 0.3,
        affiliateCommissionPct: 18,
        defaultCogs: 3,
      },
    };
    // @ts-expect-error test stub
    globalThis.chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: mem[key] }),
          set: async (obj: Record<string, unknown>) => {
            Object.assign(mem, obj);
          },
        },
      },
    };
    const settings = await getSettings();
    expect(settings.version).toBe(3);
    expect(settings.platformFeePct).toBe(7);
    expect(settings.affiliateCommissionPct).toBe(18);
    expect(settings.defaultCogs).toBe(3);
    expect(settings.targetMarginPct).toBe(15);
    expect((mem.settings as { version: number }).version).toBe(3);
  });

  it("skips invalid rows", async () => {
    const res = await syncSkus(
      [sku("ok"), { skuId: "bad" } as SkuRecord],
      "pro",
    );
    expect(res.saved).toBe(1);
    expect(res.skipped).toBe(1);
  });
});
