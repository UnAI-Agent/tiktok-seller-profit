import { describe, expect, it } from "vitest";
import flags from "../flags.json";
import { canAddSku } from "./skuLimit";
import { checkPassword } from "./passwordStrength";
import { DEFAULT_SETTINGS } from "../types/settings";

describe("bundled settings", () => {
  it("defaults keep telemetry off and the free cost cap at five @F-SETTINGS", () => {
    expect(DEFAULT_SETTINGS.telemetryConsent.granted).toBe(false);
    expect(DEFAULT_SETTINGS.overlayEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.feePreset).toBe("us-standard");
    expect(canAddSku(5, false, true)).toBe(false);
    expect(canAddSku(4, false, true)).toBe(true);
  });

  it("off flags have no default entry and the password rule matches the server @F-CATALOG", () => {
    expect(flags.diamondEnabled.enabled).toBe(false);
    expect(flags.whatIf.enabled).toBe(false);
    expect(flags.statementImport.enabled).toBe(true);
    expect(flags.overlay.enabled).toBe(true);
    const weak = checkPassword("password");
    expect(weak.valid).toBe(false);
    expect(checkPassword("Valid-pass-1").valid).toBe(true);
  });
});
