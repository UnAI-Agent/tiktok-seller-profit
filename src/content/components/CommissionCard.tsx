import {
  commissionTone,
  formatPct,
  formatSignedUsd,
  maxSafeCommissionPct,
  type ProfitInput,
} from "../../lib/profit";
import { cx } from "../../ui/primitives";
import { TONE, type Tone } from "../../ui/tone";
import { MetricTip } from "./MetricTip";

type CommissionCardProps = {
  input: ProfitInput;
  currentPct: number;
  creatorNet: number;
  targetMarginPct: number;
  isPro: boolean;
  losing: boolean;
};

const CARD_TONE: Record<ReturnType<typeof commissionTone>, Tone> = {
  green: "profit",
  amber: "warning",
  red: "loss",
  unknown: "neutral",
};

/** Green up to the safe cap, amber to break-even, red beyond. A tick marks what you pay now. */
export function CommissionGauge({
  currentPct,
  safePct,
  breakEvenPct,
}: {
  currentPct: number;
  safePct: number | null;
  breakEvenPct: number;
}) {
  const safe = Math.max(0, safePct ?? 0);
  const even = Math.max(safe, breakEvenPct);
  const max = Math.max(30, currentPct * 1.25, even * 1.35);
  const at = (value: number) => `${Math.min(100, Math.max(0, (value / max) * 100))}%`;
  return (
    <div
      className="relative mt-2 h-2.5 w-full overflow-visible rounded-full bg-red-200"
      role="img"
      aria-label={`You pay ${formatPct(currentPct)}. Safe up to ${formatPct(safe)}. Break-even at ${formatPct(even)}.`}
    >
      <div className="absolute inset-y-0 left-0 rounded-l-full bg-emerald-400" style={{ width: at(safe) }} />
      <div className="absolute inset-y-0 bg-amber-300" style={{ left: at(safe), width: `calc(${at(even)} - ${at(safe)})` }} />
      <div
        className="absolute -top-1 h-5 w-1 -translate-x-1/2 rounded-full bg-slate-900 ring-2 ring-white"
        style={{ left: at(currentPct) }}
      />
    </div>
  );
}

export default function CommissionCard({
  input,
  currentPct,
  creatorNet,
  targetMarginPct,
  isPro,
}: CommissionCardProps) {
  if (!isPro) return null;

  const caps = maxSafeCommissionPct(input, targetMarginPct);
  const tone = commissionTone(currentPct, caps.breakEven, caps.atTarget);
  const t = TONE[CARD_TONE[tone]];

  return (
    <section className={cx("mx-4 rounded-xl border p-3 text-xs", t.bg, t.border)} aria-label="Creator commission">
      <p className={cx("flex items-center text-xs font-bold uppercase tracking-wider", t.text)}>
        Creator commission
        <MetricTip text="Highest creator commission before this product loses money, and before it misses your margin goal." />
      </p>
      {caps.breakEven == null || caps.breakEven <= 0 ? (
        <p className="mt-1 text-sm font-semibold text-red-800">
          This loses money even with no creator commission. Fix the price or the cost first, then come back.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-800">
            Pay creators up to{" "}
            <strong className="text-emerald-700">{caps.atTarget == null ? "—" : formatPct(Math.max(0, caps.atTarget))}</strong>{" "}
            <span className="text-slate-500">and still hit your {formatPct(targetMarginPct)} goal.</span>
          </p>
          <CommissionGauge currentPct={currentPct} safePct={caps.atTarget} breakEvenPct={Math.max(0, caps.breakEven)} />
          <div className="mt-2 grid grid-cols-3 gap-2 text-center tabular-nums">
            <div>
              <p className="text-[11px] text-slate-500">You pay</p>
              <p className="font-bold text-slate-900">{formatPct(currentPct)}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">Break-even</p>
              <p className="font-bold text-slate-900">{formatPct(Math.max(0, caps.breakEven))}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">Per creator sale</p>
              <p className={cx("font-bold", creatorNet > 0 ? "text-emerald-700" : "text-red-700")}>{formatSignedUsd(creatorNet)}</p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
