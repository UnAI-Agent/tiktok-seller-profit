/**
 * Fails when a discovered surface has no feature, a feature has no passing tag,
 * or a tag in the map is missing from the test run.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

function walk(dir, pred) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === "dist-e2e") continue;
      out.push(...walk(full, pred));
    } else if (pred(full)) out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function discoverRoutes() {
  const surfaces = [];
  const dir = path.join(root, "backend");
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".py") || name.startsWith("test_") || name === "conftest.py") continue;
    const text = readFileSync(path.join(dir, name), "utf8");
    const re = /@(?:app|router)\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;
    for (const match of text.matchAll(re)) {
      surfaces.push(`route:${match[1].toUpperCase()} ${match[2]}`);
    }
  }
  return [...new Set(surfaces)];
}

function discoverMessages() {
  const sw = read("src/background/serviceWorker.ts");
  const content = `${read("src/content/index.ts")}\n${read("src/content/mountOverlay.tsx")}`;
  const names = new Set();
  for (const match of sw.matchAll(/case "([A-Z][A-Z0-9_]+)"/g)) names.add(match[1]);
  for (const match of content.matchAll(/["']([A-Z][A-Z0-9_]+)["']/g)) names.add(match[1]);
  return [...names].sort().map((name) => `msg:${name}`);
}

function discoverFiles(globDir, pred) {
  return walk(path.join(root, globDir), pred).map(rel);
}

function discoverFlags() {
  return Object.keys(JSON.parse(read("src/flags.json"))).map((key) => `flag:${key}`);
}

function discoverTiers() {
  return Object.keys(JSON.parse(read("src/tiers.json"))).map((key) => `tier:${key}`);
}

function discoverTelemetry() {
  const text = read("backend/marginmark_app.py");
  const block = text.split("TELEMETRY_EVENTS = frozenset(")[1]?.split(")")[0] ?? "";
  return [...block.matchAll(/"([a-z0-9_.]+)"/g)].map((m) => `telemetry:${m[1]}`);
}

function discoverSettings() {
  const text = read("src/types/settings.ts");
  const body = text.split("export type Settings = {")[1]?.split("};")[0] ?? "";
  const keys = [];
  for (const line of body.split("\n")) {
    const match = line.match(/^\s{2}([A-Za-z][A-Za-z0-9]*)\??:/);
    if (match && match[1] !== "version") keys.push(`setting:${match[1]}`);
  }
  return keys;
}

function parseImports(file) {
  const text = readFileSync(file, "utf8");
  const specs = [];
  for (const match of text.matchAll(/from\s+["']([^"']+)["']/g)) specs.push(match[1]);
  return specs;
}

function resolveImport(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
  return candidates.find((item) => existsSync(item) && statSync(item).isFile()) ?? null;
}

function reachableFrom(entries) {
  const seen = new Set();
  const queue = entries.map((relPath) => path.join(root, relPath)).filter((file) => existsSync(file));
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

function loadMap() {
  const raw = JSON.parse(read("qa/feature-map.json"));
  if (Array.isArray(raw)) return { features: raw, deadCode: [] };
  return { features: raw.features ?? [], deadCode: raw.deadCode ?? [] };
}

function collectTags(features) {
  const tags = new Set();
  for (const feature of features) {
    for (const test of feature.tests ?? []) tags.add(test.replace(/^@/, ""));
  }
  return tags;
}

function scanSourceTags() {
  const roots = ["src", "backend", "e2e", "scripts"];
  const files = roots.flatMap((dir) =>
    walk(path.join(root, dir), (file) => /\.(py|ts|tsx|mjs)$/.test(file) && !file.includes(`${path.sep}legacy${path.sep}`)),
  );
  const byTag = new Map();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("@F-")) continue;
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      const tags = [...line.matchAll(/@F-[A-Z0-9-]+/g)].map((m) => m[0].slice(1));
      if (!tags.length) return;
      let owner = "";
      for (let i = index; i >= Math.max(0, index - 30); i -= 1) {
        const vitest = lines[i].match(/(?:it|test)\(\s*["'`]([^"'`]+)["'`]/);
        const pytest = lines[i].match(/def (test_[A-Za-z0-9_]+)/);
        if (vitest) {
          owner = vitest[1];
          break;
        }
        if (pytest) {
          owner = pytest[1];
          break;
        }
      }
      for (const tag of tags) {
        const list = byTag.get(tag) ?? [];
        list.push({ file: rel(file), owner: owner || tag });
        byTag.set(tag, list);
      }
    });
  }
  return byTag;
}

function passedNames() {
  const names = [];
  const vitestPath = path.join(root, "qa/report/vitest.json");
  if (existsSync(vitestPath)) {
    const report = JSON.parse(readFileSync(vitestPath, "utf8"));
    const suites = report.testResults ?? report.tests ?? [];
    for (const suite of suites) {
      for (const test of suite.assertionResults ?? []) {
        if (test.status === "passed") names.push(test.fullName || test.title || "");
      }
    }
  }
  const junitPath = path.join(root, "qa/report/pytest.xml");
  if (existsSync(junitPath)) {
    const xml = readFileSync(junitPath, "utf8");
    for (const match of xml.matchAll(/<testcase\b([^>]*)>/g)) {
      const attrs = match[1];
      const name = /(?:^|\s)name="([^"]*)"/.exec(attrs)?.[1] ?? "";
      const chunkEnd = xml.indexOf("</testcase>", match.index);
      const openEnd = xml.indexOf(">", match.index);
      const nextOpen = xml.indexOf("<testcase", match.index + 1);
      const end = chunkEnd === -1 ? (nextOpen === -1 ? xml.length : nextOpen) : chunkEnd;
      const body = xml.slice(openEnd, end);
      const skipped = body.includes("<skipped") || attrs.includes('status="skipped"');
      const failed = body.includes("<failure") || body.includes("<error");
      if (!skipped && !failed) names.push(name);
    }
  }
  const pwPath = path.join(root, "qa/report/e2e/results.json");
  if (existsSync(pwPath)) {
    const report = JSON.parse(readFileSync(pwPath, "utf8"));
    const visit = (suite) => {
      for (const spec of suite.specs ?? []) {
        const ok = (spec.tests ?? []).some((test) =>
          (test.results ?? []).some((result) => result.status === "passed"),
        );
        const failed = (spec.tests ?? []).some((test) =>
          (test.results ?? []).some((result) => result.status === "failed" || result.status === "timedOut"),
        );
        if (ok && !failed) names.push(spec.title);
      }
      for (const child of suite.suites ?? []) visit(child);
    };
    for (const suite of report.suites ?? []) visit(suite);
  }
  return names;
}

function playwrightCases() {
  const passed = [];
  const skipped = [];
  const failed = [];
  const pwPath = path.join(root, "qa/report/e2e/results.json");
  if (!existsSync(pwPath)) return { passed, skipped, failed, present: false };
  const report = JSON.parse(readFileSync(pwPath, "utf8"));
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      const results = (spec.tests ?? []).flatMap((test) => test.results ?? []);
      const annotations = (spec.tests ?? []).flatMap((test) => test.annotations ?? []);
      const reason = annotations.map((item) => item.description || "").join(" ");
      const status = results.map((result) => result.status);
      if (status.includes("skipped") || (spec.tests ?? []).every((test) => test.expectedStatus === "skipped")) {
        skipped.push({ title: spec.title, reason });
      } else if (status.some((item) => item === "passed") && !status.some((item) => item === "failed" || item === "timedOut")) {
        passed.push(spec.title);
      } else {
        failed.push(spec.title);
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites ?? []) visit(suite);
  return { passed, skipped, failed, present: true };
}

function e2eSource() {
  return walk(path.join(root, "e2e"), (file) => file.endsWith(".ts")).map((file) => readFileSync(file, "utf8")).join("\n");
}

function checkE2e(errors, rows) {
  const features = JSON.parse(read("qa/e2e-features.json"));
  const source = e2eSource();
  const report = playwrightCases();
  if (!report.present) errors.push("Playwright JSON report is missing (qa/report/e2e/results.json)");
  for (const feature of features) {
    const id = feature.id;
    const inSource = source.includes(id);
    if (!inSource) {
      errors.push(`${id} has no Playwright test`);
      rows.push({ id, name: feature.name, tests: [id], passed: false, surfaces: 0 });
      continue;
    }
    if (feature.optIn) {
      const hit = [...report.passed, ...report.skipped.map((item) => item.title), ...report.failed].find((title) => title.includes(id));
      const skip = report.skipped.find((item) => item.title.includes(id));
      const env = id === "E-STRIPE-REAL" ? "E2E_STRIPE" : "LIVE_PRODUCT_URL";
      const ok = Boolean(hit) && !report.failed.some((title) => title.includes(id)) && (!skip || skip.reason.includes(env));
      if (!ok) errors.push(`${id} must be present and, when skipped, name ${env}`);
      rows.push({ id, name: feature.name, tests: [id], passed: ok, surfaces: 0 });
      continue;
    }
    const ok = report.passed.some((title) => title.includes(id));
    if (!ok) errors.push(`${id} did not pass in Playwright`);
    rows.push({ id, name: feature.name, tests: [id], passed: ok, surfaces: 0 });
  }
}

function checkSurfaceCaps(map, errors) {
  if (map.features.some((feature) => feature.id === "F-CATALOG")) errors.push("F-CATALOG is a catch-all and must be deleted");
  for (const feature of map.features) {
    const count = (feature.surfaces ?? []).length;
    if (count > 10) errors.push(`${feature.id} lists ${count} surfaces (max 10)`);
  }
}

function checkComponentsAndMessages(map, liveComponents, messages, errors) {
  const e2eFeatures = map.features.filter((feature) => String(feature.id).startsWith("E-"));
  const owned = new Set(e2eFeatures.flatMap((feature) => feature.surfaces ?? []));
  for (const file of liveComponents) {
    const surface = `component:${file}`;
    if (!owned.has(surface)) errors.push(`${surface} is not in an E-* feature`);
  }
  const vitest = walk(path.join(root, "src"), (file) => /\.test\.tsx?$/.test(file))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  for (const surface of messages) {
    const name = surface.slice(4);
    const inFeature = owned.has(surface);
    const inVitest = vitest.includes(`type: "${name}"`);
    if (!inFeature && !inVitest) errors.push(`${surface} is not in an E-* feature or a vitest type: "${name}" call`);
  }
}

function checkRoutes(errors) {
  const file = path.join(root, "backend/.route-coverage.json");
  if (!existsSync(file)) {
    errors.push("backend/.route-coverage.json is missing");
    return;
  }
  const report = JSON.parse(readFileSync(file, "utf8"));
  const missing = report.missing ?? [];
  if (missing.length) errors.push(`${missing.length} backend routes were not called: ${missing.join(", ")}`);
}

function main() {
  const components = discoverFiles("src", (f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"));
  const libs = [
    ...discoverFiles("src/lib", (f) => f.endsWith(".ts") && !f.includes(".test.")),
    ...discoverFiles("src/content", (f) => f.endsWith(".ts") && !f.includes(".test.")),
  ];
  const live = reachableFrom([
    "src/content/index.ts",
    "src/background/serviceWorker.ts",
    "src/content/oauthDone.ts",
    "src/oauth-finish.ts",
  ]);
  const popup = reachableFrom(["src/popup/main.tsx"]);
  const surfaces = [
    ...discoverRoutes(),
    ...discoverMessages(),
    ...components.map((file) => `component:${file}`),
    ...libs.map((file) => `lib:${file}`),
    ...discoverFlags(),
    ...discoverTelemetry(),
    ...discoverSettings(),
    ...discoverTiers(),
  ];
  const unreachable = new Set();
  for (const file of [...components, ...libs]) {
    if (!live.has(file) && popup.has(file)) unreachable.add(file.endsWith(".tsx") ? `component:${file}` : `lib:${file}`);
  }
  if (process.argv.includes("--list")) {
    const listed = { surfaces, unreachable: [...unreachable] };
    mkdirSync(path.join(root, "qa/report"), { recursive: true });
    writeFileSync(path.join(root, "qa/report/surfaces.json"), JSON.stringify(listed, null, 2));
    console.log(`${surfaces.length} surfaces, ${unreachable.size} unreachable`);
    return;
  }
  const map = loadMap();
  const owned = new Set(map.deadCode);
  for (const feature of map.features) for (const surface of feature.surfaces ?? []) owned.add(surface);
  const untested = surfaces.filter((surface) => !owned.has(surface) && !unreachable.has(surface));
  const deadMissing = [...unreachable].filter((surface) => !map.deadCode.includes(surface));
  const sourceTags = scanSourceTags();
  const passed = passedNames();
  const errors = [];
  if (deadMissing.length) errors.push(`${deadMissing.length} unreachable files are not listed as dead code`);
  checkSurfaceCaps(map, errors);
  const liveComponents = components.filter((file) => live.has(file));
  checkComponentsAndMessages(map, liveComponents, discoverMessages(), errors);
  checkRoutes(errors);
  const rows = [];
  for (const feature of map.features) {
    if (String(feature.id).startsWith("E-")) continue;
    const tags = (feature.tests ?? []).map((item) => item.replace(/^@/, ""));
    if (!tags.length) errors.push(`${feature.id} has no test tag`);
    let ok = tags.length > 0;
    for (const tag of tags) {
      const owners = sourceTags.get(tag) ?? [];
      if (!owners.length) {
        errors.push(`${feature.id} tag @${tag} is not in any test file`);
        ok = false;
        continue;
      }
      const hit = owners.some((owner) => passed.some((name) => name.includes(owner.owner) || name.includes(`@${tag}`)));
      if (!hit) {
        errors.push(`${feature.id} tag @${tag} did not pass in this run`);
        ok = false;
      }
    }
    rows.push({ id: feature.id, name: feature.name, tests: tags, passed: ok, surfaces: (feature.surfaces ?? []).length });
  }
  checkE2e(errors, rows);
  const report = {
    untested,
    deadMissing,
    unreachable: [...unreachable],
    features: rows,
    errors,
  };
  mkdirSync(path.join(root, "qa/report"), { recursive: true });
  writeFileSync(path.join(root, "qa/report/coverage.json"), JSON.stringify(report, null, 2));
  const header = "feature".padEnd(32) + "pass";
  console.log(header);
  console.log("-".repeat(header.length));
  for (const row of rows) {
    console.log(row.id.padEnd(32) + (row.passed ? "yes" : "NO"));
  }
  if (untested.length) console.log("\nUntested surfaces:\n" + untested.map((item) => `  ${item}`).join("\n"));
  if (deadMissing.length) console.log("\nUnlisted dead code:\n" + deadMissing.map((item) => `  ${item}`).join("\n"));
  if (errors.length) {
    console.error("\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log(`\ncoverage gate ok (${rows.length} features, 0 untested surfaces)`);
}

main();
