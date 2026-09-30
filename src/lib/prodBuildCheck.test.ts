import { describe, expect, it } from "vitest";
import { checkProdBuild, versionGreater } from "../../scripts/verify-prod.mjs";

const manifest = {
  version: "0.2.0",
  permissions: ["storage", "alarms", "scripting"],
  host_permissions: ["https://seller-us.tiktok.com/*"],
  content_security_policy: { extension_pages: "script-src 'self'" },
  web_accessible_resources: [
    {
      matches: ["https://seller-us.tiktok.com/*"],
      resources: ["assets/content.js"],
      use_dynamic_url: false,
    },
    {
      matches: ["https://marginmark-api-prod.fly.dev/*"],
      resources: ["oauth-finish.html"],
      use_dynamic_url: true,
    },
  ],
};

describe("checkProdBuild", () => {
  it("accepts a clean prod manifest", () => {
    expect(checkProdBuild({ manifest, bundleText: "ok", lastPublished: "0.1.6" })).toEqual([]);
    expect(versionGreater("0.2.0", "0.2.0")).toBe(false);
  });

  it("rejects localhost, the LLE host, test keys, and extra permissions", () => {
    const errors = checkProdBuild({
      manifest: {
        ...manifest,
        version: "0.1.6",
        permissions: ["storage", "debugger"],
        host_permissions: ["http://localhost:8000/*"],
      },
      bundleText: "https://marginmark-api-lle.fly.dev pk_test_abc VITE_SHOW_CREATOR_DEMO MarginGuard TikTok Seller Tool",
      lastPublished: "0.1.6",
    });
    expect(errors.join(" ")).toMatch(/localhost/);
    expect(errors.join(" ")).toMatch(/LLE/);
    expect(errors.join(" ")).toMatch(/Stripe/);
    expect(errors.join(" ")).toMatch(/creator demo/);
    expect(errors.join(" ")).toMatch(/debugger/);
    expect(errors.join(" ")).toMatch(/not newer/);
    expect(errors.join(" ")).toMatch(/MarginGuard/);
    expect(errors.join(" ")).toMatch(/TikTok Seller Tool/);
  });

  it("rejects an open overlay shadow root @F-BUILD-E2E", () => {
    const errors = checkProdBuild({
      manifest,
      bundleText: 'host.attachShadow({ mode: "open" })',
      lastPublished: "0.1.0",
    });
    expect(errors).toContain("test build: overlay shadow root is open (built with VITE_E2E=1)");
    const minified = checkProdBuild({
      manifest,
      bundleText: 'Da="open";el.attachShadow({mode:Da})',
      lastPublished: "0.1.0",
    });
    expect(minified).toContain("test build: overlay shadow root is open (built with VITE_E2E=1)");
  });

  it("rejects the LLE test-data strip", () => {
    const errors = checkProdBuild({
      manifest,
      bundleText: "LLE: test data",
      lastPublished: "0.1.0",
    });
    expect(errors.join(" ")).toMatch(/LLE test-data/);
  });
});
