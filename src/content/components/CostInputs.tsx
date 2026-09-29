import type { CostSource } from "../../types/sku";
import { CheckIcon } from "../../ui/icons";
import { cx } from "../../ui/primitives";
import { HoverTip, InfoButton, type HelpTopic } from "./FieldHelp";

export type CostDraft = {
  cogsPerUnit: number;
  shippingOut: number;
  packagingPerUnit: number;
  adsPerUnit: number;
  affiliatePct: number;
};

type CostInputsProps = {
  draft: CostDraft;
  showShipping: boolean;
  costSource: CostSource;
  periodLabel?: string;
  saved: boolean;
  focusCogs?: boolean;
  onChange: (next: CostDraft) => void;
  onBlur: (next: CostDraft) => void;
  onHelp?: (topic: HelpTopic) => void;
};

const FIELD_TIP: Partial<Record<keyof CostDraft, string>> = {
  cogsPerUnit:
    "What you paid your supplier for one unit. We subtract this from the buyer price before TikTok fees.",
  shippingOut: "The label cost you pay for one unit. Subtracted when the buyer does not cover shipping.",
  packagingPerUnit:
    "Box and insert for one unit. Subtracted like the supplier cost. Use 0 if that price already includes it.",
  adsPerUnit: "Ad spend counted on one order. Subtracted from what you keep. Use 0 if you are not running ads.",
  affiliatePct:
    "Percent of a creator sale you pay out. Applied only to the share of sales that go through creators.",
};

function MoneyField({
  label,
  keyName,
  prefix = "$",
  draft,
  onChange,
  onBlur,
  autoFocus,
}: {
  label: string;
  keyName: keyof CostDraft;
  prefix?: string;
  draft: CostDraft;
  onChange: (next: CostDraft) => void;
  onBlur: (next: CostDraft) => void;
  autoFocus?: boolean;
}) {
  const value = draft[keyName];
  const tip = FIELD_TIP[keyName];
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
      <span className="inline-flex items-center gap-1">
        {label}
        {tip && <HoverTip text={tip} />}
      </span>
      <span className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-normal text-slate-500">{prefix}</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          autoFocus={autoFocus}
          className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-6 pr-2 text-sm font-normal tabular-nums text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange({ ...draft, [keyName]: e.target.value === "" ? 0 : Number(e.target.value) })}
          onBlur={(e) => {
            const next = { ...draft, [keyName]: e.target.value === "" ? 0 : Number(e.target.value) };
            onChange(next);
            onBlur(next);
          }}
        />
      </span>
    </label>
  );
}

export default function CostInputs({
  draft,
  showShipping,
  costSource,
  periodLabel,
  saved,
  focusCogs,
  onChange,
  onBlur,
  onHelp,
}: CostInputsProps) {
  const common = { draft, onChange, onBlur };
  return (
    <section className="mx-4 rounded-xl border border-slate-200 bg-white p-3" aria-label="Your costs">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
          Your costs
          {onHelp && <InfoButton topic="costs" onOpen={onHelp} />}
        </p>
        <span
          className={cx(
            "inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 transition-opacity",
            saved ? "opacity-100" : "opacity-0",
          )}
          aria-live="polite"
        >
          <CheckIcon size={12} /> Saved
        </span>
      </div>
      {costSource === "default" && (
        <p className="mb-2 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
          Using your default cost. Enter the real one for this product.
        </p>
      )}
      {costSource === "settlement" && periodLabel && (
        <p className="mb-2 rounded-md bg-indigo-50 px-2 py-1 text-xs text-indigo-800">
          Real fees from your statement ({periodLabel})
        </p>
      )}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <MoneyField label="Product cost" keyName="cogsPerUnit" autoFocus={Boolean(focusCogs)} {...common} />
        <MoneyField label="Packaging" keyName="packagingPerUnit" {...common} />
        {showShipping && <MoneyField label="Shipping label" keyName="shippingOut" {...common} />}
        <MoneyField label="Ads per order" keyName="adsPerUnit" {...common} />
        <MoneyField label="Creator commission" keyName="affiliatePct" prefix="%" {...common} />
      </div>
    </section>
  );
}
