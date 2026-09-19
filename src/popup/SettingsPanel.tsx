import { useEffect, useState } from "react";
import type { Settings } from "../types/settings";
import SelfTestPanel from "./SelfTestPanel";

type SettingsPanelProps = {
  settings: Settings;
  onSave: (next: Settings) => Promise<void> | void;
  onLogout: () => void;
  userEmail?: string | null;
  saveStatus?: string | null;
};

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
      defaultCogs: cogs,
      defaultShippingOut: ship,
      defaultAdsPerUnit: ads,
      platformFeePct: fee,
    });
  }

  const inputClass = "rounded border border-slate-200 px-2 py-1";

  return (
    <div className="space-y-3 text-sm">
      {userEmail && (
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="min-w-0 truncate text-xs text-slate-600">{userEmail}</p>
          <button
            type="button"
            className="shrink-0 text-xs font-medium text-slate-700 underline"
            onClick={onLogout}
          >
            Log out
          </button>
        </div>
      )}

      <label className="flex items-center justify-between gap-3">
        <span>Show profit overlay on Seller Center</span>
        <input
          type="checkbox"
          checked={draft.overlayEnabled}
          onChange={(e) => patch({ overlayEnabled: e.target.checked })}
        />
      </label>

      <label className="flex items-center justify-between gap-3">
        <span>Overlay position</span>
        <select
          className={inputClass}
          value={draft.overlayPosition}
          onChange={(e) =>
            patch({
              overlayPosition: e.target.value as Settings["overlayPosition"],
            })
          }
        >
          <option value="bottom-right">Bottom right</option>
          <option value="bottom-left">Bottom left</option>
        </select>
      </label>

      <div className="border-t border-slate-200 pt-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Default fees & costs
        </p>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            Platform fee %
            <input
              type="number"
              min={0}
              required
              className={inputClass}
              value={draft.platformFeePct}
              onChange={(e) =>
                patch({ platformFeePct: Number(e.target.value) })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            Payment %
            <input
              type="number"
              min={0}
              className={inputClass}
              value={draft.paymentFeePct}
              onChange={(e) =>
                patch({ paymentFeePct: Number(e.target.value) })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            Default COGS *
            <input
              type="number"
              min={0}
              required
              className={inputClass}
              value={draft.defaultCogs}
              onChange={(e) => patch({ defaultCogs: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            Refund %
            <input
              type="number"
              min={0}
              className={inputClass}
              value={draft.refundRatePct}
              onChange={(e) =>
                patch({ refundRatePct: Number(e.target.value) })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            Est. sales tax %
            <input
              type="number"
              min={0}
              className={inputClass}
              value={draft.salesTaxPct}
              onChange={(e) =>
                patch({ salesTaxPct: Number(e.target.value) })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            Ship label / unit *
            <input
              type="number"
              min={0}
              required
              className={inputClass}
              value={draft.defaultShippingOut}
              onChange={(e) =>
                patch({ defaultShippingOut: Number(e.target.value) })
              }
            />
          </label>
          <label className="col-span-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.shippingPassedToBuyer}
              onChange={(e) =>
                patch({ shippingPassedToBuyer: e.target.checked })
              }
            />
            Buyer pays shipping at checkout (exclude label cost from margin)
          </label>
          <label className="flex flex-col gap-1">
            Ads / unit *
            <input
              type="number"
              min={0}
              required
              className={inputClass}
              value={draft.defaultAdsPerUnit}
              onChange={(e) =>
                patch({ defaultAdsPerUnit: Number(e.target.value) })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            Packaging / unit
            <input
              type="number"
              min={0}
              className={inputClass}
              value={draft.packagingPerUnit}
              onChange={(e) =>
                patch({ packagingPerUnit: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <p className="mt-2 text-[10px] text-slate-500">
          Platform % is TikTok Shop commission (default 8%; many shops use ~5–8%).
          Tax % is an estimate of sales tax on gross (set 0 if tax-inclusive).
          Uncheck buyer-pays-shipping if you subsidize free shipping.
        </p>
      </div>

      <button
        type="button"
        className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white"
        onClick={() => void handleSave()}
      >
        Save settings
      </button>
      {error && <p className="text-xs text-rose-700">{error}</p>}
      {saveStatus && !error && (
        <p className="text-center text-xs text-emerald-700">{saveStatus}</p>
      )}

      <SelfTestPanel />
    </div>
  );
}
