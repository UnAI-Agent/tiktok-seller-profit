import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("check-secrets", () => {
  it("blocks a real-looking sample and allows a placeholder", () => {
    const shell = process.platform === "win32" ? "powershell.exe" : "pwsh";
    const out = execFileSync(
      shell,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/check-secrets.ps1", "-SelfTest"],
      { encoding: "utf8" },
    );
    expect(out).toContain("self-test ok");
  });
});