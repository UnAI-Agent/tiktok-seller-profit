import {
  computeProfit,
  formatPct,
  formatUsd,
  maxCpaBlended,
  maxSafeCommissionPct,
  type ProfitInput,
} from "./profit";
import { profitInputFor } from "./skuEconomics";
import type { Settings } from "../types/settings";
import type { CostSource, SkuRecord } from "../types/sku";

export type DiagnosisTone = "grey" | "red" | "amber" | "green";

export type Diagnosis = {
  status:
    | "missing-cost"
    | "promo-below-breakeven"
    | "cut-commission"
    | "cut-ads"
    | "raise-price"
    | "stop-selling"
    | "below-target"
    | "healthy";
  label: string;
  tone: DiagnosisTone;
};

export function diagnose(
  input: ProfitInput,
  costSource: CostSource,
  targetMarginPct: number,
  listPriceOriginal?: number | null,
): Diagnosis {
  if (costSource === "default") {
    return {
      status: "missing-cost",
      label: "Missing cost",
      tone: "grey",
    };
  }

  const current = computeProfit(input);
  const net = current.netPerUnit;
  if (net <= 0) {
    const original = listPriceOriginal ?? null;
    const breakEven = current.breakEvenPrice;
    if (
      original != null &&
      original > input.listPrice &&
      breakEven != null &&
      input.listPrice < breakEven &&
      original >= breakEven
    ) {
      return {
        status: "promo-below-breakeven",
        label: `Promo price is below break-even (${formatUsd(breakEven)})`,
        tone: "red",
      };
    }
    const noCommission = computeProfit({
      ...input,
      affiliatePct: 0,
      affiliateSharePct: 0,
    });
    if (noCommission.netPerUnit > 0) {
      const cap = maxSafeCommissionPct(input, 0).breakEven;
      const shown = cap == null ? 0 : Math.max(0, cap);
      return {
        status: "cut-commission",
        label: `Cut commission to ≤${formatPct(shown)}`,
        tone: "red",
      };
    }
    const noAds = computeProfit({ ...input, adsPerUnit: 0 });
    if (noAds.netPerUnit > 0) {
      const cap = maxCpaBlended(input, 0);
      const shown = cap == null ? 0 : Math.max(0, cap);
      return {
        status: "cut-ads",
        label: `Cut ads to ≤${formatUsd(shown)}/order`,
        tone: "red",
      };
    }
    const min = current.breakEvenPrice;
    const price = input.listPrice;
    if (min == null || (price > 0 && min > price * 2) || price <= 0) {
      return { status: "stop-selling", label: "Stop selling", tone: "red" };
    }
    return {
      status: "raise-price",
      label: `Raise price to ≥${formatUsd(min)}`,
      tone: "red",
    };
  }

  if (current.netMarginPct != null && current.netMarginPct < targetMarginPct) {
    return { status: "below-target", label: "Below target", tone: "amber" };
  }
  return { status: "healthy", label: "Healthy", tone: "green" };
}

export function diagnoseSku(sku: SkuRecord, settings: Settings): Diagnosis {
  return diagnose(
    profitInputFor(sku, settings),
    sku.costSource ?? "default",
    settings.targetMarginPct,
    sku.listPriceOriginal,
  );
}

export type PortfolioStats = {
  leak: number;
  losing: number;
  realCosts: number;
  total: number;
  worstCreatorLoss: { title: string; loss: number } | null;
};

export function portfolioStats(
  skus: SkuRecord[],
  settings: Settings,
): PortfolioStats {
  let leak = 0;
  let losing = 0;
  let realCosts = 0;
  let worstCreatorLoss: PortfolioStats["worstCreatorLoss"] = null;
  for (const sku of skus) {
    const source = sku.costSource ?? "default";
    if (source !== "default") realCosts += 1;
    const profit = computeProfit(profitInputFor(sku, settings));
    if (profit.netPerUnit <= 0) losing += 1;
    if (sku.unitsSold > 0 && profit.netPerUnit < 0) {
      leak += profit.netPerUnit * sku.unitsSold;
    }
    if (source !== "default" && profit.netPerUnitCreator < 0) {
      if (!worstCreatorLoss || profit.netPerUnitCreator < worstCreatorLoss.loss) {
        worstCreatorLoss = { title: sku.title, loss: profit.netPerUnitCreator };
      }
    }
  }
  return {
    leak: Math.abs(leak),
    losing,
    realCosts,
    total: skus.length,
    worstCreatorLoss,
  };
}
