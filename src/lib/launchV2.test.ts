import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SIGN_IN_PROVIDERS } from "../popup/SocialAuthButtons";
import { parseProductFromHtml, sellingPrice } from "../content/scraper/parseProductPage";
import { setRemoteCss, withRemote, SELECTORS } from "../content/scraper/domSelectors";
import { bundledFlags, canonicalConfigBody, evaluateFlag, acceptPublishedConfig } from "./remoteConfig";
import { diagnose } from "./diagnose";
import { computeProfit } from "./profit";
import { matchBulkRows } from "./bulkCost";
import { leaksFoundUsd } from "./valueReceipt";
import { newLeakIds } from "./checkin";
import { promoGuardLine } from "./promoChip";

describe("L5 providers", () => {
  it("L5_sign_in_shows_google_facebook_and_tiktok", () => {
    expect(SIGN_IN_PROVIDERS.map((provider) => provider.id)).toEqual([
      "google",
      "facebook",
      "tiktok",
    ]);
  });
});

describe("L8 remote config", () => {
  it("L8_killswitch_hides_feature", () => {
    const flags = bundledFlags();
    expect(flags.productCheck.enabled).toBe(true);
    flags.productCheck = { ...flags.productCheck, enabled: false, reason: "Paused" };
    const hidden = evaluateFlag("productCheck", flags, {
      tier: "pro",
      version: "1.3.0",
      installId: "install-a",
    });
    expect(hidden.enabled).toBe(false);
    const forced = bundledFlags();
    forced.diamondEnabled = { enabled: true, rolloutPct: 100 };
    expect(
      evaluateFlag("diamondEnabled", forced, {
        tier: "diamond",
        version: "1.3.0",
        installId: "install-a",
      }).enabled,
    ).toBe(true);
  });

  it("L8_remote_selector_override_used", () => {
    setRemoteCss({ productTitle: "[data-remote='title']" });
    expect(withRemote("productTitle", SELECTORS.productTitle)[0]).toBe("[data-remote='title']");
    setRemoteCss({});
  });

  it("L8_python_sign_ts_verify", async () => {
    const sample = {
      note: "café",
      n: 1.5,
      whole: 2,
    };
    // Windows venv first; CI/macOS/Linux fall back to python3 on PATH.
    const winVenv = join("backend", "venv", "Scripts", "python.exe");
    const nixVenv = join("backend", "venv", "bin", "python");
    const python =
      process.platform === "win32" && existsSync(winVenv)
        ? winVenv
        : existsSync(nixVenv)
          ? nixVenv
          : process.platform === "win32"
            ? "python"
            : "python3";
    const pyBody = execFileSync(
      python,
      [
        "-c",
        "import json,sys; sys.path.insert(0,'backend'); from remote_doc import canonical_body; print(canonical_body(json.loads(sys.stdin.read())).decode())",
      ],
      { input: JSON.stringify(sample), encoding: "utf8" },
    ).trim();
    expect(pyBody).toBe(canonicalConfigBody(sample));

    const dir = mkdtempSync(join(tmpdir(), "mm-key-"));
    try {
      const keyPath = join(dir, "ed25519.pem");
      const publicKey = execFileSync(python, ["scripts/config-keygen.py", keyPath], {
        encoding: "utf8",
      }).trim();
      const flags = bundledFlags();
      const doc = {
        version: 1,
        issuedAt: "2026-09-27T00:00:00Z",
        expiresAt: "2027-09-27T00:00:00Z",
        minSupportedVersion: "1.3.0",
        flags,
        feePresets: {},
        selectors: {},
        thresholds: { founderSlotsLeft: 1 },
        messages: {},
      };
      const input = join(dir, "config.json");
      writeFileSync(input, JSON.stringify(doc));
      const signed = JSON.parse(
        execFileSync(python, ["scripts/sign-config.py", input, keyPath], { encoding: "utf8" }),
      );
      const accepted = await acceptPublishedConfig(signed, null, Date.parse("2026-09-28T00:00:00Z"), publicKey);
      expect(accepted?.version).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("U3 bulk costs", () => {
  it("U3_bulk_paste_matches_by_sku_and_id", () => {
    const matched = matchBulkRows(
      [
        { key: "1732", cost: 4 },
        { key: "BLUE-MUG", cost: 5 },
        { key: "Missing", cost: 1 },
      ],
      [
        { skuId: "1732", title: "Screen", sellerSku: "SCR" },
        { skuId: "999", title: "Mug", sellerSku: "BLUE-MUG" },
      ],
    );
    expect(matched.matched).toHaveLength(2);
    expect(matched.unmatched).toEqual([{ key: "Missing", cost: 1 }]);
  });
});

describe("value and check-in", () => {
  it("U7 sums leaks locally", () => {
    expect(leaksFoundUsd([
      { netPerUnit: -2, units: 10, commissionAboveSafe: 0 },
      { netPerUnit: 3, units: 4, commissionAboveSafe: 0.5 },
    ])).toBe(22);
  });

  it("P4_checkin_counts_new_leaks_only", () => {
    expect(newLeakIds(["a", "b"], ["b", "c", "d"])).toEqual(["c", "d"]);
  });

  it("P3_promo_chip_below_breakeven", () => {
    expect(promoGuardLine(19.99, -1.81, 21.8)).toMatch(/lose \$1\.81/);
    expect(promoGuardLine(19.99, -1.81, 21.8)).toMatch(/Break-even is \$21\.80/);
  });

  it("P3_diagnose_promo_first", () => {
    const input = {
      listPrice: 19.99,
      cogsPerUnit: 20,
      shippingOut: 0,
      adsPerUnit: 0,
      unitsSold: 1,
      refundRatePct: 0,
      platformFeePct: 6,
      paymentFeePct: 0,
      paymentFixed: 0,
      packagingPerUnit: 0,
      affiliatePct: 0,
      affiliateSharePct: 0,
    };
    const profit = computeProfit(input);
    expect(profit.netPerUnit).toBeLessThan(0);
    const row = diagnose(input, "custom", 15, 30);
    expect(row.status).toBe("promo-below-breakeven");
  });
});

describe("L4 storage budget", () => {
  it("L4_manifest_permissions_used", () => {
    const manifest = JSON.parse(readFileSync("manifest.json", "utf8")) as { permissions: string[] };
    const source = readFileSync("src/background/serviceWorker.ts", "utf8");
    expect(manifest.permissions).not.toContain("identity");
    expect(source.includes("chrome.storage")).toBe(true);
    expect(source.includes("chrome.alarms")).toBe(true);
    expect(source.includes("chrome.scripting")).toBe(true);
    expect(source.includes("chrome.identity")).toBe(false);
    const sku = JSON.stringify({
      skuId: "1732672081725330342",
      title: "Sample product title for storage sizing",
      listPrice: 19.99,
      cogsPerUnit: 4.5,
      unitsSold: 12,
      costSource: "custom",
    });
    const line = JSON.stringify({ orderId: "576460752303423000", skuId: "1732672081725330342", gross: 19.99, fee: 1.2, net: 8.1 });
    const bytes = sku.length * 5000 + line.length * 5000 * 12;
    expect(bytes).toBeLessThan(10 * 1024 * 1024);
    expect(manifest.permissions).not.toContain("unlimitedStorage");
  });
});
