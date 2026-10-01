import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import ProfitBoard from "../content/components/ProfitBoard";
import { extractVariantSkuIds } from "../content/scraper/parseProductPage";
import { parseProductListPage } from "../content/scraper/parseProductListPage";
import { diagnoseSku } from "./diagnose";
import { buildProfitBoard } from "./profitBoard";
import { computeProfit } from "./profit";
import { reportProblemDraft } from "./reportProblem";
import { profitInputFor } from "./skuEconomics";
import {
  aggregateStatement,
  applySettlementRow,
  periodLabelFromRows,
  rowsMatchedToProducts,
  suggestMapping,
} from "./statementImport";
import { DEFAULT_SETTINGS } from "../types/settings";
import type { SkuRecord } from "../types/sku";

const lab = resolve(process.cwd(), "test-fixtures/lab");

type AnswerProduct = {
  key: string;
  skuId: string;
  title: string;
  listPrice: number;
  listPriceOriginal: number | null;
  cogsPerUnit: number;
  adsPerUnit: number;
  packagingPerUnit: number;
  affiliatePct: number | null;
  net: number | null;
  margin: number | null;
  verdict: string;
  hiddenProfit?: number;
  refundAdminFee: number;
  afterStatement: { unitsSold: number; net: number | null; margin: number | null; verdict: string };
};

type AnswerKey = {
  url: string;
  overviewBeforeStatement: Record<string, string[]>;
  overviewAfterStatement: Record<string, string[]>;
  products: AnswerProduct[];
};

function loadKey(): AnswerKey {
  return JSON.parse(readFileSync(resolve(lab, "expected.json"), "utf8")) as AnswerKey;
}

function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

function toSku(product: AnswerProduct, unitsSold = 0): SkuRecord {
  const missing = product.verdict === "Missing cost";
  return {
    skuId: product.skuId,
    title: product.title,
    listPrice: product.listPrice,
    listPriceOriginal: product.listPriceOriginal,
    cogsPerUnit: product.cogsPerUnit,
    shippingOut: 0,
    adsPerUnit: product.adsPerUnit,
    unitsSold,
    refundRatePct: DEFAULT_SETTINGS.refundRatePct,
    netMarginPct: 0,
    netProfit: 0,
    sourceUrl: "http://127.0.0.1:8765/lab/product/manage/",
    updatedAt: "2026-09-25T00:00:00.000Z",
    packagingPerUnit: product.packagingPerUnit,
    affiliatePct: product.affiliatePct ?? undefined,
    costSource: missing ? "default" : "custom",
  };
}

function bucketKeys(skus: SkuRecord[], keyById: Map<string, string>): Record<string, string[]> {
  const board = buildProfitBoard(skus, DEFAULT_SETTINGS);
  const names: Record<string, string[]> = { losing: [], thin: [], healthy: [], missing: [] };
  for (const sku of skus) {
    const diagnosis = diagnoseSku(sku, DEFAULT_SETTINGS);
    const profit = computeProfit(profitInputFor(sku, DEFAULT_SETTINGS));
    let bucket = "healthy";
    if (diagnosis.status === "missing-cost") bucket = "missing";
    else if (profit.netPerUnit <= 0) bucket = "losing";
    else if (profit.netMarginPct != null && profit.netMarginPct < DEFAULT_SETTINGS.targetMarginPct) {
      bucket = "thin";
    }
    names[bucket].push(keyById.get(sku.skuId) ?? sku.skuId);
  }
  expect(board.tiles.find((tile) => tile.id === "losing")?.count).toBe(names.losing.length);
  return names;
}

describe("lab answer key", () => {
  const key = loadKey();
  const keyById = new Map(key.products.map((product) => [product.skuId, product.key]));

  it("imports the 10 lab products and uses the promo price on B and J", () => {
    const html = readFileSync(resolve(lab, "product/manage/index.html"), "utf8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const items = parseProductListPage(doc, key.url);
    expect(items).toHaveLength(10);
    for (const product of key.products) {
      const row = items.find((item) => item.skuId === product.skuId);
      expect(row?.title).toBe(product.title);
      expect(row?.listPrice).toBe(product.listPrice);
      expect(row?.listPriceOriginal ?? null).toBe(product.listPriceOriginal);
    }
  });

  it("matches every costed row to the cent and hides profit when cost is missing", () => {
    const skus = key.products.map((product) => toSku(product));
    for (const product of key.products) {
      const sku = skus.find((row) => row.skuId === product.skuId);
      if (!sku) throw new Error(product.key);
      const diagnosis = diagnoseSku(sku, DEFAULT_SETTINGS);
      expect(diagnosis.label).toBe(product.verdict);
      if (product.net == null) {
        expect(diagnosis.status).toBe("missing-cost");
        const hidden = computeProfit(profitInputFor(sku, DEFAULT_SETTINGS)).netPerUnit;
        expect(cents(hidden)).toBe(product.hiddenProfit);
        continue;
      }
      const profit = computeProfit(profitInputFor(sku, DEFAULT_SETTINGS));
      expect(cents(profit.netPerUnit)).toBe(product.net);
      expect(profit.netMarginPct == null ? null : Number(profit.netMarginPct.toFixed(1))).toBe(product.margin);
    }
    const names = bucketKeys(skus, keyById);
    expect(names.losing.sort()).toEqual([...key.overviewBeforeStatement.losing].sort());
    expect(names.thin.sort()).toEqual([...key.overviewBeforeStatement.thin].sort());
    expect(names.healthy.sort()).toEqual([...key.overviewBeforeStatement.healthy].sort());
    expect(names.missing.sort()).toEqual([...key.overviewBeforeStatement.missing].sort());
  });

  it("charges the refund admin fee on typed costs and not after a statement", () => {
    for (const product of key.products) {
      const sku = toSku(product);
      const typed = computeProfit({ ...profitInputFor(sku, DEFAULT_SETTINGS), unitsSold: 1, orderCount: 1 });
      expect(cents(typed.refundAdminFee)).toBe(product.refundAdminFee);
      const settled = computeProfit({
        ...profitInputFor({ ...sku, costSource: "settlement", actualFees: { periodLabel: "x", platformFeePct: 6, refundRatePct: 3 } }, DEFAULT_SETTINGS),
        unitsSold: 1,
        orderCount: 1,
      });
      expect(settled.refundAdminFee).toBe(0);
    }
  });

  it("fills units from the statement and keeps a negative fee at +8%", () => {
    const csv = readFileSync(resolve(lab, "statement.csv"), "utf8");
    const parsed = Papa.parse<Record<string, unknown>>(csv, { header: true, skipEmptyLines: true });
    const mapping = suggestMapping(parsed.meta.fields ?? []);
    const skus = key.products.map((product) => toSku(product));
    const linked = rowsMatchedToProducts(parsed.data, mapping, skus);
    expect(linked.matched).toBe(parsed.data.length);
    const settlements = aggregateStatement(linked.rows, mapping);
    const period = periodLabelFromRows(parsed.data, mapping);
    const next = skus.map((sku) => {
      const row = settlements.find((item) => item.skuId === sku.skuId);
      if (!row) throw new Error(sku.skuId);
      return applySettlementRow(sku, row, period);
    });
    for (const sku of next) {
      expect(sku.unitsSold).toBe(30);
      expect(sku.salesPeriod).toBeTruthy();
    }
    const bottle = next.find((sku) => sku.skuId === "1732672081725400009");
    expect(bottle?.actualFees?.platformFeePct).toBeCloseTo(8, 2);
    expect(bottle?.actualFees?.refundRatePct).toBeCloseTo(20, 2);
    expect(bottle?.actualFees?.shippingPerUnit).toBeCloseTo(6, 2);
    const priced = next.map((sku) => {
      const profit = computeProfit(profitInputFor(sku, DEFAULT_SETTINGS));
      return { ...sku, netProfit: profit.netProfit, netMarginPct: profit.netMarginPct ?? 0 };
    });
    for (const product of key.products) {
      const after = product.afterStatement;
      const sku = priced.find((row) => row.skuId === product.skuId);
      expect(sku?.unitsSold).toBe(after.unitsSold);
      if (after.net == null) {
        expect(sku?.costSource).toBe("default");
        expect(diagnoseSku(sku!, DEFAULT_SETTINGS).status).toBe("missing-cost");
        continue;
      }
      const profit = computeProfit(profitInputFor(sku!, DEFAULT_SETTINGS));
      expect(cents(profit.netPerUnit)).toBe(after.net);
      expect(Number(profit.netMarginPct!.toFixed(1))).toBe(after.margin);
      expect(diagnoseSku(sku!, DEFAULT_SETTINGS).label).toBe(after.verdict);
    }
    const names = bucketKeys(priced, keyById);
    expect(names.losing.sort()).toEqual([...key.overviewAfterStatement.losing].sort());
    expect(names.thin.sort()).toEqual([...key.overviewAfterStatement.thin].sort());
    expect(names.missing).toEqual(key.overviewAfterStatement.missing);
    const board = buildProfitBoard(priced, DEFAULT_SETTINGS);
    expect(board.worst.slice(0, 3).map((row) => keyById.get(row.skuId))).toEqual(["D", "B", "E"]);
    expect(board.members.missing.some((row) => /wholesale/i.test(row.downside))).toBe(true);
    const markup = renderToStaticMarkup(
      createElement(ProfitBoard, { skus: priced, settings: DEFAULT_SETTINGS, isPro: true }),
    );
    expect(markup).toContain("Losing");
    expect(markup).toContain("Cut ads");
    const hidden = key.products.find((row) => row.key === "G")?.hiddenProfit;
    expect(hidden).toBeTypeOf("number");
    // A product with no cost never shows a profit number, not even the default-cost guess.
    expect(markup).not.toContain(`$${hidden!.toFixed(2)}`);
    const freeMarkup = renderToStaticMarkup(
      createElement(ProfitBoard, { skus: priced, settings: DEFAULT_SETTINGS, isPro: false }),
    );
    expect(freeMarkup).toContain("Worst product");
    expect(freeMarkup).not.toContain("Cut ads");
    expect(freeMarkup).not.toContain(`$${hidden!.toFixed(2)}`);
  });
});

describe("edit page sku ids", () => {
  it("stores variant ids that are not the product id", () => {
    const text = "Product ID: 1732672081725400002 SKU ID: 1732672081725490002 Seller SKU: BLUE-MUG-01";
    expect(extractVariantSkuIds(text, "1732672081725400002")).toEqual([
      "1732672081725490002",
      "BLUE-MUG-01",
    ]);
  });
});

describe("report a problem", () => {
  it("prefills version, page type, and whether the price was read", () => {
    const body = reportProblemDraft({ version: "1.3.0", pageType: "productList", priceRead: true });
    expect(body).toContain("Extension version: 1.3.0");
    expect(body).toContain("Page type: productList");
    expect(body).toContain("Price read: yes");
    expect(body.toLowerCase()).not.toContain("cogs");
    expect(body.toLowerCase()).not.toContain("profit");
  });
});
