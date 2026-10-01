import { describe, expect, it } from "vitest";
import { isValidSpsScore, parseSpsScore, spsAdvice, spsAgeDays, spsLevel } from "./sps";

describe("Shop Performance Score (0-5) @F-SPS", () => {
  it("uses TikTok's thresholds: 2.5 promos, 3.0 affiliate cut-off, 3.5 affiliate access, 4.0 express", () => {
    expect(spsLevel(4.6)).toBe("top");
    expect(spsLevel(4.0)).toBe("top");
    expect(spsLevel(3.99)).toBe("good");
    expect(spsLevel(3.5)).toBe("good");
    expect(spsLevel(3.49)).toBe("at-risk");
    expect(spsLevel(3.0)).toBe("at-risk");
    expect(spsLevel(2.99)).toBe("critical");
    expect(spsAdvice(2.4).headline).toBe("Flash Deals and Shop Ads are off");
    expect(spsAdvice(2.8).headline).toBe("Affiliate plans and campaigns are cut off");
    expect(spsAdvice(3.2).headline).toBe("One dip from losing creators");
    expect(spsAdvice(3.7).headline).toBe("Affiliate and campaigns unlocked");
    expect(spsAdvice(4.3).headline).toBe("Top tier");
  });

  it("reads a score from page text and ignores percentages and bigger numbers", () => {
    expect(parseSpsScore(" 4.2 ")).toBe(4.2);
    expect(parseSpsScore("3.5 / 5")).toBe(3.5);
    expect(parseSpsScore("Score 2.75 last 30 days")).toBe(2.75);
    expect(parseSpsScore("98% on-time 4.1")).toBe(4.1);
    expect(parseSpsScore("12.5")).toBeNull();
    expect(parseSpsScore("Updated 2026")).toBeNull();
    expect(parseSpsScore("")).toBeNull();
  });

  it("rejects anything outside 0-5", () => {
    expect(isValidSpsScore(5)).toBe(true);
    expect(isValidSpsScore(0)).toBe(true);
    expect(isValidSpsScore(5.01)).toBe(false);
    expect(isValidSpsScore(-1)).toBe(false);
    expect(isValidSpsScore(Number.NaN)).toBe(false);
    expect(isValidSpsScore("4")).toBe(false);
  });

  it("counts whole days since the score was read", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    expect(spsAgeDays("2026-09-30T08:00:00Z", now)).toBe(0);
    expect(spsAgeDays("2026-09-28T11:00:00Z", now)).toBe(2);
    expect(spsAgeDays("not a date", now)).toBeNull();
  });
});
