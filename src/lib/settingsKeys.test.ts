import { describe, expect, it } from "vitest";
import flags from "../flags.json";
import { canAddSku } from "./skuLimit";
import { checkPassword } from "./passwordStrength";
import { DEFAULT_SETTINGS } from "../types/settings";
import { COMPARE_ROWS } from "../ui/PlanPicker";

describe("bundled settings", () => {
  it("defaults keep telemetry off and the free cost cap at five @F-SETTINGS", () => {
    expect(DEFAULT_SETTINGS.telemetryConsent.granted).toBe(false);
    expect(DEFAULT_SETTINGS.overlayEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.feePreset).toBe("us-standard");
    expect(canAddSku(5, false, true)).toBe(false);
    expect(canAddSku(4, false, true)).toBe(true);
  });

  it("every Pro feature on the plan screen is switched on @F-PLAN-PROMISE", () => {
    const promised = COMPARE_ROWS.filter((row) => row.pro !== false && row.flag);
    expect(promised.length).toBeGreaterThan(0);
    for (const row of promised) {
      expect(flags[row.flag as keyof typeof flags].enabled, row.label).toBe(true);
    }
    // Features with no screen yet stay off until they ship.
    expect(flags.diamondEnabled.enabled).toBe(false);
    expect(flags.productCheck.enabled).toBe(false);
  });

  it("the extension password rule matches the server @F-SETTINGS", () => {
    expect(checkPassword("password").valid).toBe(false);
    expect(checkPassword("Valid-pass-1").valid).toBe(true);
  });
});
