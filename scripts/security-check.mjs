import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const root = process.cwd();
const dangerous = [
  ["dangerouslySetInnerHTML", /\bdangerouslySetInnerHTML\b/],
  ["innerHTML", /\.innerHTML\b/],
  ["outerHTML", /\.outerHTML\b/],
  ["insertAdjacentHTML", /\binsertAdjacentHTML\b/],
  ["document.write", /\bdocument\.write\b/],
  ["eval", /\beval\s*\(/],
  ["new Function", /\bnew\s+Function\s*\(/],
];

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(join(root, "src")).filter(
  (path) =>
    [".ts", ".tsx"].includes(extname(path)) &&
    !path.endsWith(".test.ts") &&
    !path.endsWith(".test.tsx"),
);
const errors = [];
for (const path of files) {
  const text = readFileSync(path, "utf8");
  for (const [name, pattern] of dangerous) {
    if (pattern.test(text)) errors.push(`${path}: forbidden ${name}`);
  }
  for (const match of text.matchAll(/href=\{([^}]+)\}/g)) {
    const expression = match[1].trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(expression) && !expression.startsWith("safeUrl(")) {
      errors.push(`${path}: dynamic href must use safeUrl()`);
    }
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("security source check passed");
