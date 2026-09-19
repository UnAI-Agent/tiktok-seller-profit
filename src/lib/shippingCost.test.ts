import { describe, expect, it } from "vitest";
import { effectiveShippingPerUnit } from "./shippingCost";

describe("effectiveShippingPerUnit", () => {
  it("excludes label cost when buyer pays shipping", () => {
    expect(effectiveShippingPerUnit(4.5, true)).toBe(0);
  });

  it("includes label cost when seller pays shipping", () => {
    expect(effectiveShippingPerUnit(4.5, false)).toBe(4.5);
  });
});
