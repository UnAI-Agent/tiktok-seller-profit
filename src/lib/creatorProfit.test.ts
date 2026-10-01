import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import {
  aggregateCreatorOrders,
  creatorResults,
  creatorSummary,
  normalizeCreator,
  suggestCreatorMapping,
} from "./creatorProfit";
import { DEFAULT_SETTINGS } from "../types/settings";
import type { SkuRecord } from "../types/sku";

const lab = resolve(process.cwd(), "test-fixtures/lab");

type KeyProduct = {
  skuId: string;
  title: string;
  listPrice: number;
  cogsPerUnit: number;
  adsPerUnit: number;
  packagingPerUnit: number;
  affiliatePct: number | null;
};
type KeyCreator = {
  creator: string;
  orders: number;
  refunded: number;
  revenue: number;
  commission: number;
  net: number | null;
  margin: number | null;
  verdict: string;
  label: string;
};

const key = JSON.parse(readFileSync(resolve(lab, "expected.json"), "utf8")) as { products: KeyProduct[]; creators: KeyCreator[] };
const cents = (value: number) => Math.round(value * 100) / 100;

function labSkus(): SkuRecord[] {
  return key.products.map((p) => ({
    skuId: p.skuId,
    title: p.title,
    listPrice: p.listPrice,
    cogsPerUnit: p.cogsPerUnit,
    shippingOut: 0,
    adsPerUnit: p.adsPerUnit,
    unitsSold: 0,
    refundRatePct: 3,
    netMarginPct: 0,
    netProfit: 0,
    sourceUrl: "",
    updatedAt: "",
    packagingPerUnit: p.packagingPerUnit,
    affiliatePct: p.affiliatePct ?? undefined,
    costSource: p.cogsPerUnit > 0 ? "custom" : "default",
  }));
}

function loadOrders() {
  const csv = readFileSync(resolve(lab, "affiliate-orders.csv"), "utf8");
  const parsed = Papa.parse<Record<string, unknown>>(csv, { header: true, skipEmptyLines: true });
  return { headers: parsed.meta.fields ?? [], rows: parsed.data };
}

describe("creator profit answer key @F-CREATORS", () => {
  it("matches TikTok affiliate export columns without help", () => {
    const { headers } = loadOrders();
    expect(suggestCreatorMapping(headers)).toEqual({
      creator: "Creator Username",
      sku: "SKU ID",
      revenue: "Payment Amount",
      commission: "Est. Commission",
      commissionRate: "Commission Rate",
      quantity: "Quantity",
      status: "Order Status",
    });
  });

  it("prices every creator to the cent against the independent key", () => {
    const { headers, rows } = loadOrders();
    const skus = labSkus();
    const store = aggregateCreatorOrders(rows, suggestCreatorMapping(headers), skus, new Date("2026-09-30T00:00:00Z"));
    const results = creatorResults(store, skus, DEFAULT_SETTINGS);
    expect(results.map((row) => row.creator)).toEqual(key.creators.map((row) => row.creator));
    for (const expected of key.creators) {
      const got = results.find((row) => row.creator === expected.creator)!;
      expect(got.orders, expected.creator).toBe(expected.orders);
      expect(got.refunded, expected.creator).toBe(expected.refunded);
      expect(cents(got.revenue), expected.creator).toBe(expected.revenue);
      expect(cents(got.commission), expected.creator).toBe(expected.commission);
      expect(got.net == null ? null : cents(got.net), expected.creator).toBe(expected.net);
      expect(got.marginPct == null ? null : Number(got.marginPct.toFixed(1)), expected.creator).toBe(expected.margin);
      expect(got.verdict, expected.creator).toBe(expected.verdict);
      expect(got.label, expected.creator).toBe(expected.label);
    }
  });

  it("keeps refunded rows and unknown products out of profit", () => {
    const { headers, rows } = loadOrders();
    const skus = labSkus();
    const store = aggregateCreatorOrders(rows, suggestCreatorMapping(headers), skus);
    const dealhunter = store.creators.find((row) => row.creator === "@dealhunter")!;
    expect(dealhunter.unmatched.revenue).toBeCloseTo(12, 2);
    const results = creatorResults(store, skus, DEFAULT_SETTINGS);
    expect(results.find((row) => row.creator === "@dealhunter")!.unpricedRevenue).toBeCloseTo(12, 2);
    const summary = creatorSummary(results);
    expect(summary.creators).toBe(5);
    expect(summary.losing).toBe(1);
  });

  it("uses the commission rate when the amount column is missing", () => {
    const skus = labSkus();
    const rows = [{ c: "@solo", s: "1732672081725400008", g: "249.99", r: "10%" }];
    const store = aggregateCreatorOrders(rows, { creator: "c", sku: "s", revenue: "g", commissionRate: "r" }, skus);
    expect(store.creators[0].lines[0].commission).toBeCloseTo(25, 2);
  });

  it("normalizes creator handles", () => {
    expect(normalizeCreator("  deskgoals ")).toBe("@deskgoals");
    expect(normalizeCreator("@deskgoals")).toBe("@deskgoals");
    expect(normalizeCreator("")).toBe("");
  });
});
