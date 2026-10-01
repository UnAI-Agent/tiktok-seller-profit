import { useMemo, useState } from "react";
import { buildProfitBoard, type BoardBucket } from "../../lib/profitBoard";
import { formatSignedUsd, formatUsd } from "../../lib/profit";
import type { Settings } from "../../types/settings";
import type { SkuRecord } from "../../types/sku";
import { Button, cx } from "../../ui/primitives";
import { TONE, type Tone } from "../../ui/tone";
import { useUpgrade } from "../../ui/upgrade";
import { InfoButton, type HelpTopic } from "./FieldHelp";

type ProfitBoardProps = {
  skus: SkuRecord[];
  settings: Settings;
  isPro: boolean;
  onHelp?: (topic: HelpTopic) => void;
  onAddCost?: (skuId: string) => void;
  /** Free users: a tile opens the Products tab on that filter. */
  onOpenProducts?: (bucket: BoardBucket) => void;
};

const BUCKET_LEAD: Record<BoardBucket, string> = {
  losing: "These lose money on each sale after the purchase cost and TikTok fees.",
  thin: "These still make money, under your margin goal.",
  healthy: "The purchase cost and fees are covered at your margin goal.",
  missing: "Profit stays hidden until you enter what you paid to buy the unit.",
};

const BUCKET_TONE: Record<BoardBucket, Tone> = {
  losing: "loss",
  thin: "warning",
  healthy: "profit",
  missing: "neutral",
};

function needsPurchaseCost(row: { fix: string; purchaseCost: number }): boolean {
  return row.fix === "Missing cost" || row.purchaseCost <= 0;
}

export default function ProfitBoard({ skus, settings, isPro, onHelp, onAddCost, onOpenProducts }: ProfitBoardProps) {
  const upgrade = useUpgrade();
  const board = useMemo(() => buildProfitBoard(skus, settings), [skus, settings]);
  const worst = isPro ? board.worst.slice(0, 3) : board.worst.slice(0, 1);
  const [open, setOpen] = useState<BoardBucket | null>(null);
  const selected = open ? board.members[open] : [];

  if (skus.length === 0) {
    return (
      <p className="mx-4 my-3 rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-600">
        Products on this page import automatically. Enter a cost to see who is losing money.
      </p>
    );
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
        Who is losing money
        {onHelp && <InfoButton topic="board" onOpen={onHelp} />}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {board.tiles.map((tile) => {
          const active = open === tile.id;
          const t = TONE[BUCKET_TONE[tile.id]];
          return (
            <button
              key={tile.id}
              type="button"
              aria-pressed={isPro ? active : undefined}
              className={cx(
                "rounded-xl border px-3 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500",
                t.bg,
                t.border,
                active && "ring-2 " + t.ring,
                tile.count === 0 && "opacity-70",
              )}
              onClick={() => {
                if (isPro) setOpen(active ? null : tile.id);
                else onOpenProducts?.(tile.id);
              }}
            >
              <p className={cx("text-xs font-semibold", t.text)}>{tile.label}</p>
              <p className={cx("text-2xl font-extrabold leading-none tabular-nums", t.textStrong)}>{tile.count}</p>
              {isPro && tile.id !== "missing" && (
                <p className={cx("mt-1 text-xs font-semibold tabular-nums", tile.periodProfit >= 0 ? "text-emerald-700" : "text-red-700")}>
                  {formatSignedUsd(tile.periodProfit)} this period
                </p>
              )}
            </button>
          );
        })}
      </div>
      {!isPro && board.tiles.find((tile) => tile.id === "losing")?.count ? (
        <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
          <p className="min-w-0 flex-1 text-xs font-semibold text-indigo-950">
            Pro shows the dollars lost and the exact fix for each losing product.
          </p>
          <Button variant="pro" size="sm" onClick={() => upgrade("board")}>
            See Pro
          </Button>
        </div>
      ) : null}
      {isPro && open && (
        <div className="space-y-2">
          <p className="text-xs text-slate-600">{BUCKET_LEAD[open]}</p>
          {selected.length === 0 ? (
            <p className="text-xs text-slate-500">None in this group.</p>
          ) : (
            selected.map((row) => (
              <div key={row.skuId} className={cx("rounded-xl border border-l-4 bg-white px-3 py-2", "border-slate-200", TONE[BUCKET_TONE[open]].accent)}>
                <p className="truncate text-sm font-semibold text-slate-900">{row.title}</p>
                <p className={cx("text-xs font-semibold", TONE[BUCKET_TONE[open]].text)}>{row.fix}</p>
                <p className="text-xs text-slate-600">
                  {row.listPrice > 0 ? `Buyers pay ${formatUsd(row.listPrice)}` : "Buyer price not read"}
                  {row.originalPrice != null && row.originalPrice > row.listPrice
                    ? ` · was ${formatUsd(row.originalPrice)}`
                    : ""}
                  {row.purchaseCost > 0
                    ? ` · purchase cost ${formatUsd(row.purchaseCost)}`
                    : " · purchase cost not entered"}
                </p>
                {(row.listingStatus || row.stock != null) && (
                  <p className="text-xs text-slate-500">
                    {row.listingStatus ?? "Listing"}
                    {row.stock != null ? ` · stock ${row.stock}` : ""}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-slate-500">{row.downside}</p>
                {needsPurchaseCost(row) && onAddCost && (
                  <Button variant="secondary" size="sm" className="mt-1.5" onClick={() => onAddCost(row.skuId)}>
                    Add purchase cost
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      )}
      {!open && worst.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {isPro ? "Worst products" : "Worst product"}
          </p>
          {worst.map((row) => {
            const tone: Tone = row.netPerUnit > 0 ? "profit" : "loss";
            return (
              <div
                key={row.skuId}
                className={cx("rounded-xl border border-l-4 border-slate-200 bg-white px-3 py-2", TONE[tone].accent)}
                data-board-sku={row.skuId}
                data-net={row.netPerUnit.toFixed(2)}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{row.title}</p>
                  <p className={cx("shrink-0 text-sm font-extrabold tabular-nums", TONE[tone].text)}>{formatSignedUsd(row.netPerUnit)}</p>
                </div>
                {isPro ? (
                  <p className="text-xs text-slate-600">
                    {row.unitsSold > 0 ? `${formatSignedUsd(row.periodProfit)} this period · ` : ""}
                    {row.verdict}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">per sale</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
