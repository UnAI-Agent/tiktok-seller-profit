import {
  breakEvenRoas,
  formatRoas,
  formatUsd,
  maxCpa,
  type ProfitInput,
} from "../../lib/profit";
import { MetricTip } from "./MetricTip";

type AdsCardProps = {
  input: ProfitInput;
  targetMarginPct: number;
  isPro: boolean;
};

function cell(value: number | null): string {
  if (value == null) return "—";
  if (value <= 0) return "not possible";
  return formatUsd(value);
}

export default function AdsCard({ input, targetMarginPct, isPro }: AdsCardProps) {
  if (!isPro) return null;

  const be = maxCpa(input, 0);
  const goal = maxCpa(input, targetMarginPct);
  const roasBeDirect = breakEvenRoas(input, 0, "direct");
  const roasGoalDirect = breakEvenRoas(input, targetMarginPct, "direct");
  const roasBeCreator = breakEvenRoas(input, 0, "creator");
  const roasGoalCreator = breakEvenRoas(input, targetMarginPct, "creator");

  return (
    <section className="mx-4 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700" aria-label="Ad limits">
      <p className="flex items-center text-xs font-bold uppercase tracking-wider text-slate-500">
        Ad limits
        <MetricTip text="ROAS = revenue ÷ ad spend. Below this number your ads lose money after fees, commission, and product cost." />
      </p>
      <p className="mt-1 text-sm text-slate-800">
        Spend up to <strong className="text-emerald-700">{cell(goal.direct)}</strong> per order and keep your {targetMarginPct}% margin.
        <span className="text-slate-500"> Break-even: {cell(be.direct)}.</span>
      </p>
      <table className="mt-2 w-full tabular-nums">
        <thead>
          <tr className="text-left text-[11px] text-slate-500">
            <th className="font-medium"> </th>
            <th className="font-semibold">Direct sale</th>
            <th className="font-semibold">Creator sale</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-slate-100">
            <td className="py-1">
              <span className="inline-flex items-center">
                Max CPA, break-even
                <MetricTip text="Most you can spend on ads for one order and still cover cost and fees." />
              </span>
            </td>
            <td className="font-semibold">{cell(be.direct)}</td>
            <td className="font-semibold">{cell(be.creator)}</td>
          </tr>
          <tr className="border-t border-slate-100">
            <td className="py-1">Max CPA at {targetMarginPct}%</td>
            <td className="font-semibold text-emerald-700">{cell(goal.direct)}</td>
            <td className="font-semibold text-emerald-700">{cell(goal.creator)}</td>
          </tr>
          <tr className="border-t border-slate-100">
            <td className="py-1">
              <span className="inline-flex items-center">
                GMV Max ROI ≥
                <MetricTip text="Revenue divided by ad spend. The first number breaks even. The second hits your margin goal." />
              </span>
            </td>
            <td className="font-semibold">
              {formatRoas(roasBeDirect)} / {formatRoas(roasGoalDirect)}
            </td>
            <td className="font-semibold">
              {formatRoas(roasBeCreator)} / {formatRoas(roasGoalCreator)}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-slate-500">ROI pair is break-even / your {targetMarginPct}% target.</p>
    </section>
  );
}
