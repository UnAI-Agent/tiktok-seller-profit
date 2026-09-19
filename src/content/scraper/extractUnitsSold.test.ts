import { describe, expect, it } from "vitest";
import { extractUnitsSoldFromText } from "./extractUnitsSold";

describe("extractUnitsSoldFromText", () => {
  it("reads common sold patterns", () => {
    expect(extractUnitsSoldFromText("Units sold: 1,234")).toBe(1234);
    expect(extractUnitsSoldFromText("42 sold this month")).toBe(42);
    expect(extractUnitsSoldFromText("Total sales: 99")).toBe(99);
  });

  it("returns 0 when missing", () => {
    expect(extractUnitsSoldFromText("Live $45.00")).toBe(0);
  });
});
