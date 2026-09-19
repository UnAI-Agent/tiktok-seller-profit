import { useState } from "react";
import { formatUsd } from "../../lib/profit";
import {
  buildExternalPriceSearches,
  type MarketplaceSearch,
} from "../../lib/externalPriceCompare";
import { sendMessage } from "../../lib/messages";

type ExternalPriceCompareProps = {
  title: string;
  listPrice: number;
  isPro: boolean;
  compact?: boolean;
};

export default function ExternalPriceCompare({
  title,
  listPrice,
  isPro,
  compact = false,
}: ExternalPriceCompareProps) {
  const [open, setOpen] = useState(false);
  const [foundPrice, setFoundPrice] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const searches: MarketplaceSearch[] = buildExternalPriceSearches(
    title,
    listPrice,
  );

  async function runCompare() {
    if (!isPro) {
      setMsg("Pro feature — log in (top right) and upgrade.");
      return;
    }
    if (searches.length === 0) {
      setMsg("Need a product title to search.");
      return;
    }
    setMsg(null);
    const res = await sendMessage({
      type: "OPEN_EXTERNAL_COMPARE",
      searches: searches.map((s) => s.url),
    });
    if (res.ok) {
      setOpen(true);
      setMsg(
        `Opened ${searches.length} marketplaces — confirm same SKU/UPC, then note the lowest price below.`,
      );
    } else {
      setMsg("Could not open comparison tabs.");
    }
  }

  const foundNum = Number.parseFloat(foundPrice);
  let verdict: string | null = null;
  if (isPro && listPrice > 0 && Number.isFinite(foundNum) && foundNum > 0) {
    const diff = listPrice - foundNum;
    if (diff > 0.05) {
      verdict = `Elsewhere looks ${formatUsd(diff)} cheaper (${formatUsd(foundNum)} vs your ${formatUsd(listPrice)} on TikTok).`;
    } else if (diff < -0.05) {
      verdict = `Your TikTok price is ${formatUsd(-diff)} lower than this reference.`;
    } else {
      verdict = "About the same — verify shipping and variant match.";
    }
  }

  return (
    <div
      className={
        compact
          ? "border-t border-slate-100 px-3 py-2"
          : "rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"
      }
    >
      <button
        type="button"
        disabled={!title || title.length < 4}
        className={`w-full rounded-lg py-2 text-xs font-semibold ${
          isPro
            ? "bg-slate-900 text-white disabled:opacity-40"
            : "border border-dashed border-slate-300 bg-white text-slate-600"
        }`}
        onClick={() => void runCompare()}
      >
        {isPro ? "Compare prices elsewhere (Pro)" : "Compare prices elsewhere — Pro"}
      </button>

      {open && isPro && (
        <div className="mt-2 space-y-2 text-[11px] text-slate-600">
          <p>TikTok list: {listPrice > 0 ? formatUsd(listPrice) : "—"}</p>
          <label className="flex flex-col gap-1">
            Lowest price you found (same item)
            <input
              type="number"
              step="0.01"
              className="rounded border px-2 py-1 text-xs"
              placeholder="e.g. 12.99"
              value={foundPrice}
              onChange={(e) => setFoundPrice(e.target.value)}
            />
          </label>
          {verdict && (
            <p className="rounded-md bg-white px-2 py-1 font-medium text-slate-800">
              {verdict}
            </p>
          )}
        </div>
      )}

      {msg && <p className="mt-1.5 text-[10px] text-slate-500">{msg}</p>}
    </div>
  );
}
