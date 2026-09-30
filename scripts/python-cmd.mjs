import { spawnSync } from "node:child_process";

/** Python that can import the API. `E2E_PYTHON` wins. On Windows, `py -3` then `py -3.12`. */
export function pythonCommand() {
  if (process.env.E2E_PYTHON) return { cmd: process.env.E2E_PYTHON, prefix: [] };
  if (process.platform === "win32") {
    for (const prefix of [["-3"], ["-3.12"]]) {
      const probe = spawnSync("py", [...prefix, "-c", "import dotenv, uvicorn, fastapi"], { stdio: "ignore" });
      if (probe.status === 0) return { cmd: "py", prefix };
    }
    return { cmd: "py", prefix: ["-3"] };
  }
  return { cmd: "python3", prefix: [] };
}
