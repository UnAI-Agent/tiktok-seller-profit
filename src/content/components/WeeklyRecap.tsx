import { useEffect, useMemo, useState } from "react";
import { sendMessage } from "../../lib/messages";
import { trackEvent } from "../../lib/apiClient";
import { formatUsd } from "../../lib/profit";
import {
  isRecapSnapshot,
  recapFrom,
  RECAP_HISTORY_KEY,
  recordSnapshot,
  snapshotFor,
  type WeekSnapshot,
} from "../../lib/weeklyRecap";
import type { Settings } from "../../types/settings";
import type { SkuRecord } from "../../types/sku";
import ProLock from "../../ui/ProLock";
import { cx } from "../../ui/primitives";

type WeeklyRecapProps = {
  skus: SkuRecord[];
  settings: Settings;
  isPro: boolean;
  /** Fixed clock for tests. */
  now?: Date;
};

const PREVIEW = (
  <ul className="space-y-1 text-xs">
    <li>2 products started losing money</li>
    <li>3 losing products fixed</li>
    <li>Losses down $86.40 from last week</li>
  </ul>
);

/** This week against last week, computed in the browser. Saves one snapshot per week. */
export default function WeeklyRecap({ skus, settings, isPro, now }: WeeklyRecapProps) {
  const [history, setHistory] = useState<WeekSnapshot[] | null>(null);
  const current = useMemo(() => snapshotFor(skus, settings, now ?? new Date()), [skus, settings, now]);

  useEffect(() => {
    if (skus.length === 0) return;
    let cancel = false;
    void sendMessage({ type: "GET_LOCAL", keys: [RECAP_HISTORY_KEY] }).then((res) => {
      if (cancel) return;
      const raw = res.ok ? res.local?.[RECAP_HISTORY_KEY] : undefined;
      const saved = Array.isArray(raw) ? raw.filter(isRecapSnapshot) : [];
      setHistory(saved);
      void sendMessage({ type: "SET_LOCAL", values: { [RECAP_HISTORY_KEY]: recordSnapshot(saved, current) } });
    });
    return () => {
      cancel = true;
    };
  }, [current, skus.length]);

  const recap = useMemo(() => (history ? recapFrom(history, current) : null), [history, current]);

  useEffect(() => {
    if (recap?.previous) trackEvent("checkin.viewed", { pro: isPro, newLosers: recap.newLosers.length, fixed: recap.fixed.length });
  }, [recap?.previous, recap?.newLosers.length, recap?.fixed.length, isPro]);

  if (!recap || skus.length === 0) return null;
  const titles = new Map(skus.map((sku) => [sku.skuId, sku.title]));
  const names = (ids: string[]) => ids.map((id) => titles.get(id) ?? id);

  if (!recap.previous) {
    return (
      <section className="mx-4 mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs" aria-label="Weekly recap">
        <p className="font-bold text-slate-900">Weekly recap starts now</p>
        <p className="text-slate-600">
          This week's numbers are saved on your computer. Next week you'll see which products started losing money and which ones you fixed.
        </p>
      </section>
    );
  }

  const worse = recap.newLosers.length;
  const better = recap.fixed.length;
  const delta = recap.leakDelta ?? 0;
  const headline =
    worse > 0
      ? `${worse} product${worse === 1 ? "" : "s"} started losing money this week`
      : better > 0
        ? `You fixed ${better} losing product${better === 1 ? "" : "s"} this week`
        : recap.current.losingIds.length > 0
          ? `${recap.current.losingIds.length} product${recap.current.losingIds.length === 1 ? " is" : "s are"} still losing money`
          : "No products losing money this week";

  return (
    <section
      className={cx("mx-4 mt-3 rounded-xl border px-3 py-2 text-xs", worse > 0 ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50")}
      aria-label="Weekly recap"
    >
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">This week vs last week</p>
      <p className={cx("text-sm font-extrabold", worse > 0 ? "text-red-900" : "text-emerald-900")}>{headline}</p>
      {isPro ? (
        <div className="mt-1 space-y-1 text-slate-700">
          {worse > 0 && (
            <p>
              <b>New losers:</b> {names(recap.newLosers).slice(0, 4).join(", ")}
              {worse > 4 ? ` and ${worse - 4} more` : ""}
            </p>
          )}
          {better > 0 && (
            <p>
              <b>Fixed:</b> {names(recap.fixed).slice(0, 4).join(", ")}
              {better > 4 ? ` and ${better - 4} more` : ""}
            </p>
          )}
          {recap.leakDelta != null && recap.current.leakUsd + (recap.previous.leakUsd ?? 0) > 0 && (
            <p>
              <b>Losses on recorded sales:</b> {formatUsd(recap.current.leakUsd)}
              {delta !== 0 ? ` (${delta > 0 ? "up" : "down"} ${formatUsd(Math.abs(delta))})` : " (no change)"}
            </p>
          )}
          {recap.newlyCosted > 0 && <p>{recap.newlyCosted} more product{recap.newlyCosted === 1 ? "" : "s"} now have a real cost.</p>}
          {recap.current.missingIds.length > 0 && (
            <p className="text-slate-500">{recap.current.missingIds.length} still need a cost.</p>
          )}
        </div>
      ) : (
        <div className="mt-2">
          <ProLock
            compact
            placement="weekly-recap"
            title="See what changed and why"
            blurb="Pro names each new loser and fix, and tracks your losses week by week."
            preview={PREVIEW}
          />
        </div>
      )}
    </section>
  );
}
