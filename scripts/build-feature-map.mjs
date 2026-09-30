import { readFileSync, writeFileSync } from "node:fs";

const { surfaces, unreachable } = JSON.parse(readFileSync("qa/report/surfaces.json", "utf8"));
const dead = new Set(unreachable);
const buckets = [
  ["F-OAUTH-FLOW", "OAuth", (s) => /oauth/i.test(s)],
  ["F-BILL-LIFE", "Billing lifecycle", (s) => s.includes("/billing/")],
  ["F-ADMIN-DB", "Admin and ops", (s) => s.includes("/admin/") || s === "route:GET /ops" || s.startsWith("route:GET /static/") || s === "route:GET /config/remote" || s === "route:GET /health"],
  ["F-INSIGHT-SUMMARY", "Insights and trends", (s) => s.includes("/insights/") || s.includes("/trends") || s.startsWith("flag:ai") || s.startsWith("flag:trends")],
  ["F-TELEM-SCRUB", "Telemetry", (s) => s.startsWith("telemetry:") || s.includes("/telemetry/")],
  ["F-SUPPORT", "Help and support", (s) => /support|FieldHelp|reportProblem|ReportProblem/i.test(s)],
  ["F-MAIL-VERIFY", "Account email", (s) => s.includes("/auth/")],
  ["F-TIER-READ", "Plan tier in the overlay", (s) => /subscription|ProfitOverlay|PlanPicker|ProLock|tier:|msg:GET_TIER|msg:AUTH_STATUS/.test(s)],
  ["F-PROFIT", "Profit engine and overlay math", (s) => /profit|Cost|Commission|AdsCard|diagnose|skuEconomics|shipping|refund|Waterfall|ProfitBoard|priceGuard|promoChip/i.test(s)],
  ["F-SCRAPE", "Page scrape", (s) => s.includes("/scraper/") || s.includes("syncPageSkus")],
  ["F-SETTINGS", "Settings", (s) => s.startsWith("setting:") || s.includes("SettingsPanel") || s.includes("storage.ts")],
  ["F-BUILD-E2E", "Extension build", (s) => s.includes("mountOverlay") || s.includes("extManifestEnv") || s === "flag:overlay" || s === "component:src/content/index.ts" || s.includes("content/index.ts")],
  ["F-MSG", "Service worker messages", (s) => s.startsWith("msg:")],
];

const features = buckets.map(([id, name]) => ({ id, name, surfaces: [], tests: [`@${id}`] }));
const claimed = new Set();
for (const surface of surfaces) {
  if (dead.has(surface)) continue;
  const feature = features.find((item, index) => buckets[index][2](surface) && !claimed.has(surface));
  if (!feature) continue;
  feature.surfaces.push(surface);
  claimed.add(surface);
}
const rest = surfaces.filter((surface) => !dead.has(surface) && !claimed.has(surface));
features.push({ id: "F-CATALOG", name: "Remaining client modules", surfaces: rest, tests: ["@F-CATALOG"] });
const doc = {
  features: features.filter((feature) => feature.surfaces.length),
  deadCode: [...dead].sort(),
};
writeFileSync("qa/feature-map.json", JSON.stringify(doc, null, 2));
const counts = doc.features.map((feature) => `${feature.id} ${feature.surfaces.length}`).join("\n");
console.log(counts);
console.log("rest", rest.length);
console.log("dead", doc.deadCode.length);
