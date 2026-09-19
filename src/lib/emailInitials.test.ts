import { describe, expect, it } from "vitest";
import { emailInitials } from "./emailInitials";

describe("emailInitials", () => {
  it("uses two letters from local part", () => {
    expect(emailInitials("jane.seller@shop.com")).toBe("JS");
    expect(emailInitials("ab@x.com")).toBe("AB");
  });
});
