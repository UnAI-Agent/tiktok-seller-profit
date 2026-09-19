export type Settings = {
  version: 1;
  platformFeePct: number;
  paymentFeePct: number;
  paymentFixed: number;
  defaultCogs: number;
  defaultShippingOut: number;
  /** When true, buyer pays shipping at checkout — label cost excluded from margin */
  shippingPassedToBuyer: boolean;
  defaultAdsPerUnit: number;
  refundRatePct: number;
  /** Estimated sales tax collected (% of gross) — varies by state; user-configured */
  salesTaxPct: number;
  /** Optional per-unit packaging / materials not in COGS */
  packagingPerUnit: number;
  affiliateCommissionPct: number;
  overlayEnabled: boolean;
  overlayPosition: "bottom-right" | "bottom-left";
  /** Compact chip instead of full card — persists across page clicks / navigation */
  overlayCollapsed: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  platformFeePct: 8,
  paymentFeePct: 2.9,
  paymentFixed: 0.3,
  defaultCogs: 0,
  defaultShippingOut: 0,
  shippingPassedToBuyer: true,
  defaultAdsPerUnit: 0,
  refundRatePct: 3,
  salesTaxPct: 0,
  packagingPerUnit: 0,
  affiliateCommissionPct: 10,
  overlayEnabled: true,
  overlayPosition: "bottom-right",
  overlayCollapsed: false,
};
