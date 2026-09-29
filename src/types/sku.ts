export type CostSource = "default" | "custom" | "settlement";

export type ActualFees = {
  periodLabel: string;
  platformFeePct?: number;
  paymentFeePct?: number;
  paymentFixed?: number;
  affiliatePct?: number;
  affiliateSharePct?: number;
  refundRatePct?: number;
  shippingPerUnit?: number;
};

export type SkuRecord = {
  skuId: string;
  /** Variant or seller SKU ids from the edit page. Statements may use these instead of the product id. */
  skuIds?: string[];
  title: string;
  listPrice: number;
  listPriceOriginal?: number | null;
  /** Seller Center listing state, such as Live or Reviewing. */
  listingStatus?: string | null;
  stock?: number | null;
  cogsPerUnit: number;
  shippingOut: number;
  adsPerUnit: number;
  unitsSold: number;
  refundRatePct: number;
  netMarginPct: number;
  netProfit: number;
  sourceUrl: string;
  updatedAt: string;
  packagingPerUnit?: number;
  affiliatePct?: number;
  affiliateSharePct?: number;
  costSource?: CostSource;
  samplesSent?: number;
  sampleUnitCost?: number;
  actualFees?: ActualFees;
  /** Label from the last statement, such as "Aug 26–Sep 24". */
  salesPeriod?: string;
};

export type SkuStore = Record<string, SkuRecord>;
