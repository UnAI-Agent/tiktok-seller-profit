import { describe, expect, it } from "vitest";
import { allowedApiCall, isRuntimeMessage } from "./messages";

describe("API_CALL proxy", () => {
  it("allows checkout and blocks other paths", () => {
    expect(isRuntimeMessage({ type: "LOGOUT" })).toBe(true);
    expect(allowedApiCall("POST", "/billing/checkout")).toBe(true);
    expect(allowedApiCall("POST", "/auth/profile")).toBe(true);
    expect(allowedApiCall("POST", "/auth/change-password")).toBe(true);
    expect(allowedApiCall("POST", "/support/ticket")).toBe(true);
    expect(allowedApiCall("GET", "/auth/me?service=tiktok-seller-tool")).toBe(true);
    expect(allowedApiCall("POST", "/admin/v1/config")).toBe(false);
    expect(allowedApiCall("GET", "https://evil.example/auth/me")).toBe(false);
    expect(
      isRuntimeMessage({
        type: "API_CALL",
        method: "POST",
        path: "/billing/checkout",
        body: "{}",
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        type: "AUTH_LOGIN",
        email: "seller@example.com",
        password: "secret12",
      }),
    ).toBe(true);
    expect(
      isRuntimeMessage({
        type: "AUTH_LOGIN",
        email: "+15555550100@phone.tiktok-seller-tool",
        password: "x".repeat(129),
      }),
    ).toBe(false);
  });
});
