import { formatPct, formatSignedUsd, formatUsd, type ProfitResult } from "../../lib/profit";
import { ChevronDownIcon } from "../../ui/icons";
import { cx } from "../../ui/primitives";
import { TONE, toneForNet } from "../../ui/tone";
import type { Settings } from "../../types/settings";
import { HoverTip } from "./FieldHelp";

type CostWaterfallProps = {
  result: ProfitResult;
  settings: Settings;
  units: number;
  cogsPerUnit: number;
  shippingInCost: number;
  adsPerUnit: number;
  affiliatePct: number;
  affiliateSharePct: number;
};

function per(total: number, units: number): number {
  return units > 0 ? total / units : total;
}

export default function CostWaterfall({
  result,
  settings,
  units,
  cogsPerUnit,
  shippingInCost,
  adsPerUnit,
  affiliatePct,
  affiliateSharePct,
}: CostWaterfallProps) {
  const u = units > 0 ? units : 1;
  const net = result.netPerUnit;
  const netTone = TONE[toneForNet(net)];
  return (
    <details className="group mx-4 rounded-xl border border-slate-200 bg-white text-xs text-slate-700">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Where the money goes</span>
        <span className="flex items-center gap-1.5">
          <span className={cx("text-sm font-bold tabular-nums", netTone.text)}>{formatSignedUsd(net)}</span>
          <ChevronDownIcon size={14} className="text-slate-400 transition group-open:rotate-180" />
        </span>
      </summary>
      <div className="space-y-1 border-t border-slate-100 px-3 py-2 tabular-nums">
        <Row label="Buyer pays" value={formatUsd(result.grossRevenue / u)} tip="What the buyer pays for one unit." kind="plus" />
        <Row
          label={`TikTok fee (${settings.platformFeePct}%)`}
          value={`-${formatUsd(per(result.platformFee, u))}`}
          tip="TikTok's percent of the buyer price. A statement replaces this estimate."
        />
        {result.paymentFee > 0 && (
          <Row label="Payment processing" value={`-${formatUsd(per(result.paymentFee, u))}`} tip="Card fee on the buyer price." />
        )}
        <Row
          label={`Product cost ${formatUsd(cogsPerUnit)}`}
          value={`-${formatUsd(per(result.cogsTotal, u))}`}
          tip="Supplier price for one unit, before TikTok fees."
        />
        {shippingInCost > 0 ? (
          <Row label={`Shipping ${formatUsd(shippingInCost)}`} value={`-${formatUsd(per(result.shippingTotal, u))}`} />
        ) : (
          settings.defaultShippingOut > 0 && (
            <p className="text-xs text-slate-500">Buyer pays shipping, so it isn't in your margin.</p>
          )
        )}
        {adsPerUnit > 0 && (
          <Row
            label={`Ads ${formatUsd(adsPerUnit)}`}
            value={`-${formatUsd(per(result.adsTotal, u))}`}
            tip="Ad spend counted on this one sale."
          />
        )}
        {affiliatePct > 0 && (
          <Row
            label={`Creator commission (${formatPct(affiliatePct)} on ${formatPct(affiliateSharePct)} of sales)`}
            value={`-${formatUsd(per(result.affiliateTotal, u))}`}
            tip="Creator percent, applied only to the share of sales that go through creators."
          />
        )}
        <Row
          label={`Refunds (${settings.refundRatePct}%)`}
          value={`-${formatUsd(per(result.refunds, u))}`}
          tip="Expected refunds, as a percent of the buyer price."
        />
        {result.refundAdminFee > 0 && (
          <Row label="Refund admin fee" value={`-${formatUsd(per(result.refundAdminFee, u))}`} />
        )}
        {result.unrecoveredShipping > 0 && (
          <Row label="Unrecovered shipping" value={`-${formatUsd(per(result.unrecoveredShipping, u))}`} />
        )}
        {result.salesTax > 0 && <Row label="Sales tax (est.)" value={`-${formatUsd(per(result.salesTax, u))}`} />}
        {result.packagingTotal > 0 && <Row label="Packaging" value={`-${formatUsd(per(result.packagingTotal, u))}`} />}
        {result.sampleTotal > 0 && <Row label="Free samples" value={`-${formatUsd(per(result.sampleTotal, u))}`} />}
        <div className={cx("mt-1 flex items-center justify-between rounded-lg px-2 py-1.5 font-bold", netTone.bg, netTone.textStrong)}>
          <span className="inline-flex items-center">
            You keep per sale
            <HoverTip text="Buyer price minus the lines above." />
          </span>
          <span>{formatSignedUsd(net)}</span>
        </div>
        <p className="inline-flex items-center text-xs text-slate-600">
          Break-even price <strong className="ml-1 text-slate-900">{result.breakEvenPrice == null ? "—" : formatUsd(result.breakEvenPrice)}</strong>
          <HoverTip text="Lowest buyer price that covers your cost and fees. Below this, each sale loses money." />
        </p>
      </div>
    </details>
  );
}

function Row({
  label,
  value,
  tip,
  kind = "minus",
}: {
  label: string;
  value: string;
  tip?: string;
  kind?: "plus" | "minus";
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="inline-flex items-center text-slate-700">
        {label}
        {tip && <HoverTip text={tip} />}
      </span>
      <span className={cx("shrink-0 font-semibold", kind === "plus" ? "text-slate-900" : "text-red-700")}>{value}</span>
    </div>
  );
}
