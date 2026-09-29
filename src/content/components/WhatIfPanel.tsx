import { useMemo, useState } from "react";
import {
  computeProfit,
  formatPct,
  formatSignedUsd,
  formatUsd,
  marginHealthLabel,
  marginTone,
  type ProfitInput,
} from "../../lib/profit";
import { ChevronDownIcon } from "../../ui/icons";
import { Button, cx } from "../../ui/primitives";
import { TONE } from "../../ui/tone";
import { HoverTip } from "./FieldHelp";

type WhatIfPanelProps = {
  base: ProfitInput;
  targetMarginPct: number;
  isPro: boolean;
};

export default function WhatIfPanel({ base, targetMarginPct, isPro }: WhatIfPanelProps) {
  const [price, setPrice] = useState(base.listPrice || 0);
  const [commission, setCommission] = useState(base.affiliatePct ?? 0);
  const [ads, setAds] = useState(base.adsPerUnit);
  const [copied, setCopied] = useState(false);

  const preview = useMemo(
    () =>
      computeProfit({
        ...base,
        listPrice: price,
        affiliatePct: commission,
        adsPerUnit: ads,
        unitsSold: 1,
      }),
    [base, price, commission, ads],
  );
  const tone = marginTone(preview.netPerUnit, preview.netMarginPct, targetMarginPct);

  if (!isPro) return null;

  async function applyPrice() {
    try {
      await navigator.clipboard.writeText(price.toFixed(2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const t = TONE[tone];
  return (
    <details className="group mx-4 rounded-xl border border-slate-200 bg-white text-xs text-slate-700">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">What if I change…</span>
        <ChevronDownIcon size={14} className="text-slate-400 transition group-open:rotate-180" />
      </summary>
      <div className="space-y-2 border-t border-slate-100 px-3 py-2">
        <label className="block font-semibold">
          Price {formatUsd(price)}
          <input
            type="range"
            min={0}
            max={Math.max(price * 2, base.listPrice * 2, 40)}
            step={0.1}
            value={price}
            className="mt-1 w-full accent-slate-900"
            onChange={(e) => setPrice(Number(e.target.value))}
          />
        </label>
        <label className="block font-semibold">
          Commission {formatPct(commission)}
          <input
            type="range"
            min={0}
            max={60}
            step={0.5}
            value={commission}
            className="mt-1 w-full accent-slate-900"
            onChange={(e) => setCommission(Number(e.target.value))}
          />
        </label>
        <label className="block font-semibold">
          Ads per order {formatUsd(ads)}
          <input
            type="range"
            min={0}
            max={Math.max(ads * 2, 15)}
            step={0.1}
            value={ads}
            className="mt-1 w-full accent-slate-900"
            onChange={(e) => setAds(Number(e.target.value))}
          />
        </label>
        <div className={cx("flex items-center justify-between rounded-lg px-2.5 py-2 font-bold tabular-nums", t.bg, t.textStrong)}>
          <span className="inline-flex items-center">
            You'd keep
            <HoverTip text="Same math as the live number: buyer price minus cost, fees, ads, and commission." />
          </span>
          <span>
            {formatSignedUsd(preview.netPerUnit)} · {preview.netMarginPct == null ? "—" : formatPct(preview.netMarginPct)}{" "}
            {marginHealthLabel(tone)}
          </span>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void applyPrice()}>
          {copied ? "Price copied" : "Copy this price"}
        </Button>
      </div>
    </details>
  );
}
