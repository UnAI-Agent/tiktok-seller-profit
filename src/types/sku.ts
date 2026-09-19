export type SkuRecord = {
  skuId: string;
  title: string;
  listPrice: number;
  cogsPerUnit: number;
  shippingOut: number;
  adsPerUnit: number;
  unitsSold: number;
  refundRatePct: number;
  netMarginPct: number;
  netProfit: number;
  sourceUrl: string;
  updatedAt: string;
};

export type SkuStore = Record<string, SkuRecord>;
