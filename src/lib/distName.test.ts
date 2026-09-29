import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LEGACY = ["MarginGuard", "TikTok Seller Tool"];

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (/\.(js|html|json|css|txt|svg)$/.test(name)) files.push(path);
  }
  return files;
}

const DIST = join(process.cwd(), "dist");

describe("built dist product name", () => {
  // A fresh checkout has no dist/ yet. `npm run build` creates it, and verify-prod.mjs checks it again.
  it.skipIf(!existsSync(DIST))("does not contain MarginGuard or TikTok Seller Tool", () => {
    const root = DIST;
    const files = walk(root);
    expect(files.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const path of files) {
      const text = readFileSync(path, "utf8");
      for (const legacy of LEGACY) {
        if (text.includes(legacy)) hits.push(`${path}: ${legacy}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
