import { describe, expect, it } from "vitest";
import { clearSharedAuthMe, shareAuthMe, sharedAuthMeEmail } from "./authMeShare";
import type { MeResponse } from "./apiClient";

function profile(email: string): MeResponse {
  return {
    email,
    is_pro: false,
    subscription_status: "free",
    pro_price: 0,
  };
}

describe("shareAuthMe", () => {
  it("reuses one in-flight read and the answer for a few seconds @F-TIER-REFRESH", async () => {
    clearSharedAuthMe();
    let calls = 0;
    const load = () => {
      calls += 1;
      return Promise.resolve(profile("a@e2e.test"));
    };
    const [first, second] = await Promise.all([shareAuthMe("token-a", load), shareAuthMe("token-a", load)]);
    expect(first.email).toBe("a@e2e.test");
    expect(second.email).toBe("a@e2e.test");
    expect(calls).toBe(1);
    expect(await shareAuthMe("token-a", load)).toEqual(first);
    expect(calls).toBe(1);
    expect(sharedAuthMeEmail("token-a")).toBe("a@e2e.test");
    expect(sharedAuthMeEmail("token-b")).toBeNull();
  });

  it("a fresh read ignores the saved answer @F-TIER-REFRESH", async () => {
    clearSharedAuthMe();
    let calls = 0;
    const load = () => {
      calls += 1;
      return Promise.resolve(profile(`n${calls}@e2e.test`));
    };
    await shareAuthMe("token-a", load);
    const again = await shareAuthMe("token-a", load, true);
    expect(again.email).toBe("n2@e2e.test");
    expect(calls).toBe(2);
  });

  it("a new document does not reuse the previous page's answer @F-TIER-REFRESH", async () => {
    clearSharedAuthMe();
    let calls = 0;
    const load = () => {
      calls += 1;
      return Promise.resolve(profile("old@e2e.test"));
    };
    await shareAuthMe("token-a", load);
    const openedAt = Date.now() + 1;
    const next = await shareAuthMe("token-a", () => {
      calls += 1;
      return Promise.resolve(profile("new@e2e.test"));
    }, false, openedAt);
    expect(next.email).toBe("new@e2e.test");
    expect(calls).toBe(2);
  });
});