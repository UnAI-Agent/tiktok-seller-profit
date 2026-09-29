import { useState } from "react";
import { applyFeePreset, FEE_PRESETS, type FeePresetId } from "../config";
import { formatUsd } from "../lib/profit";
import { MANAGE_PRODUCTS_LINK } from "../lib/sellerUrl";
import type { Settings } from "../types/settings";

type WelcomeGuideProps = {
  settings: Settings;
  worst: { title: string; loss: number } | null;
  onSave: (next: Settings) => Promise<void> | void;
  onSkip: () => void;
};

export default function WelcomeGuide({ settings, worst, onSave, onSkip }: WelcomeGuideProps) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(settings);

  function saveAndNext(next: Settings) {
    setDraft(next);
    void onSave(next);
    setStep((n) => n + 1);
  }

  return (
    <div className="mt-3 flex flex-1 flex-col">
      <h2 className="text-sm font-semibold text-slate-900">Set up in under a minute</h2>
      <p className="mt-1 text-xs text-slate-500">Step {step + 1} of 3. Skip any time.</p>
      {step === 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-semibold">Pick a fee preset</p>
          <select
            className="w-full rounded border px-2 py-2 text-sm"
            value={draft.feePreset}
            onChange={(e) => setDraft(applyFeePreset(draft, e.target.value as FeePresetId))}
          >
            <option value="us-standard">{FEE_PRESETS["us-standard"].label}</option>
            <option value="us-jewelry">{FEE_PRESETS["us-jewelry"].label}</option>
            <option value="us-legacy">{FEE_PRESETS["us-legacy"].label}</option>
            <option value="custom">Custom</option>
          </select>
          <button type="button" className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white" onClick={() => saveAndNext(draft)}>
            Next
          </button>
        </div>
      )}
      {step === 1 && (
        <div className="mt-3 space-y-2 text-sm">
          <label className="flex flex-col gap-1">
            Default creator commission %
            <input type="number" min={0} className="rounded border px-2 py-1" value={draft.affiliateCommissionPct} onChange={(e) => setDraft({ ...draft, affiliateCommissionPct: Number(e.target.value) })} />
          </label>
          <label className="flex flex-col gap-1">
            Target margin %
            <input type="number" min={0} className="rounded border px-2 py-1" value={draft.targetMarginPct} onChange={(e) => setDraft({ ...draft, targetMarginPct: Number(e.target.value) })} />
          </label>
          <button type="button" className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white" onClick={() => saveAndNext(draft)}>
            Next
          </button>
        </div>
      )}
      {step === 2 && (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-semibold">Add real costs for your top sellers</p>
          <p className="text-xs text-slate-600">
            Open Manage products and we&apos;ll import your listings. Enter real COGS for your top 3 sellers.
          </p>
          {worst && (
            <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-800">
              Your &apos;{worst.title}&apos; loses {formatUsd(Math.abs(worst.loss))} per creator sale.
            </p>
          )}
          <button
            type="button"
            className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white"
            onClick={() => {
              void chrome.tabs.create({ url: MANAGE_PRODUCTS_LINK });
              onSkip();
            }}
          >
            Open Manage products
          </button>
        </div>
      )}
      <button type="button" className="mt-2 text-xs font-medium text-slate-500 hover:text-slate-800" onClick={onSkip}>
        Skip
      </button>
    </div>
  );
}
