import { describe, expect, it } from "vitest";
import { checkPassword } from "./passwordStrength";

describe("checkPassword (matches the server rule)", () => {
  it("accepts 8+ chars with 3 of 4 classes", () => {
    expect(checkPassword("Valid-pass-1").valid).toBe(true);
    expect(checkPassword("abcdefG1").valid).toBe(true);
  });
  it("rejects short or single-class passwords", () => {
    expect(checkPassword("Ab1!").valid).toBe(false);
    expect(checkPassword("alllowercase").valid).toBe(false);
    expect(checkPassword("Lowercase12").valid).toBe(true);
  });
  it("scores and labels", () => {
    expect(checkPassword("").label).toBe("");
    expect(checkPassword("abc").label).toBe("Too short");
    expect(checkPassword("alllowercase").label).toBe("Weak");
    expect(checkPassword("Abcdefg1").label).toBe("Fair");
    expect(checkPassword("Abcdefgh1234!xyz").label).toBe("Strong");
  });
});
