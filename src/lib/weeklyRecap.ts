import { newLeakIds } from "./checkin";
import { diagnoseSku } from "./diagnose";
import { computeProfit } from "./profit";
import { profitInputFor } from "./skuEconomics";
import { leaksFoundUsd } from "./valueReceipt";
import type { Settings } from "../types/settings";
import type { SkuRecord } from "../types/sku";

/**
 * Weekly recap, computed and stored only in the browser. One snapshot per
 * ISO week (Monday start); the recap compares this week with the last one.
 */

export type WeekSnapshot = {
  week: string;
  at: string;
  productCount: number;
  costsSaved: number;
  losingIds: string[];
  thinIds: string[];
  missingIds: string[];
  /** Dollars lost on recorded sales by products that lose money on each sale. */
  leakUsd: number;
  /** Net profit per sale summed over costed products: a direction signal, not revenue. */
  netPerSaleSum: number;
};

export type WeeklyRecap = {
  current: WeekSnapshot;
  previous: WeekSnapshot | null;
  newLosers: string[];
  fixed: string[];
  newlyCosted: number;
  leakDelta: number | null;
};

export const RECAP_HISTORY_KEY = "weeklySnapshots";
export const RECAP_KEEP_WEEKS = 12;

/** ISO 8601 week, such as "2026-W40". */
export function weekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function snapshotFor(skus: SkuRecord[], settings: Settings, now: Date = new Date()): WeekSnapshot {
  const losingIds: string[] = [];
  const thinIds: string[] = [];
  const missingIds: string[] = [];
  const leakRows: Array<{ netPerUnit: number; units: number; commissionAboveSafe: number }> = [];
  let costsSaved = 0;
  let netPerSaleSum = 0;
  for (const sku of skus) {
    const status = diagnoseSku(sku, settings).status;
    if (status === "missing-cost") {
      missingIds.push(sku.skuId);
      continue;
    }
    costsSaved += 1;
    const profit = computeProfit(profitInputFor(sku, settings));
    netPerSaleSum += profit.netPerUnit;
    if (profit.netPerUnit <= 0) losingIds.push(sku.skuId);
    else if (status === "below-target") thinIds.push(sku.skuId);
    if (profit.netPerUnit < 0 && sku.unitsSold > 0) {
      leakRows.push({ netPerUnit: profit.netPerUnit, units: sku.unitsSold, commissionAboveSafe: 0 });
    }
  }
  return {
    week: weekKey(now),
    at: now.toISOString(),
    productCount: skus.length,
    costsSaved,
    losingIds: losingIds.sort(),
    thinIds: thinIds.sort(),
    missingIds: missingIds.sort(),
    leakUsd: Math.round(leaksFoundUsd(leakRows) * 100) / 100,
    netPerSaleSum: Math.round(netPerSaleSum * 100) / 100,
  };
}

/** Replace this week's snapshot with the latest one and keep the last 12 weeks. */
export function recordSnapshot(history: WeekSnapshot[], snapshot: WeekSnapshot): WeekSnapshot[] {
  const others = history.filter((row) => row.week !== snapshot.week);
  return [...others, snapshot].sort((a, b) => a.week.localeCompare(b.week)).slice(-RECAP_KEEP_WEEKS);
}

export function recapFrom(history: WeekSnapshot[], current: WeekSnapshot): WeeklyRecap {
  const previous = [...history].filter((row) => row.week < current.week).sort((a, b) => b.week.localeCompare(a.week))[0] ?? null;
  if (!previous) {
    return { current, previous: null, newLosers: [], fixed: [], newlyCosted: 0, leakDelta: null };
  }
  const still = new Set(current.losingIds);
  return {
    current,
    previous,
    newLosers: newLeakIds(previous.losingIds, current.losingIds),
    fixed: previous.losingIds.filter((id) => !still.has(id)),
    newlyCosted: Math.max(0, current.costsSaved - previous.costsSaved),
    leakDelta: Math.round((current.leakUsd - previous.leakUsd) * 100) / 100,
  };
}

export function isRecapSnapshot(value: unknown): value is WeekSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.week === "string" &&
    /^\d{4}-W\d{2}$/.test(row.week) &&
    Array.isArray(row.losingIds) &&
    Array.isArray(row.thinIds) &&
    Array.isArray(row.missingIds) &&
    typeof row.leakUsd === "number"
  );
}
