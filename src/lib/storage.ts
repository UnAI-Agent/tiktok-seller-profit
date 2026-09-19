import { FREE_SKU_LIMIT } from "../config";
import { DEFAULT_SETTINGS, type Settings } from "../types/settings";
import type { SkuRecord, SkuStore } from "../types/sku";
import type { SpsSnapshot } from "./sps";
import { computeProxySps } from "./sps";
import { isValidSku } from "./skuValidate";

export { FREE_SKU_LIMIT };

const KEYS = {
  settings: "settings",
  skus: "skus",
  sps: "sps",
  subscription: "subscription",
} as const;

export async function getSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(KEYS.settings);
  const raw = data[KEYS.settings] as Settings | undefined;
  return { ...DEFAULT_SETTINGS, ...raw };
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
  tier: "free" | "pro" = "free",
): Promise<{ ok: true } | { ok: false; reason: "limit" | "invalid" }> {
  if (!isValidSku(sku)) {
    return { ok: false, reason: "invalid" };
  }
  const data = await chrome.storage.local.get(KEYS.skus);
  const store = { ...((data[KEYS.skus] ?? {}) as SkuStore) };
  const isNew = !store[sku.skuId];

  if (tier === "free" && isNew && Object.keys(store).length >= FREE_SKU_LIMIT) {
    return { ok: false, reason: "limit" };
  }

  store[sku.skuId] = sku;
  await chrome.storage.local.set({ [KEYS.skus]: store });
  return { ok: true };
}

export async function syncSkus(
  incoming: SkuRecord[],
  tier: "free" | "pro" = "free",
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
    const isNew = !store[sku.skuId];
    if (tier === "free" && isNew && Object.keys(store).length >= FREE_SKU_LIMIT) {
      skipped += 1;
      continue;
    }
    store[sku.skuId] = { ...store[sku.skuId], ...sku, updatedAt: new Date().toISOString() };
    saved += 1;
  }

  await chrome.storage.local.set({ [KEYS.skus]: store });
  return { ok: true, saved, skipped };
}

export async function getSps(): Promise<SpsSnapshot> {
  const data = await chrome.storage.local.get(KEYS.sps);
  const existing = data[KEYS.sps] as SpsSnapshot | undefined;
  if (existing) return existing;

  const fresh: SpsSnapshot = {
    score: computeProxySps(2, 1, 4.5),
    source: "proxy",
    lateShipmentRatePct: 2,
    cancellationRatePct: 1,
    avgRating: 4.5,
    updatedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [KEYS.sps]: fresh });
  return fresh;
}

export async function touchSps(): Promise<SpsSnapshot> {
  const sps = await getSps();
  const updated = { ...sps, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [KEYS.sps]: updated });
  return updated;
}
