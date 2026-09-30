import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pythonCommand } from "./python-cmd.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = pythonCommand();
const result = spawnSync(python.cmd, [...python.prefix, "-m", "pytest", "-q", "--tb=line"], {
  cwd: path.join(root, "backend"),
  stdio: "inherit",
});
process.exit(result.status ?? 1);
