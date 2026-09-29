import { describe, expect, it } from "vitest";
import {
  apiHostPermission,
  withBuildManifest,
} from "./extManifestEnv";

const base = {
  name: "MarginMark — Profit Calculator for TikTok Shop Sellers",
  host_permissions: [
    "https://seller-us.tiktok.com/*",
    "http://127.0.0.1:8000/*",
  ],
  content_scripts: [
    {
      matches: ["https://seller-us.tiktok.com/*", "http://127.0.0.1:8765/*"],
      js: ["src/content/index.ts"],
    },
    {
      matches: ["http://127.0.0.1:8000/*"],
      js: ["src/content/oauthDone.ts"],
    },
  ],
};

describe("withBuildManifest", () => {
  it("adds the LLE API origin", () => {
    const m = withBuildManifest(base, {
      apiBase: "https://marginmark-api-lle.fly.dev",
      name: "MarginMark (LLE)",
    });
    expect(m.name).toBe("MarginMark (LLE)");
    expect(m.host_permissions).toContain(
      "https://marginmark-api-lle.fly.dev/*",
    );
    expect(m.host_permissions).toContain("http://127.0.0.1:8000/*");
    expect(m.content_scripts[1].matches).toContain(
      "https://marginmark-api-lle.fly.dev/*",
    );
    expect(m.externally_connectable?.matches).toContain(
      "https://marginmark-api-lle.fly.dev/*",
    );
  });

  it("strips localhost for prod CWS", () => {
    const m = withBuildManifest(base, {
      apiBase: "https://marginmark-api-prod.fly.dev",
      stripDevHosts: true,
    });
    expect(m.host_permissions).not.toContain("http://127.0.0.1:8000/*");
    expect(m.content_scripts[0].matches).not.toContain(
      "http://127.0.0.1:8765/*",
    );
    expect(m.content_scripts[1].matches).toContain(
      "https://marginmark-api-prod.fly.dev/*",
    );
    expect(m.content_scripts[1].matches).not.toContain("http://127.0.0.1:8000/*");
    expect(m.externally_connectable?.matches).toContain(
      "https://marginmark-api-prod.fly.dev/*",
    );
    expect(m.externally_connectable?.matches).not.toContain("http://127.0.0.1:8000/*");
    expect(JSON.stringify(m)).not.toMatch(/localhost/i);
    expect(JSON.stringify(m)).not.toMatch(/127\.0\.0\.1/);
    expect(apiHostPermission("not a url")).toBeNull();
  });
});
