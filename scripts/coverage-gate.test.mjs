/**
 * Proves the coverage gate fails when it should. Run: node --test scripts/coverage-gate.test.mjs
 * (test-everything.mjs runs it before the gate itself).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateGate } from "./coverage-gate.mjs";

function passing() {
  return {
    surfaces: {
      routes: ["route:GET /health"],
      messages: ["msg:GET_TIER"],
      components: ["component:src/content/components/A.tsx"],
      libs: ["lib:src/lib/money.ts"],
      flags: ["overlay", "aiInsights"],
      settings: ["setting:targetMarginPct"],
      tiers: ["tier:free"],
    },
    flagValues: { overlay: true, aiInsights: false },
    unreachable: ["lib:src/lib/parked.ts"],
    map: {
      features: [
        { id: "E-A", name: "A", surfaces: ["component:src/content/components/A.tsx", "setting:targetMarginPct", "tier:free"], tests: ["@E-A"] },
        { id: "E-FLAG-overlay", name: "flag", surfaces: [], tests: ["@E-FLAG-overlay"] },
        { id: "F-MONEY", name: "money", surfaces: [], tests: ["@F-MONEY"] },
      ],
      deadCode: [{ surface: "lib:src/lib/parked.ts", reason: "post-launch" }],
      deadFlags: { aiInsights: "no screen yet" },
    },
    e2eFeatures: [
      { id: "E-A", name: "A" },
      { id: "E-FLAG-overlay", name: "flag" },
      { id: "E-LIVE", name: "live", optIn: true, env: "LIVE_PRODUCT_URL" },
    ],
    playwright: {
      present: true,
      passed: [{ title: "E-A does a thing" }, { title: "E-FLAG-overlay shows" }],
      skipped: [{ title: "E-LIVE live shop", reason: "skip:set LIVE_PRODUCT_URL" }],
      failed: [],
    },
    vitest: {
      present: true,
      files: [{ file: "src/lib/money.test.ts", passed: true, imports: ["src/lib/money.ts"], text: 'sendMessage({ type: "GET_TIER" })', names: ["money works @F-MONEY"] }],
    },
    passedNames: ["money works @F-MONEY"],
    tags: new Map([["F-MONEY", [{ file: "src/lib/money.test.ts", owner: "money works @F-MONEY" }]]]),
    routeMissing: [],
    telemetry: { allowlist: ["overlay.shown"], extension: ["overlay.shown"], server: [] },
  };
}

function errorsOf(input) {
  return evaluateGate(input).errors.join("\n");
}

test("a fully covered run passes", () => {
  assert.deepEqual(evaluateGate(passing()).errors, []);
});

test("a component no passing E2E test owns fails the gate", () => {
  const input = passing();
  input.playwright.passed = input.playwright.passed.filter((p) => !p.title.startsWith("E-A "));
  assert.match(errorsOf(input), /E-A did not pass/);
  assert.match(errorsOf(input), /component:src\/content\/components\/A\.tsx/);
});

test("a library that no passing unit test imports fails the gate", () => {
  const input = passing();
  input.vitest.files[0].passed = false;
  assert.match(errorsOf(input), /lib:src\/lib\/money\.ts/);
});

test("a message never sent by a passing test fails the gate", () => {
  const input = passing();
  input.vitest.files[0].text = "";
  assert.match(errorsOf(input), /msg:GET_TIER/);
});

test("an uncalled backend route fails the gate", () => {
  const input = passing();
  input.routeMissing = ["route:GET /health"];
  assert.match(errorsOf(input), /route:GET \/health/);
});

test("a missing route report fails the gate", () => {
  const input = passing();
  input.routeMissing = null;
  assert.match(errorsOf(input), /route-coverage\.json is missing/);
});

test("a tag whose test did not pass fails the gate", () => {
  const input = passing();
  input.passedNames = [];
  assert.match(errorsOf(input), /F-MONEY: tag @F-MONEY did not pass/);
});

test("a flag with no passing E-FLAG test and no deadFlags reason fails", () => {
  const input = passing();
  delete input.map.deadFlags.aiInsights;
  assert.match(errorsOf(input), /flag:aiInsights/);
});

test("a flag that is on cannot be listed as dead", () => {
  const input = passing();
  input.flagValues.aiInsights = true;
  assert.match(errorsOf(input), /flag:aiInsights is on but listed in deadFlags/);
});

test("unlisted dead code and stale dead-code entries both fail", () => {
  const unlisted = passing();
  unlisted.map.deadCode = [];
  assert.match(errorsOf(unlisted), /parked\.ts is reached by no entry point/);
  const stale = passing();
  stale.unreachable = [];
  assert.match(errorsOf(stale), /parked\.ts is in deadCode but is reachable/);
});

test("telemetry the API would reject, or never sent, fails", () => {
  const rejected = passing();
  rejected.telemetry.extension.push("upgrade.opened");
  assert.match(errorsOf(rejected), /"upgrade\.opened" is sent by the extension but the API rejects it/);
  const unused = passing();
  unused.telemetry.allowlist.push("old.event");
  assert.match(errorsOf(unused), /"old\.event" is allowlisted but never sent/);
});

test("an opt-in test may skip only when it names its env var", () => {
  const input = passing();
  input.playwright.skipped = [{ title: "E-LIVE live shop", reason: "skip:not today" }];
  assert.match(errorsOf(input), /E-LIVE \(opt-in\)/);
});

test("catch-all buckets and oversized features fail", () => {
  const input = passing();
  input.map.features.push({ id: "F-CATALOG", name: "rest", surfaces: Array.from({ length: 11 }, (_, i) => `lib:x${i}`), tests: ["@F-MONEY"] });
  const text = errorsOf(input);
  assert.match(text, /F-CATALOG looks like a catch-all/);
  assert.match(text, /F-CATALOG lists 11 surfaces/);
});

test("a Playwright failure or missing report fails", () => {
  const failed = passing();
  failed.playwright.failed = ["E-A does a thing"];
  assert.match(errorsOf(failed), /Playwright failed: E-A does a thing/);
  const missing = passing();
  missing.playwright.present = false;
  assert.match(errorsOf(missing), /Playwright JSON report is missing/);
});
