export type BulkRow = { key: string; cost: number };
export type BulkSku = { skuId: string; title: string; sellerSku?: string | null };

export function matchBulkRows(rows: BulkRow[], skus: BulkSku[]): {
  matched: Array<{ skuId: string; cost: number }>;
  unmatched: BulkRow[];
} {
  const matched: Array<{ skuId: string; cost: number }> = [];
  const unmatched: BulkRow[] = [];
  for (const row of rows) {
    const key = row.key.trim();
    const sku = skus.find(
      (item) => item.skuId === key || item.sellerSku === key || item.title === key,
    );
    if (!sku) unmatched.push(row);
    else matched.push({ skuId: sku.skuId, cost: row.cost });
  }
  return { matched, unmatched };
}

export const BULK_MAX_LINES = 2_000;

/**
 * One product per line: an id, seller SKU or exact title, then the cost.
 * Comma, tab or semicolon separated (a pasted spreadsheet works). "$" is fine.
 * A header line without a number is skipped.
 */
export function parseBulkText(text: string): { rows: BulkRow[]; skipped: string[] } {
  const rows: BulkRow[] = [];
  const skipped: string[] = [];
  const lines = text.split(/\r?\n/).slice(0, BULK_MAX_LINES);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // The cost is after the last separator; a name may contain commas. Tab wins, then ";", then ",".
    const sep = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
    const at = line.lastIndexOf(sep);
    if (at <= 0) {
      skipped.push(line);
      continue;
    }
    const costText = line.slice(at + 1).replace(/[$\s]/g, "");
    const key = line.slice(0, at).trim().replace(/^"|"$/g, "");
    const cost = Number.parseFloat(costText);
    if (!key || !/^\d+(\.\d+)?$/.test(costText) || !Number.isFinite(cost) || cost <= 0 || cost > 100_000) {
      skipped.push(line);
      continue;
    }
    rows.push({ key, cost: Math.round(cost * 100) / 100 });
  }
  return { rows, skipped };
}

/** Every id a seller might paste for one product: product id, variant or seller SKU ids, title. */
export function bulkSkusFrom(
  skus: ReadonlyArray<{ skuId: string; title: string; skuIds?: string[] }>,
): BulkSku[] {
  const out: BulkSku[] = [];
  for (const sku of skus) {
    out.push({ skuId: sku.skuId, title: sku.title, sellerSku: null });
    for (const id of sku.skuIds ?? []) out.push({ skuId: sku.skuId, title: sku.title, sellerSku: id });
  }
  return out;
}
