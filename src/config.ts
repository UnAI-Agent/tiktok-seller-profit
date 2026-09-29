import tiers from "./tiers.json";

/** Laptop API for unpacked builds. LLE and prod set VITE_API_BASE_URL. A stripped prod build stays empty if that var is missing. */
const localApi = "http://127.0.0.1:8000";
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.VITE_STRIP_DEV_HOSTS === "1" ? "" : localApi);

/** Set only by scripts/build-lle.ps1. Prod builds leave this empty so the strip is omitted. */
export const LLE_TEST_BANNER =
  import.meta.env.VITE_LLE_BADGE === "1" ? ["LLE", "test data"].join(": ") : "";

export const SERVICE_SLUG = "tiktok-seller-tool";

/** Free tier cap on products with a saved cost (Pro and Diamond = unlimited). One knob: tiers.json free.skuLimit. */
export const FREE_SKU_LIMIT: number = tiers.free.skuLimit;

/** Pro pricing (display; Stripe Price IDs live on backend). */
export const TIER_LIMITS = tiers;
export const PRO_PRICE_MONTHLY = tiers.pro.monthlyUsd;
export const PRO_PRICE_YEARLY = tiers.pro.yearlyUsd;
export const DIAMOND_PRICE_MONTHLY = tiers.diamond.monthlyUsd;
export const DIAMOND_PRICE_YEARLY = tiers.diamond.yearlyUsd;

/** Chrome Web Store name. Not an official TikTok product. */
export const EXTENSION_NAME = "MarginMark — Profit Calculator for TikTok Shop Sellers";
export const EXTENSION_SHORT_NAME = "MarginMark";
export const PUBLISHER_NAME = "Plainsman Software";

export type FeePresetId = "us-standard" | "us-jewelry" | "us-legacy" | "custom";

/**
 * 2026 US referral fees. Payment stays 0 on the current presets because those
 * sources say processing is already inside the referral. The legacy preset
 * keeps the older 8% + 2.9% + $0.30 terms.
 */
export const FEE_PRESETS = {
  "us-standard": {
    label: "US standard (6%, processing included)",
    platformFeePct: 6,
    paymentFeePct: 0,
    paymentFixed: 0,
  },
  "us-jewelry": {
    label: "US jewelry (5%)",
    platformFeePct: 5,
    paymentFeePct: 0,
    paymentFixed: 0,
  },
  "us-legacy": {
    label: "US legacy (8% + 2.9% + $0.30)",
    platformFeePct: 8,
    paymentFeePct: 2.9,
    paymentFixed: 0.3,
  },
} as const;

export const NAMED_FEE_PRESET_IDS = ["us-standard", "us-jewelry", "us-legacy"] as const;

export function inferFeePreset(fees: {
  platformFeePct: number;
  paymentFeePct: number;
  paymentFixed: number;
}): FeePresetId {
  for (const id of NAMED_FEE_PRESET_IDS) {
    const preset = FEE_PRESETS[id];
    if (
      fees.platformFeePct === preset.platformFeePct &&
      fees.paymentFeePct === preset.paymentFeePct &&
      fees.paymentFixed === preset.paymentFixed
    ) {
      return id;
    }
  }
  return "custom";
}

export function applyFeePreset<
  T extends {
    platformFeePct: number;
    paymentFeePct: number;
    paymentFixed: number;
    feePreset: FeePresetId;
  },
>(settings: T, preset: FeePresetId): T {
  if (preset === "custom") return { ...settings, feePreset: "custom" };
  const next = FEE_PRESETS[preset];
  return {
    ...settings,
    feePreset: preset,
    platformFeePct: next.platformFeePct,
    paymentFeePct: next.paymentFeePct,
    paymentFixed: next.paymentFixed,
  };
}

/** Shown in support emails / tickets when no backend. */
export const SUPPORT_EMAIL = "support@plainsmansoftware.com";
export const WEBSITE_URL = "https://plainsmansoftware.com/marginmark";
export const PRIVACY_URL = "https://plainsmansoftware.com/marginmark/privacy";
export const TERMS_URL = "https://plainsmansoftware.com/marginmark/terms";
