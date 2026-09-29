import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const path = join(process.cwd(), "dist", "manifest.json");
const manifest = JSON.parse(readFileSync(path, "utf8"));
for (const resource of manifest.web_accessible_resources ?? []) {
  resource.use_dynamic_url = true;
}
writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
