import { useState } from "react";
import { formatPct, formatSignedUsd, formatUsd, marginHealthLabel, type MarginTone, type PriceGuard } from "../../lib/profit";
import { EXTENSION_SHORT_NAME } from "../../config";
import { ArrowDownIcon, ArrowUpIcon, UserIcon, MinusIcon, XIcon } from "../../ui/icons";
import { Button, PlanBadge, cx } from "../../ui/primitives";
import { TONE, type Tone } from "../../ui/tone";
import { HoverTip } from "./FieldHelp";
import MarkLogo from "./MarkLogo";
import { guardCopy } from "./PriceGuardBanner";
import { portfolioHeadline } from "../scraper/detectPageType";

export type PortfolioSummary = {
  count: number;
  missing: number;
  losing: number;
  /** Dollars lost on recorded sales by losing products (positive number). */
  leak: number;
};

type OverlayHeaderProps = {
  title: string;
  listPrice: number;
  listPriceOriginal?: number | null;
  unitsSold: number;
  netPerUnit: number;
  netMarginPct: number;
  tone: MarginTone;
  priceKnown: boolean;
  costKnown: boolean;
  guard: PriceGuard;
  showTargetGuard: boolean;
  isPro: boolean;
  planLabel?: string;
  portfolioLabel?: string;
  portfolio?: PortfolioSummary;
  /** Lifetime estimate for this product: units sold × net per sale. */
  lifetimeProfit?: number | null;
  loggedIn?: boolean;
  /** Inline cost entry shown in the hero while the cost is unknown. */
  costEntry?: {
    onCommit: (next: number) => void;
  };
  onAccount?: () => void;
  onUpgrade: () => void;
  onMinimize: () => void;
  onClose: () => void;
};

const TONE_OF: Record<MarginTone, Tone> = { profit: "profit", warning: "warning", loss: "loss" };

export function TopBar({
  isPro,
  planLabel,
  loggedIn,
  onAccount,
  onUpgrade,
  onMinimize,
  onClose,
}: Pick<OverlayHeaderProps, "isPro" | "planLabel" | "loggedIn" | "onAccount" | "onUpgrade" | "onMinimize" | "onClose">) {
  return (
    <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-slate-100 bg-white px-3 py-2" data-drag-handle>
      <span className="flex cursor-grab items-center gap-1.5 text-sm font-bold text-slate-900" data-drag-handle>
        <MarkLogo size={20} />
        {EXTENSION_SHORT_NAME}
      </span>
      {isPro ? (
        <PlanBadge tier={planLabel === "Diamond" ? "diamond" : "pro"} />
      ) : (
        <span className="flex items-center gap-1.5">
          <PlanBadge tier="free" />
          <Button variant="pro" size="sm" className="!px-2 !py-1" onClick={onUpgrade}>
            Upgrade
          </Button>
        </span>
      )}
      <span className="flex-1" data-drag-handle />
      {loggedIn && (
        <button
          type="button"
          aria-label="Account"
          title="Account"
          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          onClick={onAccount}
        >
          <UserIcon size={18} />
        </button>
      )}
      <button
        type="button"
        aria-label="Minimize"
        title="Minimize"
        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        onClick={onMinimize}
      >
        <MinusIcon size={18} />
      </button>
      <button
        type="button"
        aria-label="Close"
        title="Close"
        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        onClick={onClose}
      >
        <XIcon size={18} />
      </button>
    </div>
  );
}

/** Local draft so the hero doesn't flip to a profit view while the seller is still typing. */
function HeroCostInput({ onCommit }: { onCommit: (next: number) => void }) {
  const [value, setValue] = useState("");
  const commit = () => {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) onCommit(n);
  };
  return (
    <div className="mt-2">
      <label className="text-xs font-semibold text-slate-700" htmlFor="mm-hero-cost">
        What does one unit cost you (product + packaging)?
      </label>
      <div className="mt-1 flex items-center gap-2">
        <span className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>
          <input
            id="mm-hero-cost"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            autoFocus
            placeholder="0.00"
            className="w-28 rounded-lg border border-slate-300 bg-white py-2 pl-6 pr-2 text-base tabular-nums text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
          />
        </span>
        <Button variant="primary" disabled={!(Number(value) > 0)} onClick={commit}>
          See my profit
        </Button>
      </div>
    </div>
  );
}

function PortfolioHero({ portfolio, label }: { portfolio?: PortfolioSummary; label?: string }) {
  if (!portfolio) {
    return (
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="text-sm font-semibold text-slate-800">{label}</p>
      </div>
    );
  }
  const { count, missing, losing, leak } = portfolio;
  const priced = count - missing;
  let tone: Tone = "neutral";
  let headline = `${count} product${count === 1 ? "" : "s"} on this page`;
  let detail = "Add a cost to each product to see who makes money.";
  if (count > 0 && missing === count) {
    headline = portfolioHeadline(count, missing);
  }
  if (count > 0 && priced > 0) {
    if (losing > 0) {
      tone = "loss";
      headline = `${losing} product${losing === 1 ? " is" : "s are"} losing money`;
      detail = leak > 0 ? `About ${formatUsd(leak)} lost on sales so far.` : "Each sale costs you more than it earns.";
    } else {
      tone = "profit";
      headline = "Every priced product is profitable";
      detail = missing > 0 ? `${missing} still need a cost.` : "Nice. Check the thin ones below.";
    }
  }
  return (
    <div className={cx("border-b px-4 py-3", TONE[tone].hero)}>
      <p className={cx("text-[11px] font-bold uppercase tracking-wider", TONE[tone].text)}>Your shop at a glance</p>
      <p className={cx("mt-0.5 flex items-center gap-1.5 text-lg font-extrabold leading-tight", TONE[tone].textStrong)}>
        {tone === "loss" ? <ArrowDownIcon size={18} /> : tone === "profit" ? <ArrowUpIcon size={18} /> : null}
        {headline}
      </p>
      <p className="mt-0.5 text-xs text-slate-600">{detail}</p>
    </div>
  );
}

export default function OverlayHeader({
  title,
  listPrice,
  listPriceOriginal = null,
  unitsSold,
  netPerUnit,
  netMarginPct,
  tone,
  priceKnown,
  costKnown,
  guard,
  showTargetGuard,
  isPro,
  planLabel = "Pro",
  portfolioLabel,
  portfolio,
  lifetimeProfit = null,
  loggedIn = false,
  costEntry,
  onAccount,
  onUpgrade,
  onMinimize,
  onClose,
}: OverlayHeaderProps) {
  const known = priceKnown && costKnown;
  const heroTone: Tone = known ? TONE_OF[tone] : "neutral";
  const guardText = priceKnown ? guardCopy(guard, showTargetGuard) : null;
  const loss = guard.kind === "loss" || guard.kind === "impossible";

  return (
    <>
      <TopBar
        isPro={isPro}
        planLabel={planLabel}
        loggedIn={loggedIn}
        onAccount={onAccount}
        onUpgrade={onUpgrade}
        onMinimize={onMinimize}
        onClose={onClose}
      />
      {portfolioLabel || portfolio ? (
        <PortfolioHero portfolio={portfolio} label={portfolioLabel} />
      ) : (
        <div className={cx("border-b px-4 py-3", TONE[heroTone].hero)}>
          <div className="flex items-start justify-between gap-2">
            <p className={cx("text-[11px] font-bold uppercase tracking-wider", TONE[heroTone].text)}>
              You keep per sale
              <HoverTip text="Buyer price minus your cost, TikTok fees, shipping you pay, ads, and creator commission." />
            </p>
            {known && (
              <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums", TONE[heroTone].pill)}>
                {tone === "loss" ? <ArrowDownIcon size={11} /> : <ArrowUpIcon size={11} />}
                {formatPct(netMarginPct)} · {marginHealthLabel(tone)}
              </span>
            )}
          </div>

          {known ? (
            <p
              className={cx("mt-0.5 text-3xl font-extrabold leading-none tabular-nums tracking-tight", TONE[heroTone].text)}
              data-testid="hero-net"
              data-net={netPerUnit.toFixed(2)}
            >
              {formatSignedUsd(netPerUnit)}
            </p>
          ) : priceKnown ? (
            <div className="mt-1">
              <p className="text-sm font-semibold text-slate-800">Add your product cost to see profit</p>
              {costEntry && <HeroCostInput onCommit={costEntry.onCommit} />}
            </div>
          ) : (
            <p className="mt-1 text-sm font-semibold text-slate-700">Enter a price to see what you keep</p>
          )}

          <p className="mt-1.5 truncate text-sm font-medium text-slate-800" title={title}>
            {title}
          </p>
          <p className="text-xs tabular-nums text-slate-600">
            {listPriceOriginal != null && listPriceOriginal > listPrice
              ? `Sale ${formatUsd(listPrice)} · List ${formatUsd(listPriceOriginal)}`
              : `List ${listPrice > 0 ? formatUsd(listPrice) : "—"}`}
            {" · Sold "}
            {unitsSold > 0 ? unitsSold.toLocaleString() : "—"}
            {known && lifetimeProfit != null && unitsSold > 0 && (
              <>
                {" · "}
                <span className={cx("font-semibold", TONE[lifetimeProfit >= 0 ? "profit" : "loss"].text)}>
                  {formatSignedUsd(lifetimeProfit)} so far
                </span>
              </>
            )}
          </p>

          {guardText && (
            <p
              role={loss ? "alert" : undefined}
              className={cx(
                "mt-2 flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold",
                loss ? "bg-red-100 text-red-900" : "bg-amber-100 text-amber-900",
              )}
            >
              <span aria-hidden="true">{loss ? "⚠" : "△"}</span>
              <span>{guardText}</span>
            </p>
          )}
        </div>
      )}
    </>
  );
}
