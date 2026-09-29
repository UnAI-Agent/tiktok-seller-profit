import { describe, expect, it } from "vitest";
import { shownOverlayView } from "./ProfitOverlay";

describe("shownOverlayView", () => {
  it("returns to the main panel when login finishes or the account screen loses its session", () => {
    expect(shownOverlayView("auth", true)).toBe("main");
    expect(shownOverlayView("account", false)).toBe("main");
  });

  it("keeps the screen that matches the session", () => {
    expect(shownOverlayView("auth", false)).toBe("auth");
    expect(shownOverlayView("account", true)).toBe("account");
    expect(shownOverlayView("main", true)).toBe("main");
    expect(shownOverlayView("plans", false)).toBe("plans");
  });
});
