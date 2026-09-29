import { describe, expect, it } from "vitest";
import { reviewFlags } from "./reviewFlags";

describe("review flags", () => {
  it("counts only 1–2 star reviews and returns the top two", () => {
    const flags = reviewFlags([
      { stars: 1, text: "Broke after one day and the smell is awful" },
      { stars: 2, text: "Sizing is tiny and it broke" },
      { stars: 5, text: "fake refund smell" },
      { stars: 1, text: "Late shipping" },
    ]);
    expect(flags[0]?.flag).toBe("broke");
    expect(flags[0]?.count).toBe(2);
    expect(flags).toHaveLength(2);
    expect(flags.some((row) => row.flag === "fake")).toBe(false);
  });
});
