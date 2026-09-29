import { describe, expect, it, vi } from "vitest";
import { postAuth } from "./authCall";

describe("overlay email login", () => {
  it("n1_overlay_email_login_reaches_api", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "jwt" }), { status: 200 }),
    );
    const result = await postAuth(
      "/auth/login",
      { email: "seller@example.com", password: "secret12" },
      fetchImpl as unknown as typeof fetch,
      "http://127.0.0.1:8000",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("http://127.0.0.1:8000/auth/login");
    expect(result).toEqual({ ok: true, token: "jwt" });
  });

  it("BUG_fastapi_detail_reaches_the_ui_not_request_failed", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ detail: "Invalid email or password" }), { status: 401 }),
    );
    const result = await postAuth(
      "/auth/login",
      { email: "seller@example.com", password: "wrong" },
      fetchImpl as unknown as typeof fetch,
      "http://127.0.0.1:8000",
    );
    expect(result).toEqual({ ok: false, error: "Invalid email or password", status: 401 });
  });
});
