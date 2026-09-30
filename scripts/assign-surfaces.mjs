/**
 * Drop F-CATALOG, split any feature with more than 10 surfaces, and attach
 * reachable components plus service-worker messages to E-* features.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const map = JSON.parse(readFileSync(path.join(root, "qa/feature-map.json"), "utf8"));
const e2e = JSON.parse(readFileSync(path.join(root, "qa/e2e-features.json"), "utf8"));

const features = [];
for (const feature of map.features) {
  if (feature.id === "F-CATALOG" || String(feature.id).startsWith("E-")) continue;
  const surfaces = feature.surfaces ?? [];
  if (surfaces.length <= 10) {
    features.push(feature);
    continue;
  }
  for (let i = 0; i < surfaces.length; i += 10) {
    const part = Math.floor(i / 10) + 1;
    features.push({
      ...feature,
      id: `${feature.id}-${part}`,
      name: `${feature.name} ${part}`,
      surfaces: surfaces.slice(i, i + 10),
    });
  }
}

const components = [
  ["E-OVL-READ", ["src/content/components/ProfitOverlay.tsx", "src/content/components/OverlayHeader.tsx", "src/content/components/MarkLogo.tsx", "src/content/mountOverlay.tsx"]],
  ["E-OVL-STRIP", ["src/content/components/OverlayAuth.tsx", "src/popup/LegalFooter.tsx"]],
  ["E-OVL-GUARD-CHIP", ["src/content/components/PriceGuardBanner.tsx", "src/content/components/MetricTip.tsx"]],
  ["E-COST-ENTRY", ["src/content/components/CostInputs.tsx", "src/content/components/CostWaterfall.tsx"]],
  ["E-COST-PROLOCK", ["src/ui/ProLock.tsx", "src/ui/upgrade.tsx"]],
  ["E-COST-HELP", ["src/content/components/FieldHelp.tsx"]],
  ["E-LAB-NUMBERS", ["src/content/components/ProfitBoard.tsx", "src/dashboard/SkuDashboard.tsx", "src/content/components/FirstRunChecklist.tsx"]],
  ["E-LAB-STATEMENT", ["src/dashboard/StatementImport.tsx"]],
  ["E-LAB-SYNC", ["src/popup/AutoSyncBar.tsx"]],
  ["E-BILL-PRICES", ["src/ui/PlanPicker.tsx"]],
  ["E-BILL-PRO-LIVE", ["src/content/components/CommissionCard.tsx", "src/content/components/AdsCard.tsx"]],
  ["E-AUTH-SIGNUP", ["src/popup/LoginScreen.tsx", "src/ui/PasswordField.tsx", "src/popup/AccountPanel.tsx"]],
  ["E-AUTH-SOCIAL-BUTTONS", ["src/popup/SocialAuthButtons.tsx", "src/popup/SocialBrandIcons.tsx"]],
  ["E-SET-PRESETS", ["src/popup/SettingsPanel.tsx", "src/popup/SelfTestPanel.tsx"]],
  ["E-SUP-SUBMIT", ["src/popup/SupportCenter.tsx"]],
  ["E-ACC-NAME", ["src/popup/ProfilePanel.tsx"]],
  ["E-FLAG-whatIf", ["src/content/components/WhatIfPanel.tsx", "src/content/components/ExternalPriceCompare.tsx"]],
  ["E-VIS-SNAPSHOTS", ["src/ui/primitives.tsx", "src/ui/icons.tsx", "src/content/components/SpsBadge.tsx"]],
];

const messages = [
  ["E-INST-LOAD", ["GET_SETTINGS", "AUTH_STATUS"]],
  ["E-SET-PERSIST", ["SAVE_SETTINGS", "GET_LOCAL", "SET_LOCAL"]],
  ["E-COST-ENTRY", ["SAVE_SKU", "GET_SKUS", "REMOVE_LOCAL"]],
  ["E-LAB-SYNC", ["SYNC_SKUS", "REMOVE_SKUS", "REQUEST_SKU_SYNC", "SYNC_ACTIVE_TAB"]],
  ["E-OVL-READ", ["SHOW_INPAGE_PANEL", "TOGGLE_INPAGE_PANEL", "TST_PING", "REFRESH_OVERLAY", "STORAGE_PUSH"]],
  ["E-BILL-PRO-LIVE", ["GET_TIER"]],
  ["E-AUTH-SIGNUP", ["AUTH_REGISTER", "AUTH_LOGIN", "AUTH_FORGOT"]],
  ["E-AUTH-LOGOUT", ["LOGOUT"]],
  ["E-AUTH-OAUTH-TICKET", ["CLAIM_OAUTH_TICKET", "OAUTH_FINISHED", "START_OAUTH", "SCAN_OAUTH"]],
  ["E-SUP-SUBMIT", ["API_CALL", "OPEN_TAB", "OPEN_EXTERNAL_COMPARE", "GET_SPS"]],
];

const byId = new Map(e2e.map((feature) => [feature.id, { id: feature.id, name: feature.name, surfaces: [], tests: [`@${feature.id}`] }]));
for (const [id, files] of components) {
  const feature = byId.get(id);
  for (const file of files) feature.surfaces.push(`component:${file}`);
}
for (const [id, names] of messages) {
  const feature = byId.get(id);
  for (const name of names) feature.surfaces.push(`msg:${name}`);
}
for (const feature of byId.values()) {
  if (feature.surfaces.length > 10) throw new Error(`${feature.id} has ${feature.surfaces.length} surfaces`);
  features.push(feature);
}

writeFileSync(
  path.join(root, "qa/feature-map.json"),
  JSON.stringify({ features, deadCode: map.deadCode }, null, 2),
);
console.log(`features ${features.length}`);
