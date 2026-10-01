/**
 * Coverage gate. Fails the run when anything that ships has no evidence of a
 * passing test. Evidence, not bookkeeping: listing a file under a feature is not
 * enough on its own.
 *
 *   route      called by a pytest (backend/.route-coverage.json from conftest.py)
 *   lib        imported by a vitest file that passed, or owned by an E-* feature
 *              whose Playwright test passed
 *   component  owned by an E-* feature whose Playwright test passed
 *   message    sent as `type: "NAME"` in a vitest file that passed, or owned by
 *              a passed E-* feature
 *   flag       has a passed E-FLAG-<key> Playwright test, or is in deadFlags with a reason
 *   telemetry  every event the code sends is on the backend allowlist, and every
 *              allowlisted event is sent somewhere
 *   setting / tier   owned by a passed E-* feature
 *   dead code  every file no entry point reaches is listed in deadCode with a
 *              reason; a listed file that is reachable again is an error
 *
 * evaluateGate() is pure so scripts/coverage-gate.test.mjs can prove the gate
 * fails when it should.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

export const LIVE_ENTRIES = [
  "src/content/index.ts",
  "src/background/serviceWorker.ts",
  "src/content/oauthDone.ts",
  "src/oauth-finish.ts",
];
/** Build tooling reaches these; they never ship in the bundle but are not dead. */
export const TOOLING_ENTRIES = ["vite.config.ts"];

function walk(dir, pred) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (["node_modules", "dist", "dist-e2e", "legacy"].includes(name)) continue;
      out.push(...walk(full, pred));
    } else if (pred(full)) out.push(full);
  }
  return out;
}

const rel = (file) => path.relative(root, file).replaceAll("\\", "/");

function parseImports(file) {
  const text = readFileSync(file, "utf8");
  const specs = [];
  for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)) specs.push(match[1]);
  return specs;
}

function resolveImport(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), spec.replace(/\?.*$/, ""));
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
  return candidates.find((item) => existsSync(item) && statSync(item).isFile()) ?? null;
}

function reachableFrom(entries) {
  const seen = new Set();
  const queue = entries.map((entry) => path.join(root, entry)).filter((file) => existsSync(file));
  while (queue.length) {
    const file = queue.pop();
    const key = rel(file);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const spec of parseImports(file)) {
      const next = resolveImport(file, spec);
      if (next) queue.push(next);
    }
  }
  return seen;
}

function discoverRoutes() {
  const out = new Set();
  for (const name of readdirSync(path.join(root, "backend"))) {
    if (!name.endsWith(".py") || name.startsWith("test_") || name === "conftest.py") continue;
    const text = read(`backend/${name}`);
    for (const match of text.matchAll(/@(?:app|router)\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g)) {
      out.add(`route:${match[1].toUpperCase()} ${match[2]}`);
    }
  }
  return [...out].sort();
}

function discoverMessages() {
  const sw = read("src/background/serviceWorker.ts");
  const content = ["src/content/index.ts", "src/content/mountOverlay.tsx"].map(read).join("\n");
  const names = new Set();
  for (const match of sw.matchAll(/case "([A-Z][A-Z0-9_]+)"/g)) names.add(match[1]);
  for (const match of content.matchAll(/type === "([A-Z][A-Z0-9_]+)"/g)) names.add(match[1]);
  names.add("STORAGE_PUSH");
  return [...names].sort().map((name) => `msg:${name}`);
}

function discoverTelemetry() {
  const text = read("backend/marginmark_app.py");
  const block = text.split("TELEMETRY_EVENTS = frozenset(")[1]?.split(")")[0] ?? "";
  const allowlist = [...block.matchAll(/"([a-z0-9_.]+)"/g)].map((m) => m[1]);
  const extension = new Set();
  const server = new Set();
  const sources = walk(path.join(root, "src"), (file) => /\.(ts|tsx)$/.test(file) && !/\.test\./.test(file));
  for (const file of sources) {
    for (const m of readFileSync(file, "utf8").matchAll(/trackEvent\(\s*["']([a-z0-9_.]+)["']/g)) extension.add(m[1]);
  }
  for (const name of readdirSync(path.join(root, "backend"))) {
    if (!name.endsWith(".py") || name.startsWith("test_")) continue;
    for (const m of read(`backend/${name}`).matchAll(/_emit\(\s*["']([a-z0-9_.]+)["']/g)) server.add(m[1]);
  }
  return { allowlist, extension: [...extension].sort(), server: [...server].sort() };
}

function discoverSettings() {
  const body = read("src/types/settings.ts").split("export type Settings = {")[1]?.split("};")[0] ?? "";
  const keys = [];
  for (const line of body.split("\n")) {
    const match = line.match(/^\s{2}([A-Za-z][A-Za-z0-9]*)\??:/);
    if (match && match[1] !== "version") keys.push(`setting:${match[1]}`);
  }
  return keys;
}

function loadVitestFiles() {
  const file = path.join(root, "qa/report/vitest.json");
  if (!existsSync(file)) return { present: false, files: [] };
  const report = JSON.parse(readFileSync(file, "utf8"));
  const files = [];
  for (const suite of report.testResults ?? []) {
    const abs = path.isAbsolute(suite.name) ? suite.name : path.join(root, suite.name);
    if (!existsSync(abs)) continue;
    const results = suite.assertionResults ?? [];
    const passed = suite.status === "passed" && results.some((r) => r.status === "passed") && !results.some((r) => r.status === "failed");
    const imports = new Set(parseImports(abs).map((spec) => resolveImport(abs, spec)).filter(Boolean).map(rel));
    files.push({ file: rel(abs), passed, imports: [...imports], text: readFileSync(abs, "utf8"), names: results.filter((r) => r.status === "passed").map((r) => r.fullName || r.title || "") });
  }
  return { present: true, files };
}

function loadPlaywright() {
  const file = path.join(root, "qa/report/e2e/results.json");
  if (!existsSync(file)) return { present: false, passed: [], skipped: [], failed: [] };
  const report = JSON.parse(readFileSync(file, "utf8"));
  const passed = [];
  const skipped = [];
  const failed = [];
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      const tests = spec.tests ?? [];
      const results = tests.flatMap((test) => test.results ?? []);
      const status = results.map((r) => r.status);
      const reason = tests.flatMap((test) => test.annotations ?? []).map((a) => `${a.type}:${a.description ?? ""}`).join(" ");
      if (status.includes("failed") || status.includes("timedOut") || status.includes("interrupted")) failed.push(spec.title);
      else if (status.includes("passed")) passed.push({ title: spec.title, annotations: reason });
      else skipped.push({ title: spec.title, reason });
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites ?? []) visit(suite);
  return { present: true, passed, skipped, failed };
}

function loadPytestPassed() {
  const file = path.join(root, "qa/report/pytest.xml");
  if (!existsSync(file)) return [];
  const xml = readFileSync(file, "utf8");
  const names = [];
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const name = /\bname="([^"]*)"/.exec(match[1])?.[1] ?? "";
    const body = match[3] ?? "";
    if (!/<(skipped|failure|error)\b/.test(body)) names.push(name);
  }
  return names;
}

function scanTags() {
  const files = ["src", "backend", "e2e", "scripts"].flatMap((dir) =>
    walk(path.join(root, dir), (file) => /\.(py|ts|tsx|mjs)$/.test(file) && !file.endsWith("coverage-gate.mjs") && !file.endsWith("coverage-gate.test.mjs")),
  );
  const tags = new Map();
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const m of line.matchAll(/@F-[A-Z0-9-]+/g)) {
        let owner = "";
        for (let i = index; i >= Math.max(0, index - 30); i -= 1) {
          const js = lines[i].match(/(?:it|test|describe)\(\s*["'`]([^"'`]+)["'`]/);
          const py = lines[i].match(/def (test_[A-Za-z0-9_]+)/);
          if (js || py) {
            owner = (js ? js[1] : py[1]);
            break;
          }
        }
        const tag = m[0].slice(1);
        const list = tags.get(tag) ?? [];
        list.push({ file: rel(file), owner });
        tags.set(tag, list);
      }
    });
  }
  return tags;
}

/**
 * Pure decision. Input is everything read from disk; output is the list of errors
 * and the table printed for the report.
 */
export function evaluateGate(input) {
  const errors = [];
  const untested = [];
  const rows = [];
  const pwPassedTitles = input.playwright.passed.map((p) => p.title);
  const e2ePassed = (id) => pwPassedTitles.some((title) => new RegExp(`(^|\\s)${id}(\\s|$)`).test(title));

  if (!input.playwright.present) errors.push("Playwright JSON report is missing (qa/report/e2e/results.json)");
  if (!input.vitest.present) errors.push("vitest JSON report is missing (qa/report/vitest.json)");
  for (const title of input.playwright.failed) errors.push(`Playwright failed: ${title}`);

  // E-* features: every one must pass (opt-in ones may skip, naming the env var).
  const e2eOwned = new Set();
  for (const feature of input.e2eFeatures) {
    const mapped = input.map.features.find((f) => f.id === feature.id);
    if (feature.optIn) {
      const skip = input.playwright.skipped.find((s) => s.title.includes(feature.id));
      const ran = e2ePassed(feature.id);
      const env = feature.env ?? "";
      const ok = ran || (skip && env && skip.reason.includes(env));
      if (!ok) errors.push(`${feature.id} (opt-in) must pass, or skip naming ${env || "its env var"}`);
      rows.push({ id: feature.id, name: feature.name, layer: "e2e", passed: Boolean(ok) });
      continue;
    }
    const ok = e2ePassed(feature.id);
    if (!ok) errors.push(`${feature.id} did not pass in Playwright`);
    else for (const surface of mapped?.surfaces ?? []) e2eOwned.add(surface);
    rows.push({ id: feature.id, name: feature.name, layer: "e2e", passed: ok });
  }
  for (const feature of input.map.features) {
    if (String(feature.id).startsWith("E-") && !input.e2eFeatures.some((f) => f.id === feature.id)) {
      errors.push(`${feature.id} is in qa/feature-map.json but not in qa/e2e-features.json`);
    }
    if ((feature.surfaces ?? []).length > 10) errors.push(`${feature.id} lists ${(feature.surfaces ?? []).length} surfaces (max 10)`);
    if (/(?:^|[^A-Z0-9])(CATALOG|REST|MISC)(?:[^A-Z0-9]|$)/.test(String(feature.id))) {
      errors.push(`${feature.id} looks like a catch-all bucket`);
    }
  }

  // Tagged unit/backend tests must exist and pass.
  for (const feature of input.map.features) {
    if (String(feature.id).startsWith("E-")) continue;
    const tags = (feature.tests ?? []).map((t) => t.replace(/^@/, ""));
    if (!tags.length) errors.push(`${feature.id} has no test tag`);
    let ok = tags.length > 0;
    for (const tag of tags) {
      const owners = input.tags.get(tag) ?? [];
      if (!owners.length) {
        errors.push(`${feature.id}: tag @${tag} is not in any test file`);
        ok = false;
        continue;
      }
      const hit = input.passedNames.some((name) => name.includes(`@${tag}`) || owners.some((o) => o.owner && name.includes(o.owner)));
      if (!hit) {
        errors.push(`${feature.id}: tag @${tag} did not pass in this run`);
        ok = false;
      }
    }
    rows.push({ id: feature.id, name: feature.name, layer: "unit/backend", passed: ok });
  }

  const passedVitest = input.vitest.files.filter((f) => f.passed);
  const importedByPassingTest = new Set(passedVitest.flatMap((f) => f.imports));
  const vitestText = passedVitest.map((f) => f.text).join("\n");

  // Dead code: unreachable files must be listed; listed files must still be unreachable.
  const deadList = new Map(input.map.deadCode.map((d) => (typeof d === "string" ? [d, ""] : [d.surface, d.reason ?? ""])));
  for (const surface of input.unreachable) {
    if (!deadList.has(surface)) errors.push(`${surface} is reached by no entry point and is not in deadCode`);
    else if (!deadList.get(surface)) errors.push(`${surface} is in deadCode without a reason`);
  }
  for (const surface of deadList.keys()) {
    if (!input.unreachable.includes(surface)) errors.push(`${surface} is in deadCode but is reachable or no longer exists`);
  }
  const dead = new Set(input.unreachable);

  for (const surface of input.surfaces.components) {
    if (dead.has(surface)) continue;
    if (!e2eOwned.has(surface)) untested.push(surface);
  }
  for (const surface of input.surfaces.libs) {
    if (dead.has(surface)) continue;
    const file = surface.slice(4);
    if (!importedByPassingTest.has(file) && !e2eOwned.has(surface)) untested.push(surface);
  }
  for (const surface of input.surfaces.messages) {
    const name = surface.slice(4);
    if (!vitestText.includes(`type: "${name}"`) && !e2eOwned.has(surface)) untested.push(surface);
  }
  for (const surface of [...input.surfaces.settings, ...input.surfaces.tiers]) {
    if (!e2eOwned.has(surface)) untested.push(surface);
  }
  for (const key of input.surfaces.flags) {
    const reason = input.map.deadFlags?.[key];
    if (reason) {
      if (input.flagValues[key]) errors.push(`flag:${key} is on but listed in deadFlags`);
      continue;
    }
    if (!e2ePassed(`E-FLAG-${key}`)) untested.push(`flag:${key}`);
  }
  for (const route of input.routeMissing ?? []) untested.push(route);
  if (input.routeMissing == null) errors.push("backend/.route-coverage.json is missing (run pytest)");

  // The API accepts only allowlisted names from the extension (/telemetry/event);
  // server-side _emit() writes directly and needs no allowlist entry.
  const allow = new Set(input.telemetry.allowlist);
  const sent = new Set([...input.telemetry.extension, ...input.telemetry.server]);
  for (const name of input.telemetry.extension) if (!allow.has(name)) errors.push(`telemetry "${name}" is sent by the extension but the API rejects it (add it to TELEMETRY_EVENTS)`);
  for (const name of allow) if (!sent.has(name)) errors.push(`telemetry "${name}" is allowlisted but never sent (remove it or send it)`);

  if (untested.length) errors.push(`${untested.length} shipped surface(s) have no passing test: ${untested.slice(0, 12).join(", ")}${untested.length > 12 ? " …" : ""}`);
  return { errors, untested, rows };
}

export function gatherFromDisk() {
  const live = reachableFrom([...LIVE_ENTRIES, ...TOOLING_ENTRIES]);
  const components = walk(path.join(root, "src"), (f) => f.endsWith(".tsx") && !f.includes(".test.")).map(rel);
  const libs = [
    ...walk(path.join(root, "src/lib"), (f) => f.endsWith(".ts") && !f.includes(".test.")),
    ...walk(path.join(root, "src/content"), (f) => f.endsWith(".ts") && !f.includes(".test.")),
  ].map(rel);
  const unreachable = [...components, ...libs]
    .filter((file) => !live.has(file))
    .map((file) => (file.endsWith(".tsx") ? `component:${file}` : `lib:${file}`))
    .sort();
  const rawMap = JSON.parse(read("qa/feature-map.json"));
  const map = { features: rawMap.features ?? [], deadCode: rawMap.deadCode ?? [], deadFlags: rawMap.deadFlags ?? {} };
  const flagsJson = JSON.parse(read("src/flags.json"));
  const routeFile = path.join(root, "backend/.route-coverage.json");
  const vitest = loadVitestFiles();
  const pytestPassed = loadPytestPassed();
  return {
    surfaces: {
      routes: discoverRoutes(),
      messages: discoverMessages(),
      components: components.map((f) => `component:${f}`),
      libs: libs.map((f) => `lib:${f}`),
      flags: Object.keys(flagsJson),
      settings: discoverSettings(),
      tiers: Object.keys(JSON.parse(read("src/tiers.json"))).map((k) => `tier:${k}`),
    },
    flagValues: Object.fromEntries(Object.entries(flagsJson).map(([k, v]) => [k, Boolean(v.enabled)])),
    unreachable,
    map,
    e2eFeatures: JSON.parse(read("qa/e2e-features.json")),
    playwright: loadPlaywright(),
    vitest,
    passedNames: [...vitest.files.flatMap((f) => f.names), ...pytestPassed],
    tags: scanTags(),
    routeMissing: existsSync(routeFile) ? JSON.parse(readFileSync(routeFile, "utf8")).missing ?? [] : null,
    telemetry: discoverTelemetry(),
  };
}

function main() {
  const input = gatherFromDisk();
  if (process.argv.includes("--list")) {
    mkdirSync(path.join(root, "qa/report"), { recursive: true });
    writeFileSync(path.join(root, "qa/report/surfaces.json"), JSON.stringify({ surfaces: input.surfaces, unreachable: input.unreachable }, null, 2));
    console.log(`unreachable: ${input.unreachable.length}`);
    return;
  }
  const result = evaluateGate(input);
  const report = { untested: result.untested, unreachable: input.unreachable, features: result.rows, errors: result.errors };
  mkdirSync(path.join(root, "qa/report"), { recursive: true });
  writeFileSync(path.join(root, "qa/report/coverage.json"), JSON.stringify(report, null, 2));
  console.log("feature".padEnd(34) + "layer".padEnd(14) + "pass");
  for (const row of result.rows) console.log(row.id.padEnd(34) + row.layer.padEnd(14) + (row.passed ? "yes" : "NO"));
  if (result.errors.length) {
    console.error(`\ncoverage gate FAILED (${result.errors.length} problem(s)):\n- ${result.errors.join("\n- ")}`);
    process.exit(1);
  }
  const counted = Object.values(input.surfaces).reduce((n, list) => n + list.length, 0);
  console.log(`\ncoverage gate ok: ${counted} surfaces checked, ${result.untested.length} untested, ${input.unreachable.length} dead files listed`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
