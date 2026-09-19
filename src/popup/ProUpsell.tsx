import { useState } from "react";
import { FREE_SKU_LIMIT, PRO_PRICE_MONTHLY, PRO_PRICE_YEARLY } from "../config";
import { ApiError } from "../lib/apiErrors";
import { createCheckoutUrl } from "../lib/apiClient";

type ProUpsellProps = {
  isPro?: boolean;
  compact?: boolean;
  featureLabel?: string;
};

export default function ProUpsell({
  isPro,
  compact,
  featureLabel = "Creator Performance (Pro only)",
}: ProUpsellProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isPro) return null;

  async function handleUpgrade() {
    setBusy(true);
    setError(null);
    try {
      const url = await createCheckoutUrl("monthly");
      await chrome.tabs.create({ url });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.userMessage
          : "Checkout failed. Try again — nothing was charged.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-tiktok/20 bg-rose-50 p-3 text-sm">
      <p className="font-semibold text-slate-900">{featureLabel}</p>
      {!compact && (
        <p className="mt-1 text-slate-600">
          Pro — ${PRO_PRICE_MONTHLY}/mo or ${PRO_PRICE_YEARLY}/yr. Unlimited SKUs
          (free: {FREE_SKU_LIMIT}), creator performance, price compare, priority
          support.
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        className="mt-2 w-full rounded-lg bg-slate-900 py-2 text-xs font-semibold text-white disabled:opacity-50"
        onClick={() => void handleUpgrade()}
      >
        {busy ? "Opening checkout…" : "Upgrade to Pro"}
      </button>
      {error && (
        <p className="mt-2 rounded-md bg-white/80 px-2 py-1 text-[11px] text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
