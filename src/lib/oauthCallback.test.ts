import { describe, expect, it } from "vitest";
import { parseOAuthDoneUrl } from "./oauthCallback";

const API = "http://127.0.0.1:8000";
const TICKET = "a".repeat(32);

describe("parseOAuthDoneUrl", () => {
  it("accepts a ticket on the API origin", () => {
    expect(
      parseOAuthDoneUrl(`${API}/auth/oauth/done?ticket=${TICKET}`, API),
    ).toBe(TICKET);
  });

  it("treats localhost and 127.0.0.1 as the same API origin", () => {
    expect(
      parseOAuthDoneUrl(`http://localhost:8000/auth/oauth/done?ticket=${TICKET}`, API),
    ).toBe(TICKET);
  });

  it("rejects other origins and error landings", () => {
    expect(
      parseOAuthDoneUrl(`https://evil.example/auth/oauth/done?ticket=${TICKET}`, API),
    ).toBeNull();
    expect(
      parseOAuthDoneUrl(`${API}/auth/oauth/done?error=denied&ticket=${TICKET}`, API),
    ).toBeNull();
    expect(parseOAuthDoneUrl(`${API}/auth/oauth/done?ticket=short`, API)).toBeNull();
  });
});
