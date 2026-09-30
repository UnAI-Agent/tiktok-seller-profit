import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const APPROVED_PERMISSIONS = ["storage", "alarms", "scripting"];

export const PERMISSION_APIS = {
  storage: "chrome.storage",
  alarms: "chrome.alarms",
  scripting: "chrome.scripting",
};

export function unusedPermissions(permissions, bundleText) {
  const errors = [];
  for (const permission of permissions ?? []) {
    const api = PERMISSION_APIS[permission];
    if (!api) errors.push(`permission has no chrome API: ${permission}`);
    else if (!bundleText.includes(api)) errors.push(`permission unused: ${permission}`);
  }
  return errors;
}

export function missingConfigKey(bundleText) {
  return !String(bundleText).includes("MCowBQYDK2VwAyEA");
}

export function versionGreater(next, previous) {
  const a = String(next).split(".").map((n) => Number(n) || 0);
  const b = String(previous).split(".").map((n) => Number(n) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff > 0) return true;
    if (diff < 0) return false;
  }
  return false;
}

export function checkProdBuild({ manifest, bundleText, lastPublished }) {
  const errors = [];
  const manifestText = JSON.stringify(manifest);
  const blob = `${manifestText}\n${bundleText}`;
  if (/https?:\/\/localhost/i.test(blob)) errors.push("contains localhost");
  if (/https?:\/\/127\.0\.0\.1/.test(blob)) errors.push("contains 127.0.0.1");
  if (blob.includes("marginmark-api-lle")) errors.push("contains the LLE API host");
  if (blob.includes("LLE: test data")) errors.push("contains the LLE test-data strip");
  for (const legacy of ["MarginGuard", "TikTok Seller Tool"]) {
    if (blob.includes(legacy)) errors.push(`contains ${legacy}`);
  }
  if (/pk_test_|sk_test_/.test(blob)) errors.push("contains a Stripe test key");
  if (blob.includes("8765")) errors.push("contains 8765");
  if (bundleText.includes("VITE_SHOW_CREATOR_DEMO")) {
    errors.push("contains the creator demo flag");
  }
  for (const permission of manifest.permissions ?? []) {
    if (!APPROVED_PERMISSIONS.includes(permission)) {
      errors.push(`permission not approved: ${permission}`);
    }
  }
  for (const resource of manifest.web_accessible_resources ?? []) {
    const resources = resource.resources ?? [];
    const matches = resource.matches ?? [];
    if (matches.includes("<all_urls>") || matches.includes("http://*/*") || matches.includes("https://*/*")) {
      errors.push("web accessible resources are too broadly exposed");
    }
    if (resources.includes("oauth-finish.html") && resource.use_dynamic_url !== true) {
      errors.push("oauth-finish must use a dynamic URL");
    }
  }
  if (!manifest.content_security_policy?.extension_pages) {
    errors.push("extension CSP missing");
  }
  if (!versionGreater(manifest.version, lastPublished)) {
    errors.push(`version ${manifest.version} is not newer than ${lastPublished}`);
  }
  const compact = String(bundleText).replace(/\s+/g, "");
  const openLiteral = /attachShadow\(\{mode:"open"/.test(compact);
  const binding = /attachShadow\(\{mode:([A-Za-z_$][\w$]*)\}/.exec(compact);
  const openBinding = binding ? compact.includes(`${binding[1]}="open"`) : false;
  if (openLiteral || openBinding) {
    errors.push("test build: overlay shadow root is open (built with VITE_E2E=1)");
  }
  return errors;
}

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (name.endsWith(".js") || name.endsWith(".html") || name.endsWith(".json")) {
      files.push(path);
    }
  }
  return files;
}

function main() {
  const root = process.cwd();
  const files = walk(join(root, "dist"));
  const bundleText = files
    .filter((path) => !path.endsWith("manifest.json"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const manifestText = files.some((path) => path.endsWith("manifest.json"))
    ? readFileSync(join(root, "dist", "manifest.json"), "utf8")
    : "";
  const legacy = ["MarginGuard", "TikTok Seller Tool"].filter((name) =>
    `${manifestText}\n${bundleText}`.includes(name),
  );
  if (process.argv.includes("--names-only")) {
    if (legacy.length > 0) {
      console.error(legacy.map((name) => `contains ${name}`).join("\n"));
      process.exit(1);
    }
    console.log("product name ok");
    return;
  }
  const manifest = JSON.parse(manifestText);
  const lastPublished = readFileSync(join(root, "qa", "LAST_PUBLISHED_VERSION"), "utf8").trim();
  const errors = checkProdBuild({ manifest, bundleText, lastPublished });
  errors.push(...unusedPermissions(manifest.permissions, bundleText));
  if (missingConfigKey(bundleText)) errors.push("CONFIG_PUBLIC_KEY is empty");
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(`prod build ok ${manifest.version} > ${lastPublished}`);
}

if (process.argv[1] && process.argv[1].endsWith("verify-prod.mjs")) main();
