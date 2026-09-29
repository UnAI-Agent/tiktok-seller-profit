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
