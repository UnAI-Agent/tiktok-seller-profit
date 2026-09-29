import { refundExtraPerUnit } from "./refundFees";

export type ProfitInput = {
  listPrice: number;
  unitsSold: number;
  orderCount?: number;
  cogsPerUnit: number;
  shippingOut: number;
  adsPerUnit: number;
  platformFeePct: number;
  paymentFeePct: number;
  paymentFixed: number;
  refundRatePct: number;
  /** Estimated tax on revenue (not income tax). Set 0 if TikTok remits it. */
  salesTaxPct?: number;
  packagingPerUnit?: number;
  /** Creator commission percent of a creator sale. */
  affiliatePct?: number;
  /** Share of units sold via creators, 0–100. */
  affiliateSharePct?: number;
  samplesSent?: number;
  /** Defaults to COGS + shipping when omitted. */
  sampleUnitCost?: number;
  /** Adds the documented refund admin fee and unrecovered shipping. */
  includeRefundAdminFee?: boolean;
  /** Label cost not already in shippingOut. Used only when the admin-fee flag is on. */
  unrecoveredShipPerUnit?: number;
};

export type ProfitModel = {
  r0: number;
  c: number;
  s: number;
  F: number;
  A: number;
  P: number;
  /** Contribution before commission and ads. */
  K: number;
  sampleCostPerUnit: number;
  netDirect: number;
  netCreator: number;
  netBlended: number;
  breakEvenPrice: number | null;
  refundAdminPerUnit: number;
  unrecoveredShipPerUnit: number;
};

export type ProfitResult = {
  grossRevenue: number;
  platformFee: number;
  paymentFee: number;
  cogsTotal: number;
  shippingTotal: number;
  adsTotal: number;
  refunds: number;
  refundAdminFee: number;
  unrecoveredShipping: number;
  salesTax: number;
  packagingTotal: number;
  affiliateTotal: number;
  sampleTotal: number;
  sampleCostPerUnit: number;
  totalCosts: number;
  netProfit: number;
  netPerUnit: number;
  netPerUnitDirect: number;
  netPerUnitCreator: number;
  /** Null when price is 0 so a loading editor is not shown as 0% margin. */
  netMarginPct: number | null;
  breakEvenPrice: number | null;
  contribution: number;
};

export type MarginTone = "profit" | "warning" | "loss";

export type PriceGuard =
  | { kind: "impossible" }
  | { kind: "loss"; lossPerSale: number; minPrice: number }
  | { kind: "below-target"; targetPrice: number; targetMarginPct: number }
  | { kind: "ok" };

export const NOT_PROFITABLE_AT_ANY_PRICE =
  "Not profitable at any price with these costs";

function n(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Per-unit model. Denominator ≤ 0 yields a null break-even price. */
export function profitModel(input: ProfitInput): ProfitModel {
  const r0 =
    (n(input.platformFeePct) +
      n(input.paymentFeePct) +
      n(input.refundRatePct) +
      n(input.salesTaxPct)) /
    100;
  const c = n(input.affiliatePct) / 100;
  const s = n(input.affiliateSharePct) / 100;
  const sampleDenom = Math.max(n(input.unitsSold), 1);
  const sampleUnit = input.sampleUnitCost ?? n(input.cogsPerUnit) + n(input.shippingOut);
  const samplesSent = n(input.samplesSent);
  const sampleCostPerUnit =
    samplesSent > 0 ? (samplesSent * sampleUnit) / sampleDenom : 0;
  let F =
    n(input.cogsPerUnit) +
    n(input.shippingOut) +
    n(input.packagingPerUnit) +
    n(input.paymentFixed) +
    sampleCostPerUnit;
  const A = n(input.adsPerUnit);
  const P = n(input.listPrice);
  let refundAdminPerUnit = 0;
  let unrecoveredShipPerUnit = 0;
  if (input.includeRefundAdminFee) {
    const extra = refundExtraPerUnit({
      listPrice: P,
      platformFeePct: n(input.platformFeePct),
      refundRatePct: n(input.refundRatePct),
      unrecoveredShipPerUnit: n(input.unrecoveredShipPerUnit),
    });
    refundAdminPerUnit = extra.adminFee;
    unrecoveredShipPerUnit = extra.unrecoveredShipping;
    F += extra.total;
  }
  const K = P * (1 - r0) - F;
  const denom = 1 - r0 - c * s;
  return {
    r0,
    c,
    s,
    F,
    A,
    P,
    K,
    sampleCostPerUnit,
    netDirect: K - A,
    netCreator: K - P * c - A,
    netBlended: K - P * c * s - A,
    breakEvenPrice: denom > 0 ? (F + A) / denom : null,
    refundAdminPerUnit,
    unrecoveredShipPerUnit,
  };
}

export function targetPrice(
  input: ProfitInput,
  targetMarginPct: number,
): number | null {
  const { r0, c, s, F, A } = profitModel(input);
  const m = n(targetMarginPct) / 100;
  const denom = 1 - r0 - c * s - m;
  if (!(denom > 0)) return null;
  return (F + A) / denom;
}

export function computeProfit(input: ProfitInput): ProfitResult {
  const model = profitModel(input);
  const units = n(input.unitsSold);
  const orders = input.orderCount ?? units;
  const platformPct = n(input.platformFeePct) / 100;
  const paymentPct = n(input.paymentFeePct) / 100;
  const refundPct = n(input.refundRatePct) / 100;
  const taxPct = n(input.salesTaxPct) / 100;
  const grossRevenue = model.P * units;
  const platformFee = grossRevenue * platformPct;
  const paymentFee = grossRevenue * paymentPct + n(input.paymentFixed) * orders;
  const cogsTotal = n(input.cogsPerUnit) * units;
  const shippingTotal = n(input.shippingOut) * units;
  const adsTotal = model.A * units;
  const refunds = grossRevenue * refundPct;
  const refundAdminFee = model.refundAdminPerUnit * units;
  const unrecoveredShipping = model.unrecoveredShipPerUnit * units;
  const salesTax = grossRevenue * taxPct;
  const packagingTotal = n(input.packagingPerUnit) * units;
  const affiliateTotal = grossRevenue * model.c * model.s;
  const sampleTotal = model.sampleCostPerUnit * units;
  const totalCosts =
    platformFee +
    paymentFee +
    cogsTotal +
    shippingTotal +
    adsTotal +
    refunds +
    refundAdminFee +
    unrecoveredShipping +
    salesTax +
    packagingTotal +
    affiliateTotal +
    sampleTotal;
  const netProfit = grossRevenue - totalCosts;
  return {
    grossRevenue,
    platformFee,
    paymentFee,
    cogsTotal,
    shippingTotal,
    adsTotal,
    refunds,
    refundAdminFee,
    unrecoveredShipping,
    salesTax,
    packagingTotal,
    affiliateTotal,
    sampleTotal,
    sampleCostPerUnit: model.sampleCostPerUnit,
    totalCosts,
    netProfit,
    netPerUnit: model.netBlended,
    netPerUnitDirect: model.netDirect,
    netPerUnitCreator: model.netCreator,
    netMarginPct: model.P > 0 ? (model.netBlended / model.P) * 100 : null,
    breakEvenPrice: model.breakEvenPrice,
    contribution: model.K,
  };
}

export function maxSafeCommissionPct(
  input: ProfitInput,
  targetMarginPct: number,
): { breakEven: number | null; atTarget: number | null } {
  const { K, A, P } = profitModel(input);
  if (!(P > 0)) return { breakEven: null, atTarget: null };
  const m = n(targetMarginPct) / 100;
  const breakEven = ((K - A) / P) * 100;
  const atTarget = ((K - A - m * P) / P) * 100;
  return {
    breakEven: Number.isFinite(breakEven) ? breakEven : null,
    atTarget: Number.isFinite(atTarget) ? atTarget : null,
  };
}

export function maxCpa(
  input: ProfitInput,
  targetMarginPct: number,
): { direct: number | null; creator: number | null } {
  const { K, P, c } = profitModel(input);
  const m = n(targetMarginPct) / 100;
  const direct = K - m * P;
  const creator = K - P * c - m * P;
  return {
    direct: Number.isFinite(direct) ? direct : null,
    creator: Number.isFinite(creator) ? creator : null,
  };
}

/** Blended max ad cost per order at the current creator share. */
export function maxCpaBlended(
  input: ProfitInput,
  targetMarginPct: number,
): number | null {
  const { K, P, c, s } = profitModel(input);
  const m = n(targetMarginPct) / 100;
  const value = K - P * c * s - m * P;
  return Number.isFinite(value) ? value : null;
}

export function breakEvenRoas(
  input: ProfitInput,
  targetMarginPct: number,
  mode: "direct" | "creator",
): number | null {
  const caps = maxCpa(input, targetMarginPct);
  const cap = mode === "direct" ? caps.direct : caps.creator;
  if (cap == null || cap <= 0 || !(n(input.listPrice) > 0)) return null;
  return input.listPrice / cap;
}

export function priceGuard(
  input: ProfitInput,
  targetMarginPct: number,
): PriceGuard {
  const model = profitModel(input);
  if (model.breakEvenPrice == null) return { kind: "impossible" };
  if (!(model.P > 0)) return { kind: "ok" };
  if (model.P < model.breakEvenPrice) {
    return {
      kind: "loss",
      lossPerSale: Math.max(0, -model.netBlended),
      minPrice: model.breakEvenPrice,
    };
  }
  const goal = targetPrice(input, targetMarginPct);
  if (goal != null && model.P < goal) {
    return { kind: "below-target", targetPrice: goal, targetMarginPct };
  }
  return { kind: "ok" };
}

export type CommissionTone = "green" | "amber" | "red" | "unknown";

export function commissionTone(
  currentPct: number,
  breakEvenPct: number | null,
  targetPct: number | null,
): CommissionTone {
  if (breakEvenPct == null) return "unknown";
  if (targetPct != null && currentPct <= targetPct) return "green";
  if (currentPct <= breakEvenPct) return "amber";
  return "red";
}

export function marginTone(
  netProfit: number,
  netMarginPct: number | null,
  targetMarginPct = 15,
): MarginTone {
  if (netProfit <= 0) return "loss";
  if (netMarginPct == null || netMarginPct < targetMarginPct) return "warning";
  return "profit";
}

export function marginHealthLabel(tone: MarginTone): string {
  if (tone === "profit") return "GOOD";
  if (tone === "warning") return "CAUTION";
  return "LOSS";
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

/** "+$3.20" / "-$1.81" / "$0.00". Green/red screens use the sign, not just the color. */
export function formatSignedUsd(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) return formatUsd(0);
  const body = formatUsd(Math.abs(value));
  return value > 0 ? `+${body}` : `-${body}`;
}

export function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatRoas(value: number | null): string {
  if (value == null) return "not possible";
  return value.toFixed(1);
}

export function formatUsdOr(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatUsd(value);
}
