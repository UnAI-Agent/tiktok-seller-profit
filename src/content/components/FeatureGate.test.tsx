import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { bundledFlags, evaluateFlag, rolloutBucket, validateRemoteConfig } from "../../lib/remoteConfig";
import { FeatureGate } from "./FeatureGate";

describe("kill switch", () => {
  it("stays on the same rollout bucket for an install", () => {
    const first = rolloutBucket("install-a", "productCheck");
    expect(rolloutBucket("install-a", "productCheck")).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(100);
  });

  it("grays a disabled flag and shows the reason", () => {
    const flags = bundledFlags();
    flags.productCheck = {
      enabled: false,
      rolloutPct: 0,
      reason: "Fixing a TikTok page change",
    };
    const feature = evaluateFlag("productCheck", flags, {
      tier: "pro",
      version: "1.0.0",
      installId: "install-a",
    });
    expect(feature.enabled).toBe(false);
    const markup = renderToStaticMarkup(
      createElement(FeatureGate, {
        feature,
        children: createElement("p", null, "Should I sell this?"),
      }),
    );
    expect(markup).toContain("opacity-50");
    expect(markup).toContain("Fixing a TikTok page change");
    expect(markup).toContain("Should I sell this?");
  });

  it("rejects a config that contains executable text", () => {
    const result = validateRemoteConfig({
      version: 1,
      issuedAt: "2026-09-24T00:00:00Z",
      expiresAt: "2026-10-24T00:00:00Z",
      minSupportedVersion: "1.0.0",
      flags: {},
      feePresets: {},
      selectors: { "product-edit": { version: 1, fields: { listPrice: { css: "javascript:alert(1)" } } } },
      thresholds: {},
      messages: {},
      signature: "a".repeat(80),
    });
    expect(result.ok).toBe(false);
  });
});
