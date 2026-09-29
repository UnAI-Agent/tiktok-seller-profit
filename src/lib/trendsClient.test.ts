import { describe, expect, it } from "vitest";
import { enqueueTrend, trendRequestInit, weekToken, type TrendEvent } from "./trendsClient";

const event: TrendEvent = {
  event: "product_checked",
  productId: "abc",
  weekToken: "a".repeat(64),
  day: "2026-09-24",
  snapshot: { price: 10, soldCountApprox: 1200, rating: 4.2, reviewCount: 10 },
};

describe("trends client", () => {
  it("dedupes a product event for the day and never sends Authorization", () => {
    const queued = enqueueTrend(enqueueTrend([], event), { ...event, snapshot: { ...event.snapshot, price: 11 } });
    expect(queued).toHaveLength(1);
    expect(queued[0]?.snapshot.price).toBe(11);
    const init = trendRequestInit("{}");
    expect(JSON.stringify(init.headers)).not.toContain("Authorization");
  });

  it("changes the week token when the ISO week changes", async () => {
    const secret = new Uint8Array(32).fill(7);
    const first = await weekToken(secret, new Date("2026-09-24T00:00:00Z"));
    const next = await weekToken(secret, new Date("2026-10-01T00:00:00Z"));
    expect(first).not.toBe(next);
    expect(first).toHaveLength(64);
  });
});
