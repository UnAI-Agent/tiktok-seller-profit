import { describe, expect, it } from "vitest";
import { isPaidTier, tierFromProfile } from "./subscription";

describe("tierFromProfile", () => {
  it("uses the API tier, and falls back to is_pro so a Pro account never sees Upgrade", () => {
    expect(tierFromProfile(null)).toBeNull();
    expect(tierFromProfile({ is_pro: true })).toBe("pro");
    expect(tierFromProfile({ is_pro: false })).toBe("free");
    expect(tierFromProfile({ tier: "free", is_pro: false })).toBe("free");
    expect(tierFromProfile({ tier: "pro" })).toBe("pro");
    expect(tierFromProfile({ tier: "diamond" })).toBe("diamond");
  });

  it("PRO_client_is_pro_true_wins_over_stale_free_tier", () => {
    expect(tierFromProfile({ tier: "free", is_pro: true })).toBe("pro");
  });

  it("isPaidTier", () => {
    expect(isPaidTier("pro")).toBe(true);
    expect(isPaidTier("diamond")).toBe(true);
    expect(isPaidTier("free")).toBe(false);
    expect(isPaidTier(null)).toBe(false);
  });
});
