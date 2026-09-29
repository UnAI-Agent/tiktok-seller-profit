import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) out.push(path);
  }
  return out;
}

describe("content script storage", () => {
  it("n18_content_scripts_do_not_touch_storage", () => {
    const root = join(process.cwd(), "src", "content");
    const hits = filesUnder(root).filter((path) => readFileSync(path, "utf8").includes("chrome.storage"));
    expect(hits).toEqual([]);
  });
});
