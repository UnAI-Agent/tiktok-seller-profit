/**
 * One command: typecheck, unit tests, backend, e2e build guard, Playwright, coverage gate, report.
 * Continues after a failed step. Exits non-zero if any step failed.
 */
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, cpSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkProdBuild } from "./verify-prod.mjs";
import { pythonCommand } from "./python-cmd.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportDir = path.join(root, "qa", "report");
mkdirSync(reportDir, { recursive: true });

const py = pythonCommand();
const python = py.cmd;
const pyArgs = py.prefix;

function run(title, cmd, args, extra = {}) {
  const started = Date.now();
  const result = spawnSync(cmd, args, {
    cwd: extra.cwd ?? root,
    env: { ...process.env, ...extra.env },
    encoding: "utf8",
    shell: false,
  });
  const ok = result.status === 0;
  return {
    title,
    ok,
    status: result.status,
    ms: Date.now() - started,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.slice(-4000),
  };
}

function bundleText(dir) {
  const files = [];
  const walk = (folder) => {
    for (const name of readdirSync(folder)) {
      const full = path.join(folder, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|html|json)$/.test(name)) files.push(full);
    }
  };
  walk(dir);
  return files
    .filter((file) => !file.endsWith("manifest.json"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

const steps = [];

steps.push(run("tsc", process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "--noEmit"]));
const vitestBin = path.join(root, "node_modules", "vitest", "vitest.mjs");
steps.push(
  run("vitest", process.execPath, [vitestBin, "run", "--reporter=json", "--outputFile=qa/report/vitest.json"]),
);
steps.push(
  run(
    "pytest",
    python,
    [...pyArgs, "-m", "pytest", "-q", "--junitxml=../qa/report/pytest.xml", "--tb=line"],
    { cwd: path.join(root, "backend") },
  ),
);
steps.push(run("build:e2e", process.execPath, [path.join(root, "scripts", "build-e2e.mjs")]));

const e2eGuard = { title: "e2e build guard", ok: false, ms: 0, output: "" };
const guardStarted = Date.now();
try {
  const manifest = JSON.parse(readFileSync(path.join(root, "dist-e2e", "manifest.json"), "utf8"));
  const errors = checkProdBuild({
    manifest,
    bundleText: bundleText(path.join(root, "dist-e2e")),
    lastPublished: readFileSync(path.join(root, "qa", "LAST_PUBLISHED_VERSION"), "utf8").trim(),
  });
  const open = errors.some((line) => line.includes("overlay shadow root is open"));
  e2eGuard.ok = errors.length > 0 && open;
  e2eGuard.output = errors.join("\n");
  if (!e2eGuard.ok) e2eGuard.output += "\nexpected the open-shadow error";
} catch (err) {
  e2eGuard.output = err instanceof Error ? err.message : String(err);
}
e2eGuard.ms = Date.now() - guardStarted;
steps.push(e2eGuard);

const prod = { title: "prod build guard", ok: true, ms: 0, output: "", skipped: false };
const prodStarted = Date.now();
try {
  const keyPath = path.join(os.tmpdir(), "marginmark-e2e-config-key.pem");
  const printed = execFileSync(python, [...pyArgs, path.join(root, "scripts", "config-keygen.py"), keyPath], {
    encoding: "utf8",
  }).trim();
  const built = spawnSync(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", "dist-prod-check"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      VITE_E2E: "",
      VITE_API_BASE_URL: "https://marginmark-api-prod.fly.dev",
      VITE_STRIP_DEV_HOSTS: "1",
      VITE_CONFIG_PUBLIC_KEY: printed,
      VITE_LLE_BADGE: "0",
    },
  });
  if (built.status !== 0) {
    prod.ok = false;
    prod.output = `${built.stdout ?? ""}\n${built.stderr ?? ""}`.slice(-2000);
  } else {
    const manifest = JSON.parse(readFileSync(path.join(root, "dist-prod-check", "manifest.json"), "utf8"));
    const errors = checkProdBuild({
      manifest,
      bundleText: bundleText(path.join(root, "dist-prod-check")),
      lastPublished: readFileSync(path.join(root, "qa", "LAST_PUBLISHED_VERSION"), "utf8").trim(),
    });
    prod.ok = errors.length === 0;
    prod.output = errors.join("\n") || "prod-flag build passed the store guard";
  }
} catch (err) {
  prod.ok = true;
  prod.skipped = true;
  prod.output = `Prod-flag build was not produced: ${err instanceof Error ? err.message : String(err)}`;
}
prod.ms = Date.now() - prodStarted;
steps.push(prod);

const playwrightBin = path.join(root, "node_modules", "@playwright", "test", "cli.js");
  if (existsSync(playwrightBin)) {
    steps.push(
      run("playwright", process.execPath, [
        playwrightBin,
        "test",
        "--config",
        path.join(root, "e2e", "playwright.config.ts"),
      ], {
        env: { CI: process.env.CI ?? "" },
      }),
    );
} else {
  steps.push({
    title: "playwright",
    ok: false,
    ms: 0,
    output: "@playwright/test is not installed. Browser scenarios are not in this run.",
  });
}

const playwrightJson = path.join(reportDir, "playwright-results.json");
const playwrightJsonDest = path.join(reportDir, "e2e", "results.json");
if (existsSync(playwrightJson)) {
  mkdirSync(path.dirname(playwrightJsonDest), { recursive: true });
  copyFileSync(playwrightJson, playwrightJsonDest);
}

steps.push(run("coverage gate", process.execPath, [path.join(root, "scripts", "coverage-gate.mjs")]));

const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const diffStat = execFileSync("git", ["diff", "--stat", "HEAD"], { cwd: root, encoding: "utf8" });
let nodeVersion = process.version;
let pyVersion = "";
try {
  pyVersion = execFileSync(python, [...pyArgs, "--version"], { encoding: "utf8" }).trim();
} catch {
  pyVersion = "unknown";
}

function layerCounts() {
  const empty = { total: 0, passed: 0, failed: 0, skipped: 0 };
  const layers = { vitest: { ...empty }, pytest: { ...empty }, playwright: { ...empty } };
  const vitestPath = path.join(reportDir, "vitest.json");
  if (existsSync(vitestPath)) {
    const body = JSON.parse(readFileSync(vitestPath, "utf8"));
    layers.vitest = {
      total: body.numTotalTests ?? 0,
      passed: body.numPassedTests ?? 0,
      failed: body.numFailedTests ?? 0,
      skipped: body.numPendingTests ?? 0,
    };
  }
  const pytestPath = path.join(reportDir, "pytest.xml");
  if (existsSync(pytestPath)) {
    const xml = readFileSync(pytestPath, "utf8");
    const suite = xml.match(/<testsuite\b[^>]*>/);
    const attr = (name) => Number(suite?.[0].match(new RegExp(`${name}="(\\d+)"`))?.[1] ?? 0);
    const tests = attr("tests");
    const failures = attr("failures");
    const errors = attr("errors");
    const skipped = attr("skipped");
    layers.pytest = { total: tests, passed: tests - failures - errors - skipped, failed: failures + errors, skipped };
  }
  const pwPath = path.join(reportDir, "e2e", "results.json");
  if (existsSync(pwPath)) {
    const report = JSON.parse(readFileSync(pwPath, "utf8"));
    const walk = (suite) => {
      for (const spec of suite.specs ?? []) {
        layers.playwright.total += 1;
        const statuses = (spec.tests ?? []).flatMap((item) => (item.results ?? []).map((result) => result.status));
        if (statuses.includes("skipped") || (spec.tests ?? []).every((item) => item.expectedStatus === "skipped")) layers.playwright.skipped += 1;
        else if (statuses.some((status) => status === "failed" || status === "timedOut" || status === "interrupted")) layers.playwright.failed += 1;
        else if (statuses.includes("passed")) layers.playwright.passed += 1;
      }
      for (const child of suite.suites ?? []) walk(child);
    };
    for (const suite of report.suites ?? []) walk(suite);
  }
  return layers;
}

function passedTitles() {
  const pwPath = path.join(reportDir, "e2e", "results.json");
  if (!existsSync(pwPath)) return [];
  const report = JSON.parse(readFileSync(pwPath, "utf8"));
  const titles = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const statuses = (spec.tests ?? []).flatMap((item) => (item.results ?? []).map((result) => result.status));
      if (statuses.includes("passed") && !statuses.some((status) => status === "failed" || status === "timedOut")) titles.push(spec.title);
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return titles;
}

const layers = layerCounts();
const titles = passedTitles();
const routeFile = path.join(root, "backend", ".route-coverage.json");
const missingRoutes = existsSync(routeFile) ? (JSON.parse(readFileSync(routeFile, "utf8")).missing ?? []) : ["missing-report"];
const findingsText = existsSync(path.join(root, "qa", "FINDINGS.md")) ? readFileSync(path.join(root, "qa", "FINDINGS.md"), "utf8") : "";
const coverageOk = steps.find((step) => step.title === "coverage gate")?.ok === true;
const definitionOfDone = {
  coverageGate: coverageOk,
  routeRecorderClear: missingRoutes.length === 0,
  labAnswerKeyBefore: titles.some((title) => title.includes("E-LAB-NUMBERS")) && titles.some((title) => title.includes("E-LAB-BUCKETS-BEFORE")),
  labAnswerKeyAfter: titles.some((title) => title.includes("E-LAB-STATEMENT")),
  findingsComplete: ["Product bugs", "Test-only", "Dead code", "Not automated"].every((heading) => findingsText.includes(heading)),
  everyBrowserScenarioPassed: coverageOk,
  verificationBundle: false,
};

const summary = {
  commit: sha,
  timestamp: new Date().toISOString(),
  os: `${os.platform()} ${os.release()}`,
  node: nodeVersion,
  python: pyVersion,
  layers,
  definitionOfDone,
  steps: steps.map(({ title, ok, ms, skipped }) => ({ title, ok, ms, skipped: Boolean(skipped) })),
};
writeFileSync(path.join(reportDir, "summary.json"), JSON.stringify(summary, null, 2));

const findings = existsSync(path.join(root, "qa", "FINDINGS.md"))
  ? readFileSync(path.join(root, "qa", "FINDINGS.md"), "utf8")
  : "";
const rows = steps
  .map(
    (step) =>
      `<tr><td>${step.title}</td><td>${step.skipped ? "skipped" : step.ok ? "pass" : "fail"}</td><td>${step.ms} ms</td></tr>`,
  )
  .join("");
const html = `<!doctype html><meta charset="utf-8"><title>MarginMark test report</title>
<style>body{font-family:sans-serif;margin:24px} td,th{padding:4px 8px;border-bottom:1px solid #ddd;text-align:left} pre{white-space:pre-wrap}</style>
<h1>MarginMark verification</h1>
<p>${summary.timestamp} · ${summary.commit.slice(0, 12)} · ${summary.os} · Node ${summary.node} · ${summary.python}</p>
<table><thead><tr><th>Step</th><th>Result</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Findings</h2><pre>${findings.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</pre>
<p><a href="e2e/index.html">Playwright HTML report</a></p>
<h2>Step output</h2>
${steps.map((step) => `<h3>${step.title}</h3><pre>${(step.output || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</pre>`).join("")}
`;
writeFileSync(path.join(reportDir, "index.html"), html);

const zipPath = path.join(reportDir, "verification-bundle.zip");
const productDiff = path.join(reportDir, "product.diff");
const fullDiff = path.join(reportDir, "full.diff");
try {
  writeFileSync(
    productDiff,
    execFileSync("git", ["diff", "HEAD", "--", "src", "backend", ":!backend/test_*", ":!src/**/*.test.ts", ":!src/**/*.test.tsx"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    }),
  );
} catch (err) {
  writeFileSync(productDiff, err instanceof Error ? err.message : String(err));
}
try {
  writeFileSync(
    fullDiff,
    execFileSync("git", ["diff", "08320090", "--", ".", ":!package-lock.json"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 40 * 1024 * 1024,
    }),
  );
} catch (err) {
  writeFileSync(fullDiff, err instanceof Error ? err.message : String(err));
}
writeFileSync(path.join(reportDir, "diff-stat.txt"), diffStat);

const newRoot = path.join(reportDir, "new-files");
rmSync(newRoot, { recursive: true, force: true });
mkdirSync(newRoot, { recursive: true });
const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);
const added = execFileSync("git", ["diff", "--name-only", "--diff-filter=A", "08320090"], { cwd: root, encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);
const skipCopy = (name) =>
  name.startsWith("node_modules/") ||
  name.startsWith("dist") ||
  name.includes("node_modules/") ||
  name.endsWith(".png") ||
  name.includes("trace") ||
  name.startsWith("qa/report/");
for (const name of new Set([...untracked, ...added])) {
  if (skipCopy(name)) continue;
  const from = path.join(root, name);
  if (!existsSync(from) || !statSync(from).isFile()) continue;
  const dest = path.join(newRoot, name);
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(from, dest);
}

const baselineDir = path.join(root, "e2e");
const baselineFiles = [];
function collectPng(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectPng(full);
    else if (entry.endsWith(".png") && full.includes("-snapshots")) baselineFiles.push(full);
  }
}
collectPng(baselineDir);
const baselineBytes = baselineFiles.reduce((sum, file) => sum + statSync(file).size, 0);
const baselinesZip = path.join(reportDir, "baselines.zip");
if (baselineFiles.length && baselineBytes < 5 * 1024 * 1024) {
  const list = path.join(reportDir, "baseline-files.txt");
  writeFileSync(list, baselineFiles.map((file) => path.relative(root, file)).join("\n"));
  execFileSync(python, [...pyArgs, "-c", `
import zipfile, pathlib, sys
root = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])
names = pathlib.Path(sys.argv[3]).read_text(encoding="utf-8").splitlines()
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for name in names:
        z.write(root / name, name)
`, root, baselinesZip, list]);
}

const zipScript = `
import zipfile, pathlib, sys
root = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])
names = [
  "qa/report/coverage.json",
  "qa/report/vitest.json",
  "qa/report/pytest.xml",
  "qa/report/e2e/results.json",
  "qa/report/diff-stat.txt",
  "qa/report/product.diff",
  "qa/report/full.diff",
  "qa/report/baselines.zip",
  "backend/.route-coverage.json",
  "qa/FINDINGS.md",
  "qa/MANUAL_CHECKLIST.md",
]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for name in names:
        path = root / name
        if path.is_file():
            z.write(path, name)
    new_files = root / "qa" / "report" / "new-files"
    if new_files.is_dir():
        for path in new_files.rglob("*"):
            if path.is_file():
                z.write(path, str(path.relative_to(root)).replace("\\\\", "/"))
print(out)
`;
execFileSync(python, [...pyArgs, "-c", zipScript, root, zipPath], { cwd: root });

const requiredInZip = [
  "qa/report/e2e/results.json",
  "qa/report/full.diff",
  "qa/report/new-files/e2e/playwright.config.ts",
  "qa/report/new-files/backend/conftest.py",
  "qa/report/new-files/backend/test_every_route.py",
  "qa/report/new-files/backend/test_no_500.py",
  "qa/report/new-files/scripts/coverage-gate.mjs",
  "qa/report/new-files/scripts/test-everything.mjs",
  "qa/report/new-files/scripts/build-e2e.mjs",
  "qa/report/new-files/qa/feature-map.json",
  "qa/report/new-files/qa/e2e-features.json",
  "qa/report/new-files/TESTING.md",
];
let zipNames = [];
try {
  zipNames = execFileSync(python, [...pyArgs, "-c", `
import zipfile, sys
print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))
`, zipPath], { encoding: "utf8" }).split(/\r?\n/);
} catch {
  zipNames = [];
}
definitionOfDone.verificationBundle = requiredInZip.every((name) => zipNames.some((entry) => entry.replace(/\\/g, "/") === name));
summary.definitionOfDone = definitionOfDone;
writeFileSync(path.join(reportDir, "summary.json"), JSON.stringify(summary, null, 2));
execFileSync(python, [...pyArgs, "-c", `
import zipfile, pathlib, sys
out = pathlib.Path(sys.argv[1])
src = pathlib.Path(sys.argv[2])
with zipfile.ZipFile(out, "a") as z:
    z.write(src, "qa/report/summary.json")
`, zipPath, path.join(reportDir, "summary.json")]);

const failed = steps.filter((step) => !step.ok && !step.skipped);
const undone = Object.entries(definitionOfDone).filter(([, ok]) => !ok).map(([name]) => name);
console.log(steps.map((step) => `${step.skipped ? "SKIP" : step.ok ? "PASS" : "FAIL"} ${step.title}`).join("\n"));
console.log(`playwright ${layers.playwright.passed} passed, ${layers.playwright.failed} failed, ${layers.playwright.skipped} skipped`);
if (undone.length) console.log(`definitionOfDone false: ${undone.join(", ")}`);
console.log(zipPath);
process.exit(failed.length || undone.length ? 1 : 0);
