import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "./apiClient";
import { readTier } from "./subscription";

/**
 * Seller Center pages cannot read chrome.storage (TRUSTED_CONTEXTS). Before this
 * fix fetchMe() looked for the token there, got nothing, returned null, and the
 * overlay showed Free for a Pro account.
 */
describe("PRO_overlay_reads_plan_without_storage_access", () => {
  const sendMessage = vi.fn();

  beforeEach(() => {
    sendMessage.mockReset();
    vi.stubGlobal("chrome", {
      runtime: { id: "ext", sendMessage },
      storage: {
        local: {
          get: vi.fn().mockRejectedValue(new Error("Access to storage is not allowed from this context.")),
          set: vi.fn().mockRejectedValue(new Error("Access to storage is not allowed from this context.")),
        },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fetchMe goes through the service worker and returns the Pro profile", async () => {
    sendMessage.mockResolvedValue({
      ok: true,
      json: { email: "pro@example.com", is_pro: true, tier: "pro", subscription_status: "active", pro_price: 14.99 },
      status: 200,
    });
    const me = await fetchMe();
    expect(me?.tier).toBe("pro");
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "API_CALL", method: "GET" }));
  });

  it("fetchMe returns null (signed out) when the API says 401", async () => {
    sendMessage.mockResolvedValue({ ok: false, error: "Invalid or expired token", status: 401 });
    expect(await fetchMe()).toBeNull();
  });

  it("fetchMe returns null (signed out) on 403 Not authenticated, with no false connection error", async () => {
    sendMessage.mockResolvedValue({ ok: false, error: "Not authenticated", status: 403 });
    expect(await fetchMe()).toBeNull();
  });

  it("readTier asks the service worker for the cached plan", async () => {
    sendMessage.mockResolvedValue({ ok: true, loggedIn: true, tier: "pro" });
    expect(await readTier()).toBe("pro");
    expect(sendMessage).toHaveBeenCalledWith({ type: "GET_TIER" });
  });

  it("readTier returns null when the extension was reloaded @F-TIER-READ", async () => {
    sendMessage.mockResolvedValue({ ok: false, error: "Extension reloaded. Refresh this tab." });
    expect(await readTier()).toBeNull();
  });

  it("readTier returns free when the cached plan is free @F-TIER-READ", async () => {
    sendMessage.mockResolvedValue({ ok: true, loggedIn: true, tier: "free" });
    expect(await readTier()).toBe("free");
  });
});
