import { spsAdvice, spsAgeDays, spsColors, type SpsSnapshot } from "../../lib/sps";
import { cx } from "../../ui/primitives";

type SpsStripProps = {
  sps: SpsSnapshot | null;
  /** Show the "open Account Health" hint when no score has been read yet. */
  showHint?: boolean;
  now?: number;
};

/**
 * Shop Performance Score (0–5) with what it means for affiliate access,
 * campaigns, Flash Deals and settlement speed. Free for every seller.
 * Nothing is shown until MarginMark reads the score from the seller's own
 * Account Health page; a stale read says how old it is.
 */
export default function SpsStrip({ sps, showHint = false, now = Date.now() }: SpsStripProps) {
  if (!sps) {
    if (!showHint) return null;
    return (
      <p className="mx-4 mt-3 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[11px] text-slate-600">
        Open <b>Account Health</b> in Seller Center once and MarginMark will watch your Shop Performance Score here.
      </p>
    );
  }
  const advice = spsAdvice(sps.score);
  const { bg, text } = spsColors(advice.level);
  const age = spsAgeDays(sps.updatedAt, now);
  const ageLabel = age == null ? "" : age === 0 ? "read today" : age === 1 ? "read yesterday" : `read ${age} days ago`;
  const warn = advice.level === "at-risk" || advice.level === "critical";
  return (
    <div
      className={cx(
        "mx-4 mt-3 flex items-start gap-2.5 rounded-xl border px-3 py-2",
        warn ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50",
      )}
      role={warn ? "alert" : undefined}
      data-sps-level={advice.level}
    >
      <span
        className="inline-flex h-8 min-w-[52px] shrink-0 flex-col items-center justify-center rounded-lg px-1.5 text-center leading-none"
        style={{ backgroundColor: bg, color: text }}
        aria-label={`Shop Performance Score ${sps.score.toFixed(1)} out of 5`}
      >
        <span className="text-sm font-extrabold tabular-nums">{sps.score.toFixed(1)}</span>
        <span className="text-[9px] font-semibold opacity-90">SPS / 5</span>
      </span>
      <div className="min-w-0">
        <p className={cx("text-xs font-bold", warn ? "text-red-900" : "text-slate-900")}>{advice.headline}</p>
        <p className="text-[11px] leading-snug text-slate-600">
          {advice.detail}
          {ageLabel ? <span className="text-slate-500"> · {ageLabel}</span> : null}
        </p>
        {age != null && age >= 7 && (
          <p className="mt-0.5 text-[11px] font-semibold text-amber-800">Open Account Health to refresh this score.</p>
        )}
      </div>
    </div>
  );
}
