import type { FeePresetId } from "../config";

export const SETTINGS_VERSION = 3 as const;
export const TELEMETRY_CONSENT_VERSION = 1;

export type TelemetryConsent = {
  granted: boolean;
  version: number;
  at: string | null;
};

export type Settings = {
  version: typeof SETTINGS_VERSION;
  feePreset: FeePresetId;
  platformFeePct: number;
  paymentFeePct: number;
  paymentFixed: number;
  defaultCogs: number;
  defaultShippingOut: number;
  /** When true, buyer pays shipping at checkout — label cost excluded from margin */
  shippingPassedToBuyer: boolean;
  defaultAdsPerUnit: number;
  refundRatePct: number;
  /** Estimated sales tax collected (% of gross). Leave 0 unless you remit it. */
  salesTaxPct: number;
  /** Optional per-unit packaging / materials not in COGS */
  packagingPerUnit: number;
  affiliateCommissionPct: number;
  /** Share of units sold through creators, 0–100. */
  affiliateSharePct: number;
  /** Margin goal used by commission, ads, and price guards. */
  targetMarginPct: number;
  overlayEnabled: boolean;
  overlayPosition: "bottom-right" | "bottom-left";
  /** Compact chip instead of full card — persists across page clicks / navigation */
  overlayCollapsed: boolean;
  telemetryConsent: TelemetryConsent;
};

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  feePreset: "us-standard",
  platformFeePct: 6,
  paymentFeePct: 0,
  paymentFixed: 0,
  defaultCogs: 0,
  defaultShippingOut: 0,
  shippingPassedToBuyer: true,
  defaultAdsPerUnit: 0,
  refundRatePct: 3,
  salesTaxPct: 0,
  packagingPerUnit: 0,
  affiliateCommissionPct: 10,
  affiliateSharePct: 100,
  targetMarginPct: 15,
  overlayEnabled: true,
  overlayPosition: "bottom-right",
  overlayCollapsed: false,
  telemetryConsent: { granted: false, version: TELEMETRY_CONSENT_VERSION, at: null },
};
