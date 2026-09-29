import { FEE_PRESETS, FREE_SKU_LIMIT, inferFeePreset } from "../config";
import { canAddSku, savedCostCount } from "./skuLimit";
import { DEFAULT_SETTINGS, SETTINGS_VERSION, TELEMETRY_CONSENT_VERSION, type Settings, type TelemetryConsent } from "../types/settings";
import type { SkuRecord, SkuStore } from "../types/sku";
import type { SpsSnapshot } from "./sps";
import { isValidSku } from "./skuValidate";

export { FREE_SKU_LIMIT };

const KEYS = {
  settings: "settings",
  skus: "skus",
  sps: "sps",
  subscription: "subscription",
} as const;

function explicitFees(src: Partial<Settings>): {
  platformFeePct: number;
  paymentFeePct: number;
  paymentFixed: number;
} | null {
  if (typeof src.platformFeePct !== "number" || !Number.isFinite(src.platformFeePct)) return null;
  if (typeof src.paymentFeePct !== "number" || !Number.isFinite(src.paymentFeePct)) return null;
  if (typeof src.paymentFixed !== "number" || !Number.isFinite(src.paymentFixed)) return null;
  return {
    platformFeePct: src.platformFeePct,
    paymentFeePct: src.paymentFeePct,
    paymentFixed: src.paymentFixed,
  };
}

function readConsent(src: Partial<Settings>): TelemetryConsent {
  const raw = src.telemetryConsent;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS.telemetryConsent };
  const granted = raw.granted === true && raw.version === TELEMETRY_CONSENT_VERSION;
  return {
    granted,
    version: TELEMETRY_CONSENT_VERSION,
    at: granted && typeof raw.at === "string" ? raw.at : null,
  };
}

/** Only the untouched 8% / $0 default moves to the 6% preset. Edited fees stay. */
export function migrateSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_SETTINGS };
  const src = raw as Partial<Settings>;
  const merged: Settings = { ...DEFAULT_SETTINGS, version: SETTINGS_VERSION };
  merged.telemetryConsent = readConsent(src);
  const numericKeys = [
    "platformFeePct",
    "paymentFeePct",
    "paymentFixed",
    "defaultCogs",
    "defaultShippingOut",
    "defaultAdsPerUnit",
    "refundRatePct",
    "salesTaxPct",
    "packagingPerUnit",
    "affiliateCommissionPct",
    "affiliateSharePct",
    "targetMarginPct",
  ] as const;
  for (const key of numericKeys) {
    const value = src[key];
    if (typeof value === "number" && Number.isFinite(value)) merged[key] = value;
  }
  if (typeof src.shippingPassedToBuyer === "boolean") {
    merged.shippingPassedToBuyer = src.shippingPassedToBuyer;
  }
  if (typeof src.overlayEnabled === "boolean") merged.overlayEnabled = src.overlayEnabled;
  if (typeof src.overlayCollapsed === "boolean") merged.overlayCollapsed = src.overlayCollapsed;
  if (src.overlayPosition === "bottom-left" || src.overlayPosition === "bottom-right") {
    merged.overlayPosition = src.overlayPosition;
  }
  const storedVersion = typeof src.version === "number" ? src.version : 0;
  const storedFees = explicitFees(src);
  const untouchedOldDefault =
    storedVersion < SETTINGS_VERSION &&
    storedFees !== null &&
    storedFees.platformFeePct === 8 &&
    storedFees.paymentFeePct === 0 &&
    storedFees.paymentFixed === 0 &&
    (src.feePreset === "us-standard" || src.feePreset == null);
  if (untouchedOldDefault) {
    merged.platformFeePct = FEE_PRESETS["us-standard"].platformFeePct;
    merged.paymentFeePct = FEE_PRESETS["us-standard"].paymentFeePct;
    merged.paymentFixed = FEE_PRESETS["us-standard"].paymentFixed;
    merged.feePreset = "us-standard";
  } else if (src.feePreset === "custom") {
    merged.feePreset = "custom";
  } else if (
    src.feePreset === "us-standard" ||
    src.feePreset === "us-jewelry" ||
    src.feePreset === "us-legacy"
  ) {
    const preset = FEE_PRESETS[src.feePreset];
    if (
      merged.platformFeePct === preset.platformFeePct &&
      merged.paymentFeePct === preset.paymentFeePct &&
      merged.paymentFixed === preset.paymentFixed
    ) {
      merged.feePreset = src.feePreset;
    } else {
      merged.feePreset = inferFeePreset(merged);
    }
  } else {
    merged.feePreset = inferFeePreset(merged);
  }
  return merged;
}

export async function getSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(KEYS.settings);
  const raw = data[KEYS.settings];
  const next = migrateSettings(raw);
  const version =
    raw && typeof raw === "object" ? (raw as { version?: number }).version : 0;
  if (version !== SETTINGS_VERSION) {
    await chrome.storage.local.set({ [KEYS.settings]: next });
  }
  return next;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEYS.settings]: settings });
}

export async function getSkus(): Promise<SkuRecord[]> {
  const data = await chrome.storage.local.get(KEYS.skus);
  const store = (data[KEYS.skus] ?? {}) as SkuStore;
  return Object.values(store)
    .filter(isValidSku)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveSku(
  sku: SkuRecord,
  tier: "free" | "pro" | "diamond" = "free",
): Promise<{ ok: true } | { ok: false; reason: "limit" | "invalid" }> {
  if (!isValidSku(sku)) {
    return { ok: false, reason: "invalid" };
  }
  const data = await chrome.storage.local.get(KEYS.skus);
  const store = { ...((data[KEYS.skus] ?? {}) as SkuStore) };
  const addingCost = (sku.costSource ?? "default") !== "default";
  const alreadyHasCost = (store[sku.skuId]?.costSource ?? "default") !== "default";
  const isPro = tier !== "free";

  if (!canAddSku(savedCostCount(Object.values(store)), isPro, addingCost && !alreadyHasCost)) {
    return { ok: false, reason: "limit" };
  }

  store[sku.skuId] = sku;
  await chrome.storage.local.set({ [KEYS.skus]: store });
  return { ok: true };
}

export async function syncSkus(
  incoming: SkuRecord[],
  tier: "free" | "pro" | "diamond" = "free",
): Promise<{ ok: true; saved: number; skipped: number }> {
  const data = await chrome.storage.local.get(KEYS.skus);
  const store = { ...((data[KEYS.skus] ?? {}) as SkuStore) };
  let saved = 0;
  let skipped = 0;

  for (const sku of incoming) {
    if (!isValidSku(sku)) {
      skipped += 1;
      continue;
    }
    const existing = store[sku.skuId];
    const addingCost = (sku.costSource ?? "default") !== "default";
    const alreadyHasCost = (existing?.costSource ?? "default") !== "default";
    let next: SkuRecord = {
      ...existing,
      ...sku,
      updatedAt: new Date().toISOString(),
    };
    if (!canAddSku(savedCostCount(Object.values(store)), tier !== "free", addingCost && !alreadyHasCost)) {
      next = {
        ...next,
        costSource: existing?.costSource ?? "default",
        cogsPerUnit: existing?.cogsPerUnit ?? 0,
      };
      skipped += 1;
    }
    store[sku.skuId] = next;
    saved += 1;
  }

  await chrome.storage.local.set({ [KEYS.skus]: store });
  return { ok: true, saved, skipped };
}

export async function removeSkuIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const data = await chrome.storage.local.get(KEYS.skus);
  const store = { ...((data[KEYS.skus] ?? {}) as SkuStore) };
  let changed = false;
  for (const id of ids) {
    if (store[id]) {
      delete store[id];
      changed = true;
    }
  }
  if (changed) await chrome.storage.local.set({ [KEYS.skus]: store });
}

/** Only a scraped account-health score is real. Proxy seeds are hidden. */
export async function getSps(): Promise<SpsSnapshot | null> {
  const data = await chrome.storage.local.get(KEYS.sps);
  const existing = data[KEYS.sps] as SpsSnapshot | undefined;
  if (!existing || existing.source !== "native") return null;
  return existing;
}

export async function touchSps(): Promise<SpsSnapshot | null> {
  const sps = await getSps();
  if (!sps) return null;
  const updated = { ...sps, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [KEYS.sps]: updated });
  return updated;
}
