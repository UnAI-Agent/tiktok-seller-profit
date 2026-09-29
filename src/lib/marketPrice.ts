import { computeProfit, type ProfitInput } from "./profit";

export type MarketBand = { low: number; market: number; high: number; n: number };

export type SellVerdict = "missing_cost" | "not_enough_data" | "profitable" | "tight" | "not_profitable";

export const NOT_PROFITABLE_COPY =
  "The market won't pay what you need. Skip it or find a cheaper supplier.";

function finite(values: number[]): number[] {
  return values.filter((value) => Number.isFinite(value) && value > 0);
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function marketBand(prices: number[], selfPrice?: number): MarketBand | null {
  let rows = finite(prices);
  if (selfPrice && Number.isFinite(selfPrice)) {
    const index = rows.findIndex((price) => Math.abs(price - selfPrice) < 0.001);
    if (index >= 0) rows = rows.filter((_, i) => i !== index);
  }
  if (rows.length < 8) return null;
  const sorted = [...rows].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const kept = sorted.filter((price) => price >= q1 - 3 * iqr && price <= q3 + 3 * iqr);
  if (kept.length < 8) return null;
  return {
    low: quantile(kept, 0.25),
    market: quantile(kept, 0.5),
    high: quantile(kept, 0.75),
    n: kept.length,
  };
}

export function roundUpTo99(price: number): number {
  const dollars = Math.floor(price);
  const charm = dollars + 0.99;
  const next = price <= charm + 1e-9 ? charm : dollars + 1.99;
  return Math.round(next * 100) / 100;
}

export function recommendPrice(
  band: MarketBand | null,
  goal: number | null,
): number | null {
  if (!band || goal == null || !Number.isFinite(goal)) return null;
  if (goal > band.high) return null;
  const anchor = goal <= band.market ? band.market : goal;
  const charm = roundUpTo99(anchor);
  if (charm < band.market - 0.001 || charm > band.high + 0.001) return null;
  return charm;
}

export function sellVerdict(input: {
  supplierCost: number | null;
  band: MarketBand | null;
  goal: number | null;
}): { verdict: SellVerdict; recommended: number | null } {
  if (input.supplierCost == null || !(input.supplierCost > 0)) {
    return { verdict: "missing_cost", recommended: null };
  }
  if (!input.band) return { verdict: "not_enough_data", recommended: null };
  const recommended = recommendPrice(input.band, input.goal);
  if (recommended == null) return { verdict: "not_profitable", recommended: null };
  if (input.goal != null && input.goal <= input.band.market) {
    return { verdict: "profitable", recommended };
  }
  return { verdict: "tight", recommended };
}

export function profitAtPrice(base: ProfitInput, price: number): number | null {
  if (!(price > 0) || !(base.cogsPerUnit > 0)) return null;
  const result = computeProfit({ ...base, listPrice: price, unitsSold: 1, includeRefundAdminFee: true });
  return result.netPerUnit;
}
