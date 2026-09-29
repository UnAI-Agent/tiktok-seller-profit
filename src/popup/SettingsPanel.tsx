import { useEffect, useState, type ReactNode } from "react";
import { applyFeePreset, FEE_PRESETS, type FeePresetId } from "../config";
import { DEFAULT_SETTINGS, SETTINGS_VERSION, TELEMETRY_CONSENT_VERSION, type Settings } from "../types/settings";
import { CheckIcon } from "../ui/icons";
import { Button, cx, inputClass } from "../ui/primitives";
import AccountPanel from "./AccountPanel";
import LegalFooter from "./LegalFooter";
import SelfTestPanel from "./SelfTestPanel";

type SettingsPanelProps = {
  settings: Settings;
  onSave: (next: Settings) => Promise<void> | void;
  onLogout: () => void;
  userEmail?: string | null;
  saveStatus?: string | null;
  onAccountChanged?: () => void;
  onOpenAccount?: () => void;
};

const num = (value: number) => (Number.isFinite(value) ? value : 0);

function Section({ title, onReset, children }: { title: string; onReset?: () => void; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label={title}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</h3>
        {onReset && (
          <button type="button" className="text-xs font-semibold text-slate-500 underline hover:text-slate-800" onClick={onReset}>
            Reset
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Num({
  label,
  value,
  onChange,
  step,
  hint,
  wide,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  step?: string;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <label className={cx("flex flex-col gap-1 text-xs font-semibold text-slate-700", wide && "col-span-2")}>
      {label}
      <input
        type="number"
        min={0}
        step={step}
        inputMode="decimal"
        className={inputClass}
        value={num(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <span className="text-xs font-normal text-slate-500">{hint}</span>}
    </label>
  );
}

function requiredNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function SettingsPanel({
  settings,
  onSave,
  onLogout,
  userEmail,
  saveStatus,
  onAccountChanged,
  onOpenAccount,
}: SettingsPanelProps) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  function patch(partial: Partial<Settings>) {
    setDraft((prev) => ({ ...prev, ...partial }));
    setError(null);
  }

  async function handleSave() {
    const cogs = requiredNumber(String(draft.defaultCogs));
    const ship = requiredNumber(String(draft.defaultShippingOut));
    const ads = requiredNumber(String(draft.defaultAdsPerUnit));
    const fee = requiredNumber(String(draft.platformFeePct));
    if (cogs === null || ship === null || ads === null || fee === null) {
      setError("COGS, shipping, ads, and platform fee are required (0 is OK).");
      return;
    }
    setError(null);
    await onSave({
      ...draft,
      version: SETTINGS_VERSION,
      defaultCogs: cogs,
      defaultShippingOut: ship,
      defaultAdsPerUnit: ads,
      platformFeePct: fee,
    });
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  return (
    <div className="space-y-3 bg-slate-50 px-4 py-4 text-sm">
      {userEmail && <AccountPanel onChanged={onAccountChanged} onOpenAccount={onOpenAccount} />}

      <Section
        title="Fees"
        onReset={() => patch(applyFeePreset(draft, draft.feePreset === "custom" ? "us-standard" : draft.feePreset))}
      >
        <label className="mb-3 flex flex-col gap-1 text-xs font-semibold text-slate-700">
          TikTok fee preset
          <select
            className={inputClass}
            value={draft.feePreset}
            onChange={(e) => patch(applyFeePreset(draft, e.target.value as FeePresetId))}
          >
            <option value="us-standard">{FEE_PRESETS["us-standard"].label}</option>
            <option value="us-jewelry">{FEE_PRESETS["us-jewelry"].label}</option>
            <option value="us-legacy">{FEE_PRESETS["us-legacy"].label}</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Platform fee %" value={draft.platformFeePct} onChange={(v) => patch({ platformFeePct: v, feePreset: "custom" })} />
          <Num label="Payment fee %" value={draft.paymentFeePct} onChange={(v) => patch({ paymentFeePct: v, feePreset: "custom" })} />
          <Num label="Payment fixed $" step="0.01" value={draft.paymentFixed} onChange={(v) => patch({ paymentFixed: v, feePreset: "custom" })} />
          <Num label="Refund rate %" value={draft.refundRatePct} onChange={(v) => patch({ refundRatePct: v })} />
          <Num
            wide
            label="Estimated sales tax %"
            value={draft.salesTaxPct}
            onChange={(v) => patch({ salesTaxPct: v })}
            hint="Leave 0 unless you remit sales tax yourself. TikTok collects it in most US states."
          />
        </div>
      </Section>

      <Section
        title="Your defaults"
        onReset={() =>
          patch({
            defaultCogs: DEFAULT_SETTINGS.defaultCogs,
            defaultShippingOut: DEFAULT_SETTINGS.defaultShippingOut,
            shippingPassedToBuyer: DEFAULT_SETTINGS.shippingPassedToBuyer,
            packagingPerUnit: DEFAULT_SETTINGS.packagingPerUnit,
            defaultAdsPerUnit: DEFAULT_SETTINGS.defaultAdsPerUnit,
            affiliateCommissionPct: DEFAULT_SETTINGS.affiliateCommissionPct,
            affiliateSharePct: DEFAULT_SETTINGS.affiliateSharePct,
          })
        }
      >
        <p className="mb-3 text-xs text-slate-500">Used for any product you haven't entered a cost for.</p>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Product cost $" step="0.01" value={draft.defaultCogs} onChange={(v) => patch({ defaultCogs: v })} />
          <Num label="Packaging $" step="0.01" value={draft.packagingPerUnit} onChange={(v) => patch({ packagingPerUnit: v })} />
          <Num label="Shipping label $" step="0.01" value={draft.defaultShippingOut} onChange={(v) => patch({ defaultShippingOut: v })} />
          <Num label="Ads per order $" step="0.01" value={draft.defaultAdsPerUnit} onChange={(v) => patch({ defaultAdsPerUnit: v })} />
          <Num label="Creator commission %" value={draft.affiliateCommissionPct} onChange={(v) => patch({ affiliateCommissionPct: v })} />
          <Num label="Sales via creators %" value={draft.affiliateSharePct} onChange={(v) => patch({ affiliateSharePct: v })} />
        </div>
        <label className="mt-3 flex items-start gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={draft.shippingPassedToBuyer}
            onChange={(e) => patch({ shippingPassedToBuyer: e.target.checked })}
          />
          Buyer pays shipping at checkout, so leave the label cost out of my margin
        </label>
      </Section>

      <Section title="Goal" onReset={() => patch({ targetMarginPct: DEFAULT_SETTINGS.targetMarginPct })}>
        <Num
          label="Target margin %"
          value={draft.targetMarginPct}
          onChange={(v) => patch({ targetMarginPct: v })}
          hint="Products under this show as thin. Pro uses it for max commission, ad limits, and price alerts."
        />
      </Section>

      <Section
        title="Display"
        onReset={() =>
          patch({
            overlayEnabled: DEFAULT_SETTINGS.overlayEnabled,
            overlayPosition: DEFAULT_SETTINGS.overlayPosition,
          })
        }
      >
        <label className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
          <span>Show the profit panel on Seller Center</span>
          <input type="checkbox" checked={draft.overlayEnabled} onChange={(e) => patch({ overlayEnabled: e.target.checked })} />
        </label>
        <label className="mt-3 flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
          <span>Panel position</span>
          <select
            className={cx(inputClass, "!w-auto")}
            value={draft.overlayPosition}
            onChange={(e) => patch({ overlayPosition: e.target.value as Settings["overlayPosition"] })}
          >
            <option value="bottom-right">Bottom right</option>
            <option value="bottom-left">Bottom left</option>
          </select>
        </label>
      </Section>

      <Section title="Privacy">
        <p className="text-xs leading-relaxed text-slate-600">
          Your costs and profit never leave this browser. Optionally, MarginMark can send anonymous activity about public TikTok Shop
          products (price, sold count, rating) to power Trending. It never includes your account, costs, or profit.
        </p>
        <label className="mt-3 flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
          <span>Share anonymous trending activity</span>
          <input
            type="checkbox"
            checked={draft.telemetryConsent.granted}
            onChange={(e) =>
              patch({
                telemetryConsent: {
                  granted: e.target.checked,
                  version: TELEMETRY_CONSENT_VERSION,
                  at: e.target.checked ? new Date().toISOString() : null,
                },
              })
            }
          />
        </label>
      </Section>

      {userEmail && (
        <Button variant="secondary" block onClick={onLogout}>
          Sign out
        </Button>
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <Button variant="primary" size="lg" block disabled={!dirty} onClick={() => void handleSave()}>
          {dirty ? "Save settings" : "All changes saved"}
        </Button>
        {error && <p className="mt-2 text-xs font-semibold text-red-700">{error}</p>}
        {saveStatus && !error && !dirty && (
          <p className="mt-2 flex items-center justify-center gap-1 text-xs font-semibold text-emerald-700">
            <CheckIcon size={12} /> {saveStatus}
          </p>
        )}
      </div>
      {import.meta.env.VITE_STRIP_DEV_HOSTS === "1" ? null : <SelfTestPanel />}
      <LegalFooter />
    </div>
  );
}
