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
  /** Estimated tax on revenue (not income tax). Set 0 if price is tax-inclusive. */
  salesTaxPct?: number;
  packagingPerUnit?: number;
};

export type ProfitResult = {
  grossRevenue: number;
  platformFee: number;
  paymentFee: number;
  cogsTotal: number;
  shippingTotal: number;
  adsTotal: number;
  refunds: number;
  salesTax: number;
  packagingTotal: number;
  totalCosts: number;
  netProfit: number;
  netMarginPct: number;
  breakEvenPrice: number;
};

export type MarginTone = "profit" | "warning" | "loss";

export function computeProfit(input: ProfitInput): ProfitResult {
  const {
    listPrice,
    unitsSold,
    cogsPerUnit,
    shippingOut,
    adsPerUnit,
    platformFeePct,
    paymentFeePct,
    paymentFixed,
    refundRatePct,
    salesTaxPct = 0,
    packagingPerUnit = 0,
  } = input;

  const orderCount = input.orderCount ?? unitsSold;
  const grossRevenue = listPrice * unitsSold;
  const platformFee = grossRevenue * (platformFeePct / 100);
  const paymentFee =
    grossRevenue * (paymentFeePct / 100) + paymentFixed * orderCount;
  const cogsTotal = cogsPerUnit * unitsSold;
  const shippingTotal = shippingOut * unitsSold;
  const adsTotal = adsPerUnit * unitsSold;
  const refunds = grossRevenue * (refundRatePct / 100);
  const salesTax = grossRevenue * (salesTaxPct / 100);
  const packagingTotal = packagingPerUnit * unitsSold;

  const totalCosts =
    platformFee +
    paymentFee +
    cogsTotal +
    shippingTotal +
    adsTotal +
    refunds +
    salesTax +
    packagingTotal;
  const netProfit = grossRevenue - totalCosts;
  const netMarginPct =
    grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;

  const feeSumPct = platformFeePct + paymentFeePct + refundRatePct;
  const denom = 1 - feeSumPct / 100;
  const breakEvenPrice =
    denom > 0
      ? (cogsPerUnit + shippingOut + adsPerUnit + paymentFixed) / denom
      : 0;

  return {
    grossRevenue,
    platformFee,
    paymentFee,
    cogsTotal,
    shippingTotal,
    adsTotal,
    refunds,
    salesTax,
    packagingTotal,
    totalCosts,
    netProfit,
    netMarginPct,
    breakEvenPrice,
  };
}

export function marginTone(netProfit: number, netMarginPct: number): MarginTone {
  if (netProfit <= 0) return "loss";
  if (netMarginPct < 15) return "warning";
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

export function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}
