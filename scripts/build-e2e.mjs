import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pythonCommand } from "./python-cmd.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const py = pythonCommand();
const keyPath = path.join(os.tmpdir(), "marginmark-e2e-config.pem");
const generated = spawnSync(py.cmd, [...py.prefix, path.join(root, "scripts", "config-keygen.py"), keyPath], {
  cwd: root,
  encoding: "utf8",
});
if (generated.status !== 0) {
  console.error(generated.stderr || generated.stdout);
  process.exit(generated.status ?? 1);
}
const publicKey = generated.stdout.trim();
const report = path.join(root, "qa", "report");
mkdirSync(report, { recursive: true });
writeFileSync(path.join(report, "e2e-public-key.txt"), publicKey);
writeFileSync(path.join(report, "e2e-key-path.txt"), keyPath);

const result = spawnSync(process.execPath, [viteBin, "build", "--outDir", "dist-e2e"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_E2E: "1",
    VITE_API_BASE_URL: "http://127.0.0.1:8000",
    VITE_CONFIG_PUBLIC_KEY: publicKey,
  },
});

process.exit(result.status ?? 1);
