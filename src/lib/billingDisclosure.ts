import { PRO_PRICE_MONTHLY, PRO_PRICE_YEARLY } from "../config";
import tiers from "../tiers.json";

/** Kept for older screens. Prefer renewalDisclosure(). */
export const AUTO_RENEW_DISCLOSURE =
  "$14.99/month after a 7-day free trial. Renews automatically until you cancel. Cancel anytime in Manage billing.";

export type BillingInterval = "monthly" | "yearly";

/**
 * Exact text shown next to every upgrade button (auto-renewal disclosure).
 * `trial` is false once this account has used its one trial.
 */
export function renewalDisclosure(interval: BillingInterval, trial = true): string {
  const price = interval === "yearly" ? `$${PRO_PRICE_YEARLY}/year` : `$${PRO_PRICE_MONTHLY}/month`;
  const lead = trial ? `${price} after a ${tiers.pro.trialDays}-day free trial.` : `${price}, charged today.`;
  return `${lead} Renews automatically until you cancel. Cancel anytime in Manage billing.`;
}

/** "Save 33%" — derived, so it can't drift from tiers.json. */
export function yearlySavingsPct(): number {
  const yearlyIfMonthly = PRO_PRICE_MONTHLY * 12;
  return Math.round((1 - PRO_PRICE_YEARLY / yearlyIfMonthly) * 100);
}
