import type { SkuRecord } from "../types/sku";

export type StatementField =
  | "sku"
  | "orderAmount"
  | "referralFee"
  | "affiliateFee"
  | "shipping"
  | "refund"
  | "date";

export type StatementMapping = Partial<Record<StatementField, string>>;

export type SkuSettlement = {
  skuId: string;
  orders: number;
  orderAmount: number;
  referralPct: number;
  affiliatePct: number;
  affiliateSharePct: number;
  refundPct: number;
  shippingPerUnit: number;
};

const KEYWORDS: Record<StatementField, string[]> = {
  sku: ["sku", "product id", "product_id", "item id"],
  orderAmount: ["order amount", "order total", "item subtotal", "subtotal"],
  referralFee: ["referral", "platform fee", "platform commission"],
  affiliateFee: ["affiliate", "creator commission"],
  shipping: ["shipping"],
  refund: ["refund"],
  date: ["order date", "settlement date", "statement date"],
};
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/** A file over the size or row limit. Its message is safe to show a seller; parser errors are not. */
export class ImportLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportLimitError";
  }
}
export const MAX_IMPORT_ROWS = 50_000;

function norm(value: string): string {
  return value.trim().toLowerCase();
}

export function suggestMapping(headers: string[]): StatementMapping {
  const mapping: StatementMapping = {};
  const used = new Set<string>();
  const fields = Object.keys(KEYWORDS) as StatementField[];
  for (const field of fields) {
    const hit = headers.find((header) => {
      if (used.has(header)) return false;
      const text = norm(header);
      return KEYWORDS[field].some((word) => text.includes(word));
    });
    if (hit) {
      mapping[field] = hit;
      used.add(hit);
    }
  }
  return mapping;
}

export function parseMoneyCell(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace(/[^0-9.-]/g, "");
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : 0;
}

/** TikTok often exports fees as negative. The rate is the size of the fee. */
export function absMoney(value: unknown): number {
  return Math.abs(parseMoneyCell(value));
}

export const STATEMENT_ID_MISMATCH =
  "Your statement uses a different ID column: pick it";

export function findSkuForStatementId<T extends { skuId: string; skuIds?: string[] }>(
  skus: readonly T[],
  statementId: string,
): T | undefined {
  const id = statementId.trim();
  if (!id) return undefined;
  return skus.find((sku) => sku.skuId === id || (sku.skuIds ?? []).includes(id));
}

/** Rewrite statement rows onto the product id they match (product id or a stored SKU id). */
export function rowsMatchedToProducts(
  rows: Array<Record<string, unknown>>,
  mapping: StatementMapping,
  skus: ReadonlyArray<{ skuId: string; skuIds?: string[] }>,
): { rows: Array<Record<string, unknown>>; matched: number } {
  const skuKey = mapping.sku;
  if (!skuKey) return { rows: [], matched: 0 };
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const id = String(row[skuKey] ?? "").trim();
    if (!id) continue;
    const sku = findSkuForStatementId(skus, id);
    if (!sku) continue;
    out.push({ ...row, [skuKey]: sku.skuId });
  }
  return { rows: out, matched: out.length };
}

export function aggregateStatement(
  rows: Array<Record<string, unknown>>,
  mapping: StatementMapping,
): SkuSettlement[] {
  const skuKey = mapping.sku;
  const amountKey = mapping.orderAmount;
  if (!skuKey || !amountKey) return [];
  const buckets = new Map<
    string,
    {
      orders: number;
      orderAmount: number;
      referral: number;
      affiliate: number;
      affiliateOrders: number;
      affiliateRevenue: number;
      shipping: number;
      refund: number;
    }
  >();

  for (const row of rows) {
    const skuId = String(row[skuKey] ?? "").trim();
    if (!skuId) continue;
    const amount = parseMoneyCell(row[amountKey]);
    const affiliate = mapping.affiliateFee ? absMoney(row[mapping.affiliateFee]) : 0;
    const bucket = buckets.get(skuId) ?? {
      orders: 0,
      orderAmount: 0,
      referral: 0,
      affiliate: 0,
      affiliateOrders: 0,
      affiliateRevenue: 0,
      shipping: 0,
      refund: 0,
    };
    bucket.orders += 1;
    bucket.orderAmount += amount;
    if (mapping.referralFee) bucket.referral += absMoney(row[mapping.referralFee]);
    bucket.affiliate += affiliate;
    if (affiliate > 0) {
      bucket.affiliateOrders += 1;
      bucket.affiliateRevenue += amount;
    }
    if (mapping.shipping) bucket.shipping += absMoney(row[mapping.shipping]);
    if (mapping.refund) bucket.refund += absMoney(row[mapping.refund]);
    buckets.set(skuId, bucket);
  }

  return [...buckets.entries()].map(([skuId, bucket]) => ({
    skuId,
    orders: bucket.orders,
    orderAmount: bucket.orderAmount,
    referralPct:
      bucket.orderAmount > 0 ? (bucket.referral / bucket.orderAmount) * 100 : 0,
    affiliatePct:
      bucket.affiliateRevenue > 0
        ? (bucket.affiliate / bucket.affiliateRevenue) * 100
        : 0,
    affiliateSharePct:
      bucket.orders > 0 ? (bucket.affiliateOrders / bucket.orders) * 100 : 0,
    refundPct: bucket.orderAmount > 0 ? (bucket.refund / bucket.orderAmount) * 100 : 0,
    shippingPerUnit: bucket.orders > 0 ? bucket.shipping / bucket.orders : 0,
  }));
}

/** Write orders into units sold. Fees apply only after a cost exists, so a blank COGS stays "Missing cost". */
export function applySettlementRow(existing: SkuRecord, row: SkuSettlement, period: string): SkuRecord {
  const hasCost = (existing.costSource ?? "default") !== "default" || existing.cogsPerUnit > 0;
  return {
    ...existing,
    unitsSold: row.orders,
    salesPeriod: period,
    costSource: hasCost ? "settlement" : existing.costSource ?? "default",
    actualFees: hasCost
      ? {
          periodLabel: period,
          platformFeePct: row.referralPct,
          paymentFeePct: 0,
          paymentFixed: 0,
          affiliatePct: row.affiliatePct,
          affiliateSharePct: row.affiliateSharePct,
          refundRatePct: row.refundPct,
          shippingPerUnit: row.shippingPerUnit,
        }
      : existing.actualFees,
  };
}

export function periodLabelFromRows(
  rows: Array<Record<string, unknown>>,
  mapping: StatementMapping,
): string {
  const key = mapping.date;
  if (!key) return "your statement";
  const stamps = rows
    .map((row) => Date.parse(String(row[key] ?? "")))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (stamps.length === 0) return "your statement";
  const fmt = (ms: number) =>
    new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(stamps[0])}–${fmt(stamps[stamps.length - 1])}`;
}

export async function readStatementTable(
  file: File,
): Promise<{ headers: string[]; rows: Array<Record<string, unknown>> }> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ImportLimitError("Import files must be 20 MB or smaller.");
  }
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || file.type.includes("csv")) {
    const text = await file.text();
    const Papa = (await import("papaparse")).default;
    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
    });
    const headers = parsed.meta.fields ?? [];
    if (parsed.data.length > MAX_IMPORT_ROWS) {
      throw new ImportLimitError("Import files may contain at most 50,000 rows.");
    }
    return { headers, rows: parsed.data };
  }
  const XLSX = await import("xlsx");
  const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = book.Sheets[book.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false });
  if (matrix.length - 1 > MAX_IMPORT_ROWS) {
    throw new ImportLimitError("Import files may contain at most 50,000 rows.");
  }
  const headerRow = (matrix[0] ?? []).map((cell) => String(cell ?? "").trim());
  const rows = matrix.slice(1).map((line) => {
    const row: Record<string, unknown> = {};
    headerRow.forEach((header, index) => {
      if (header) row[header] = line[index];
    });
    return row;
  });
  return { headers: headerRow.filter(Boolean), rows };
}
