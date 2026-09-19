import { describe, expect, it, beforeEach } from "vitest";
import type { SkuRecord } from "../types/sku";
import { saveSku, getSkus, syncSkus } from "./storage";

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

  it("blocks the 11th new SKU on free tier", async () => {
    for (let i = 1; i <= 10; i += 1) {
      const res = await saveSku(sku(`id-${i}`), "free");
      expect(res.ok).toBe(true);
    }
    const blocked = await saveSku(sku("id-11"), "free");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("limit");
    const list = await getSkus();
    expect(list).toHaveLength(10);
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
