import { describe, expect, it } from "vitest";
import { consumeProductCheck } from "./productCheckQuota";

describe("product check quota", () => {
  it("blocks the 6th free check and resets the next local day", () => {
    let state = { day: "2026-09-24", count: 0 };
    const now = new Date(2026, 8, 24, 15, 0, 0);
    for (let i = 0; i < 5; i += 1) {
      const step = consumeProductCheck(state, now, 5);
      expect(step.allowed).toBe(true);
      state = step.next;
    }
    const blocked = consumeProductCheck(state, now, 5);
    expect(blocked.allowed).toBe(false);
    const tomorrow = consumeProductCheck(blocked.next, new Date(2026, 8, 25, 1, 0, 0), 5);
    expect(tomorrow.allowed).toBe(true);
    expect(tomorrow.next.count).toBe(1);
  });
});
