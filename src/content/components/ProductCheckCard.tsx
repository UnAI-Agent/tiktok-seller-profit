import { useEffect, useState } from "react";
import type { MarketBand, SellVerdict } from "../../lib/marketPrice";
import { NOT_PROFITABLE_COPY } from "../../lib/marketPrice";
import { formatUsd } from "../../lib/profit";

export type ProductCheckView = {
  title: string;
  price: number | null;
  soldLabel: string | null;
  rating: number | null;
  reviewCount: number | null;
  band: MarketBand | null;
  profits: { low: number | null; market: number | null; high: number | null };
  verdict: SellVerdict;
  recommended: number | null;
  topFlag: string | null;
  insight: string | null;
  insightLocked: boolean;
  quotaBlocked: boolean;
  parseFailed: boolean;
};

const VERDICT_TEXT: Record<SellVerdict, string> = {
  missing_cost: "Enter your cost to see profit",
  not_enough_data: "Not enough similar products",
  profitable: "Profitable",
  tight: "Tight",
  not_profitable: NOT_PROFITABLE_COPY,
};

export function ProductCheckCard({
  view,
  onCost,
}: {
  view: ProductCheckView;
  onCost: (cost: number) => void;
}) {
  const [cost, setCost] = useState("");
  const [why, setWhy] = useState(false);
  useEffect(() => {
    const amount = Number(cost);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const timer = setTimeout(() => onCost(amount), 400);
    return () => clearTimeout(timer);
  }, [cost, onCost]);

  if (view.quotaBlocked) {
    return <p className="text-sm">Daily free checks are used. Pro removes the limit.</p>;
  }

  return (
    <section className="space-y-1 text-sm text-slate-900">
      {view.parseFailed ? <p>Couldn&apos;t read this page — enter price manually</p> : null}
      <p>
        {VERDICT_TEXT[view.verdict]}
        {view.recommended != null ? ` at ${formatUsd(view.recommended)} (recommended)` : ""}
      </p>
      {view.verdict !== "missing_cost" && view.band ? (
        <p>
          Low {formatUsd(view.band.low)} → {money(view.profits.low)} · Market {formatUsd(view.band.market)} →{" "}
          {money(view.profits.market)} · High {formatUsd(view.band.high)} → {money(view.profits.high)} per sale
        </p>
      ) : null}
      <p>
        {view.soldLabel ?? "Sold count unavailable"}
        {view.rating != null ? ` · ★${view.rating.toFixed(1)}` : ""}
        {view.reviewCount != null ? ` (${view.reviewCount})` : ""}
        {view.topFlag ? ` · Top complaint: ${view.topFlag}` : ""}
      </p>
      {view.insightLocked ? <p>AI insight is a Pro feature</p> : null}
      {view.insight ? <p>{view.insight}</p> : null}
      <label className="flex flex-col gap-1 text-xs">
        Your cost
        <input
          type="number"
          min={0}
          value={cost}
          onChange={(event) => setCost(event.target.value)}
        />
      </label>
      <button type="button" onClick={() => setWhy((open) => !open)}>
        Why?
      </button>
      {why ? <p>Fees, commission, and break-even use your saved settings.</p> : null}
    </section>
  );
}

function money(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatUsd(value);
}
