#!/usr/bin/env node
/**
 * Launch check: is this repo and this API ready to take money?
 *
 *   npm run launch:check -- https://your-api-host
 *
 * Reads the repo (prices, flags, version, store copy) and the API's /health
 * "ready" block (yes/no only; the API never reports secret values). Prints one
 * line per check with the fix, and exits 1 if anything blocks launch.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const json = (file) => JSON.parse(read(file));
const results = [];
const check = (ok, label, fix, level = "block") => results.push({ ok, label, fix, level });

function newer(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

// --- Repo -------------------------------------------------------------------
const tiers = json("src/tiers.json");
check(tiers.pro.monthlyUsd === 14.99 && tiers.pro.yearlyUsd === 120, "Pro is $14.99/month and $120/year in src/tiers.json", "set pro.monthlyUsd 14.99 and pro.yearlyUsd 120");
check(tiers.pro.trialDays === 7, "7-day trial in src/tiers.json (matches store/terms.html)", "set pro.trialDays to 7 or update the terms");
check(tiers.free.skuLimit === 5, "Free covers costs on 5 products (matches the listing)", "set free.skuLimit to 5 or update store/LISTING.md");

const flags = json("src/flags.json");
check(!flags.diamondEnabled.enabled, "Diamond is off (it has no Stripe prices or screens yet)", "turn diamondEnabled off in src/flags.json");
for (const key of ["statementImport", "creatorProfit", "bulkCost", "whatIf", "csvExport", "promoGuard"]) {
  check(flags[key]?.enabled === true, `${key} is on (the plan picker and listing promise it)`, `turn ${key} on in src/flags.json`);
}

const manifest = json("manifest.json");
const pkg = json("package.json");
const published = existsSync(path.join(root, "qa/LAST_PUBLISHED_VERSION")) ? read("qa/LAST_PUBLISHED_VERSION").trim() : "0.0.0";
check(manifest.version === pkg.version, `manifest version ${manifest.version} matches package.json`, "make them equal");
check(newer(manifest.version, published), `version ${manifest.version} is newer than the last published ${published}`, "bump the version in manifest.json and package.json");
check((manifest.description ?? "").length <= 132, "manifest description fits the 132-character store limit", "shorten manifest.json description");

const privacy = read("store/privacy.html");
check(/creator/i.test(privacy) && /Shop Performance Score/i.test(privacy), "privacy policy covers creator orders and the Shop Performance Score", "update store/privacy.html");
check(existsSync(path.join(root, "store/LISTING.md")), "store listing copy exists (store/LISTING.md)", "write the listing");
const shots = readdirSync(path.join(root, "store")).filter((name) => /\.(png|jpe?g)$/i.test(name));
check(shots.length >= 3, `store has ${shots.length} screenshot(s); 3 to 5 sell better`, "add 1280×800 screenshots listed in store/LISTING.md", "warn");

// --- API --------------------------------------------------------------------
const base = (process.argv[2] ?? process.env.MARGINMARK_API ?? "").replace(/\/+$/, "");
const FIX = {
  mail: "set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM. Without mail nobody can verify an email, so nobody can start a trial.",
  stripe_key_set: "set STRIPE_SECRET_KEY (sk_live_… for prod).",
  webhook_signing_set: "set STRIPE_WEBHOOK_SECRET from the Stripe webhook endpoint.",
  webhook_events_confirmed: "subscribe the endpoint to checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed, then set STRIPE_WEBHOOK_EVENTS_CONFIRMED=1.",
  pro_prices_set: "set STRIPE_PRICE_PRO_MONTHLY ($14.99/month) and STRIPE_PRICE_PRO_YEARLY ($120/year).",
  config_signing_key_set: "set CONFIG_PUBLIC_KEY (from python scripts/config-keygen.py) so the kill switches work.",
  public_base_url_set: "set PUBLIC_BASE_URL to the API's https URL (Stripe success and cancel links use it).",
};
if (!base) {
  check(false, "API readiness not checked", "pass the API URL: npm run launch:check -- https://your-api-host");
} else {
  try {
    const res = await fetch(`${base}/health`);
    const body = await res.json();
    check(res.ok && body.status === "ok", `${base}/health answers`, "deploy the API");
    check(body.app_env === "prod", `API runs as prod (app_env=${body.app_env})`, "set APP_ENV=prod on the production API", "warn");
    if (!body.ready) {
      check(false, "API reports launch readiness", "deploy this version of backend/marginmark_app.py (adds /health ready)");
    } else {
      for (const [key, ok] of Object.entries(body.ready)) {
        check(ok === true, `API ${key}`, FIX[key] ?? "see backend/marginmark_app.py launch_readiness()");
      }
    }
  } catch (err) {
    check(false, `${base}/health reachable`, `fix the URL or deploy the API (${err instanceof Error ? err.message : String(err)})`);
  }
}

// --- Report -----------------------------------------------------------------
let blocking = 0;
for (const row of results) {
  const tag = row.ok ? "ok  " : row.level === "warn" ? "warn" : "FIX ";
  if (!row.ok && row.level !== "warn") blocking += 1;
  console.log(`${tag} ${row.label}${row.ok ? "" : `\n     → ${row.fix}`}`);
}
console.log(blocking ? `\n${blocking} thing(s) block launch.` : "\nReady to launch.");
process.exit(blocking ? 1 : 0);
