import { describe, expect, it } from "vitest";
import { recapFrom, recordSnapshot, RECAP_KEEP_WEEKS, snapshotFor, weekKey, type WeekSnapshot } from "./weeklyRecap";
import { DEFAULT_SETTINGS } from "../types/settings";
import type { SkuRecord } from "../types/sku";

function sku(id: string, price: number, cogs: number, unitsSold = 0, costSource: SkuRecord["costSource"] = "custom"): SkuRecord {
  return {
    skuId: id,
    title: `Product ${id}`,
    listPrice: price,
    cogsPerUnit: cogs,
    shippingOut: 0,
    adsPerUnit: 0,
    unitsSold,
    refundRatePct: 3,
    netMarginPct: 0,
    netProfit: 0,
    sourceUrl: "",
    updatedAt: "",
    costSource,
  };
}

describe("weekly recap @F-RECAP", () => {
  it("uses ISO weeks that start on Monday", () => {
    expect(weekKey(new Date(2026, 8, 28))).toBe("2026-W40");
    expect(weekKey(new Date(2026, 9, 4))).toBe("2026-W40");
    expect(weekKey(new Date(2026, 9, 5))).toBe("2026-W41");
    expect(weekKey(new Date(2027, 0, 1))).toBe("2026-W53");
  });

  it("sorts products into losing, thin and missing, and totals recorded losses", () => {
    const snap = snapshotFor(
      [sku("win", 40, 8), sku("lose", 10, 9, 20), sku("thin", 15, 10.5), sku("none", 20, 0, 0, "default")],
      DEFAULT_SETTINGS,
      new Date(2026, 8, 30),
    );
    expect(snap.week).toBe("2026-W40");
    expect(snap.losingIds).toEqual(["lose"]);
    expect(snap.thinIds).toEqual(["thin"]);
    expect(snap.missingIds).toEqual(["none"]);
    expect(snap.costsSaved).toBe(3);
    // "lose": 10 x 0.91 - 9 - admin fee (3% x 20% x $0.60 = $0.0036) - $1 commission = -$0.9036, x 20 sold.
    expect(snap.leakUsd).toBeCloseTo(18.07, 2);
  });

  it("names new losers and fixes against last week", () => {
    const lastWeek = snapshotFor([sku("a", 10, 9, 5), sku("b", 40, 8)], DEFAULT_SETTINGS, new Date(2026, 8, 22));
    const thisWeek = snapshotFor([sku("a", 12, 5, 5), sku("b", 40, 38)], DEFAULT_SETTINGS, new Date(2026, 8, 30));
    const recap = recapFrom([lastWeek], thisWeek);
    expect(recap.previous?.week).toBe("2026-W39");
    expect(recap.newLosers).toEqual(["b"]);
    expect(recap.fixed).toEqual(["a"]);
  });

  it("has nothing to compare in the first week", () => {
    const first = snapshotFor([sku("a", 10, 9)], DEFAULT_SETTINGS, new Date(2026, 8, 30));
    const recap = recapFrom([first], first);
    expect(recap.previous).toBeNull();
    expect(recap.newLosers).toEqual([]);
  });

  it("keeps one snapshot per week and at most twelve weeks", () => {
    let history: WeekSnapshot[] = [];
    for (let i = 0; i < 20; i += 1) {
      const snap = snapshotFor([sku("a", 10, 9)], DEFAULT_SETTINGS, new Date(2026, 0, 5 + i * 7));
      history = recordSnapshot(history, snap);
      history = recordSnapshot(history, { ...snap, at: "later" });
    }
    expect(history).toHaveLength(RECAP_KEEP_WEEKS);
    expect(new Set(history.map((row) => row.week)).size).toBe(RECAP_KEEP_WEEKS);
    expect(history.every((row) => row.at === "later")).toBe(true);
  });
});
