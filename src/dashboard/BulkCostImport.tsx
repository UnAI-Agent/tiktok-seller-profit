import { useState } from "react";
import { bulkSkusFrom, matchBulkRows, parseBulkText } from "../lib/bulkCost";
import { computeProfit } from "../lib/profit";
import { profitInputFor } from "../lib/skuEconomics";
import { sendMessage } from "../lib/messages";
import { trackEvent } from "../lib/apiClient";
import type { Settings } from "../types/settings";
import type { SkuRecord } from "../types/sku";
import { Button } from "../ui/primitives";
import { useUpgrade } from "../ui/upgrade";

type BulkCostImportProps = {
  skus: SkuRecord[];
  settings: Settings;
  isPro: boolean;
};

/** Paste costs for many products at once. Free accounts still stop at the free cost limit. */
export default function BulkCostImport({ skus, settings, isPro }: BulkCostImportProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ saved: number; unmatched: string[]; skipped: number; limited: number } | null>(null);
  const upgrade = useUpgrade();

  async function apply() {
    setBusy(true);
    setResult(null);
    const parsed = parseBulkText(text);
    const { matched, unmatched } = matchBulkRows(parsed.rows, bulkSkusFrom(skus));
    const byId = new Map(skus.map((sku) => [sku.skuId, sku]));
    const seen = new Set<string>();
    let saved = 0;
    let limited = 0;
    for (const row of matched) {
      if (seen.has(row.skuId)) continue;
      seen.add(row.skuId);
      const sku = byId.get(row.skuId);
      if (!sku) continue;
      const next: SkuRecord = {
        ...sku,
        cogsPerUnit: row.cost,
        costSource: sku.costSource === "settlement" ? "settlement" : "custom",
        updatedAt: new Date().toISOString(),
      };
      const profit = computeProfit(profitInputFor(next, settings));
      next.netProfit = profit.netProfit;
      next.netMarginPct = profit.netMarginPct ?? 0;
      const res = await sendMessage({ type: "SAVE_SKU", sku: next });
      if (res.ok) saved += 1;
      else limited += 1;
    }
    trackEvent("bulk_cost.imported", { saved, unmatched: unmatched.length, limited });
    setResult({ saved, unmatched: unmatched.map((row) => row.key), skipped: parsed.skipped.length, limited });
    if (saved > 0) setText("");
    setBusy(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        className="w-full rounded-xl border border-dashed border-slate-300 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-50"
        onClick={() => setOpen(true)}
      >
        Paste costs for many products
        <span className="block font-normal text-slate-500">From a spreadsheet: product ID or seller SKU, then the cost.</span>
      </button>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 text-xs" aria-label="Paste costs">
      <p className="text-sm font-bold text-slate-900">Paste costs</p>
      <p className="mt-0.5 text-slate-600">
        One product per line: product ID, seller SKU or exact name, then the cost. Copy two columns from a spreadsheet.
      </p>
      <textarea
        aria-label="Costs to paste"
        className="mt-2 h-28 w-full rounded-lg border border-slate-300 p-2 font-mono text-[11px] text-slate-900 outline-none focus:border-slate-900"
        placeholder={"1732672081725400001, 8.00\nBLUE-MUG-01\t4.50"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-2 flex gap-2">
        <Button variant="primary" size="sm" busy={busy} disabled={!text.trim()} onClick={() => void apply()}>
          Save costs
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      {result && (
        <div className="mt-2 space-y-1">
          <p className="rounded-lg bg-emerald-50 px-2 py-1.5 font-semibold text-emerald-800">
            Saved costs for {result.saved} product{result.saved === 1 ? "" : "s"}.
          </p>
          {result.limited > 0 && !isPro && (
            <p className="rounded-lg bg-indigo-50 px-2 py-1.5 text-indigo-900">
              {result.limited} more hit the free limit.{" "}
              <button type="button" className="font-bold underline" onClick={() => upgrade("bulk-cost")}>
                Unlock unlimited
              </button>
            </p>
          )}
          {result.unmatched.length > 0 && (
            <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-amber-900">
              Not found: {result.unmatched.slice(0, 5).join(", ")}
              {result.unmatched.length > 5 ? ` and ${result.unmatched.length - 5} more` : ""}. Sync that page first, then paste again.
            </p>
          )}
          {result.skipped > 0 && (
            <p className="text-slate-500">{result.skipped} line{result.skipped === 1 ? "" : "s"} had no cost and were skipped.</p>
          )}
        </div>
      )}
    </section>
  );
}
