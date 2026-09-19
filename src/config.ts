/** Deployed FastAPI backend (`backend/` in this repo). Override at build time. */
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export const SERVICE_SLUG = "tiktok-seller-tool";

/** Free tier SKU cap (Pro = unlimited) */
export const FREE_SKU_LIMIT = 10;

/** Pro pricing (display; Stripe Price IDs live on backend) */
export const PRO_PRICE_MONTHLY = 9.99;
export const PRO_PRICE_YEARLY = 99;

/** Shown in support emails / tickets when no backend. */
export const SUPPORT_EMAIL = "support@example.com";
