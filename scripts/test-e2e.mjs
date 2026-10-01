import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "node_modules", "@playwright", "test", "cli.js");
const live = process.argv.includes("--live");
if (!live) {
  const built = spawnSync(process.execPath, [path.join(root, "scripts", "build-e2e.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  if (built.status !== 0) process.exit(built.status ?? 1);
}
const args = [cli, "test", "--config", path.join(root, "e2e", "playwright.config.ts")];
if (live) args.push("e2e/live");
// Anything else is passed to Playwright, e.g. -g E-VIS-SNAPSHOTS --update-snapshots
args.push(...process.argv.slice(2).filter((arg) => arg !== "--live"));
// Writing screenshot baselines: let the visual test run on an OS that has none yet.
if (process.argv.some((arg) => arg.startsWith("--update-snapshots"))) process.env.E2E_VISUAL_BASELINES = "1";
const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
