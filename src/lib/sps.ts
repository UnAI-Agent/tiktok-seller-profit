/**
 * TikTok Shop US Shop Performance Score (SPS): 0 to 5, shown in Seller Center
 * under Account Health once a shop has 30+ orders in 90 days.
 *
 * Thresholds that change what a seller can do (TikTok Shop Academy, 2026):
 *   2.5+  Flash Deals, TikTok-funded promotions, Shop Ads
 *   3.0   below this, active affiliate plans and campaigns are ended
 *   3.5+  affiliate marketing, campaigns, accelerated settlement
 *   4.0+  Express Settlement, Star Seller eligibility
 */
export const SPS_MAX = 5;

export type SpsLevel = "top" | "good" | "at-risk" | "critical";

export type SpsSnapshot = {
  score: number;
  /** Only a score read from the seller's own Seller Center page is ever stored. */
  source: "native";
  /** When the score was read. Never bumped without a fresh read. */
  updatedAt: string;
};

export function isValidSpsScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= SPS_MAX;
}

export function spsLevel(score: number): SpsLevel {
  if (score >= 4) return "top";
  if (score >= 3.5) return "good";
  if (score >= 3) return "at-risk";
  return "critical";
}

export function spsColors(level: SpsLevel): { bg: string; text: string } {
  switch (level) {
    case "top":
      return { bg: "#15803D", text: "#ffffff" };
    case "good":
      return { bg: "#1D4ED8", text: "#ffffff" };
    case "at-risk":
      return { bg: "#B45309", text: "#ffffff" };
    case "critical":
      return { bg: "#B91C1C", text: "#ffffff" };
  }
}

export type SpsAdvice = { level: SpsLevel; headline: string; detail: string };

export function spsAdvice(score: number): SpsAdvice {
  const level = spsLevel(score);
  if (score < 2.5) {
    return {
      level,
      headline: "Flash Deals and Shop Ads are off",
      detail: "Below 2.5 you lose Flash Deals and Shop Ads, and below 3.0 TikTok ends your affiliate plans and campaigns. Fix late shipments and cancellations first.",
    };
  }
  if (score < 3) {
    return {
      level,
      headline: "Affiliate plans and campaigns are cut off",
      detail: "Below 3.0 TikTok ends active affiliate plans and campaigns. Get back above 3.5 to reopen them.",
    };
  }
  if (score < 3.5) {
    return {
      level,
      headline: "One dip from losing creators",
      detail: "New affiliate plans and campaigns need 3.5. Below 3.0 your current ones end.",
    };
  }
  if (score < 4) {
    return {
      level,
      headline: "Affiliate and campaigns unlocked",
      detail: "Reach 4.0 for Express Settlement and Star Seller.",
    };
  }
  return {
    level,
    headline: "Top tier",
    detail: "Express Settlement and Star Seller range. Keep shipping on time.",
  };
}

/** Whole days since the score was read, or null when the date is unreadable. */
export function spsAgeDays(updatedAt: string, now: number = Date.now()): number | null {
  const at = Date.parse(updatedAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((now - at) / 86_400_000));
}

const SCORE_RE = /(?<![\d.])([0-5](?:\.\d{1,2})?)(?![\d.]|\s*%)/;

/** First 0–5 score in a snippet of text, such as "4.2", "3.5 / 5" or "Score: 2.75". */
export function parseSpsScore(text: string): number | null {
  const match = SCORE_RE.exec(text.replace(/\s+/g, " "));
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  return isValidSpsScore(value) ? value : null;
}
