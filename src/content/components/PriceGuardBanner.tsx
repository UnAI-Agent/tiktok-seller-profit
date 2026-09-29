import type { PriceGuard } from "../../lib/profit";
import { NOT_PROFITABLE_AT_ANY_PRICE, formatPct, formatUsd } from "../../lib/profit";

type PriceGuardBannerProps = {
  guard: PriceGuard;
  showTarget: boolean;
};

export function guardCopy(guard: PriceGuard, showTarget: boolean): string | null {
  if (guard.kind === "impossible") return NOT_PROFITABLE_AT_ANY_PRICE;
  if (guard.kind === "loss") {
    return `Below break-even. Each sale loses ${formatUsd(guard.lossPerSale)}. Minimum price: ${formatUsd(guard.minPrice)}.`;
  }
  if (guard.kind === "below-target" && showTarget) {
    return `Below your ${formatPct(guard.targetMarginPct)} target. Target price: ${formatUsd(guard.targetPrice)}.`;
  }
  return null;
}

export default function PriceGuardBanner({ guard, showTarget }: PriceGuardBannerProps) {
  const text = guardCopy(guard, showTarget);
  if (!text) return null;
  const loss = guard.kind === "loss" || guard.kind === "impossible";
  return (
    <p
      className={`mx-3 mt-2 rounded-md px-2 py-1 text-[11px] ${
        loss ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"
      }`}
    >
      {loss ? "⚠ " : ""}
      {text}
    </p>
  );
}
