import { useMemo, useState } from "react";
import { FREE_SKU_LIMIT } from "../config";
import ExternalPriceCompare from "../content/components/ExternalPriceCompare";
import type { SkuRecord } from "../types/sku";
import { formatPct, formatUsd } from "../lib/profit";
import { skuCountLabel, skuLimitWarning } from "../lib/skuLimit";
import ProUpsell from "../popup/ProUpsell";

type SkuDashboardProps = {
  skus: SkuRecord[];
  isPro: boolean;
};

type SortKey = "margin" | "net" | "sold" | "title";

export default function SkuDashboard({ skus, isPro }: SkuDashboardProps) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("margin");
  const [compareSku, setCompareSku] = useState<SkuRecord | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = skus;
    if (q) {
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.skuId.toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "net":
          return b.netProfit - a.netProfit;
        case "sold":
          return b.unitsSold - a.unitsSold;
        case "title":
          return a.title.localeCompare(b.title);
        default:
          return a.netMarginPct - b.netMarginPct;
      }
    });
    return sorted;
  }, [skus, query, sortKey]);

  const limitNote = skuLimitWarning(skus.length, isPro);

  if (skus.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No SKUs yet. Open Manage products in Seller Center — listings import
        automatically, or tap Sync at the top.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-600">{skuCountLabel(skus.length, isPro)}</span>
        <select
          className="rounded border px-1 py-0.5 text-[10px]"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
        >
          <option value="margin">Sort: margin</option>
          <option value="net">Sort: net profit</option>
          <option value="sold">Sort: units sold</option>
          <option value="title">Sort: name</option>
        </select>
      </div>
      <input
        className="w-full rounded border px-2 py-1 text-xs"
        placeholder="Filter by name or ID…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {limitNote && (
        <div className="space-y-2">
          <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
            {limitNote}
          </p>
          {skus.length >= FREE_SKU_LIMIT && !isPro && <ProUpsell compact />}
        </div>
      )}
      {compareSku && (
        <ExternalPriceCompare
          title={compareSku.title}
          listPrice={compareSku.listPrice}
          isPro={isPro}
        />
      )}
      <div className="max-h-[320px] overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-1 pr-2">Product</th>
              <th className="py-1 pr-2">Price</th>
              <th className="py-1 pr-2">Sold</th>
              <th className="py-1 pr-2">Margin</th>
              <th className="py-1 pr-2">Net</th>
              <th className="py-1"> </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((sku) => (
              <tr key={sku.skuId} className="border-t border-slate-100">
                <td className="py-2 pr-2">
                  <div className="font-medium text-slate-800">
                    {sku.title.slice(0, 36)}
                  </div>
                  <div className="font-mono text-[10px] text-slate-400">
                    {sku.skuId}
                  </div>
                </td>
                <td className="py-2 pr-2 text-slate-600">
                  {sku.listPrice > 0 ? formatUsd(sku.listPrice) : "—"}
                </td>
                <td className="py-2 pr-2 text-slate-600">
                  {sku.unitsSold > 0 ? sku.unitsSold.toLocaleString() : "—"}
                </td>
                <td className="py-2 pr-2">{formatPct(sku.netMarginPct)}</td>
              <td className="py-2 pr-2">{formatUsd(sku.netProfit)}</td>
              <td className="py-2">
                <button
                  type="button"
                  className="text-[10px] font-medium text-tiktok underline"
                  onClick={() =>
                    setCompareSku((c) => (c?.skuId === sku.skuId ? null : sku))
                  }
                >
                  {compareSku?.skuId === sku.skuId ? "Hide" : "Compare"}
                </button>
              </td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
