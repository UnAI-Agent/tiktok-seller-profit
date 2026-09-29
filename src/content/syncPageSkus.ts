import { computeProfit } from "../lib/profit";
import { profitInputFor } from "../lib/skuEconomics";
import { sendMessage } from "../lib/messages";
import type { Settings } from "../types/settings";
import type { SkuRecord } from "../types/sku";
import { parseProductPage } from "./scraper/parseProductPage";
import {
  isProductListPage,
  looksLikeProductTitle,
  parseProductListPage,
  type ScrapedListItem,
} from "./scraper/parseProductListPage";

export type SyncSource = "list" | "editor" | "none";

export type SyncResult = {
  found: number;
  saved: number;
  skipped: number;
  source: SyncSource;
};

function toSkuRecord(
  item: ScrapedListItem,
  settings: Settings,
  existing?: SkuRecord,
): SkuRecord {
  const listPrice = item.listPrice || existing?.listPrice || 0;
  const unitsSold =
    item.unitsSold > 0
      ? item.unitsSold
      : existing?.unitsSold && existing.unitsSold > 0
        ? existing.unitsSold
        : 0;
  const cogs = existing?.cogsPerUnit ?? settings.defaultCogs;
  const shipRaw = existing?.shippingOut ?? settings.defaultShippingOut;
  const ads = existing?.adsPerUnit ?? settings.defaultAdsPerUnit;
  const draft: SkuRecord = {
    skuId: item.skuId,
    title: item.title || existing?.title || "Product",
    listPrice,
    listPriceOriginal: item.listPriceOriginal ?? existing?.listPriceOriginal ?? null,
    listingStatus: item.status ?? existing?.listingStatus ?? null,
    stock: item.stock ?? existing?.stock ?? null,
    cogsPerUnit: cogs,
    shippingOut: shipRaw,
    adsPerUnit: ads,
    unitsSold,
    refundRatePct: settings.refundRatePct,
    netMarginPct: existing?.netMarginPct ?? 0,
    netProfit: existing?.netProfit ?? 0,
    sourceUrl: window.location.href,
    updatedAt: new Date().toISOString(),
    packagingPerUnit: existing?.packagingPerUnit ?? settings.packagingPerUnit,
    affiliatePct: existing?.affiliatePct ?? settings.affiliateCommissionPct,
    affiliateSharePct: existing?.affiliateSharePct ?? settings.affiliateSharePct,
    skuIds: item.skuIds && item.skuIds.length > 0 ? item.skuIds : existing?.skuIds,
    salesPeriod: existing?.salesPeriod,
    costSource: existing?.costSource ?? "default",
    samplesSent: existing?.samplesSent ?? 0,
    sampleUnitCost: existing?.sampleUnitCost,
    actualFees: existing?.actualFees,
  };
  const profit = computeProfit(profitInputFor(draft, settings));
  return {
    ...draft,
    netMarginPct: profit.netMarginPct ?? 0,
    netProfit: profit.netProfit,
  };
}

/** Try list table first, then single product editor fields. */
export function collectSkuCandidates(
  doc: Document = document,
  href: string = window.location.href,
): { items: ScrapedListItem[]; source: SyncSource } {
  const listItems = parseProductListPage(doc, href);
  if (listItems.length > 0) {
    return { items: listItems, source: "list" };
  }

  const single = parseProductPage();
  const hasTitle =
    single.title !== "Untitled product" && single.title.length >= 3;
  if (hasTitle || single.listPrice > 0) {
    return {
      items: [
        {
          skuId: single.skuId,
          skuIds: single.skuIds,
          title: single.title,
          listPrice: single.listPrice,
          unitsSold: single.unitsSold,
        },
      ],
      source: "editor",
    };
  }

  return { items: [], source: "none" };
}

let lastSyncKey = "";

export async function autoSyncSkusFromPage(
  force = false,
): Promise<SyncResult> {
  const [settingsRes, skusRes] = await Promise.all([
    sendMessage({ type: "GET_SETTINGS" }),
    sendMessage({ type: "GET_SKUS" }),
  ]);
  if (!settingsRes.ok || !settingsRes.settings) {
    return { found: 0, saved: 0, skipped: 0, source: "none" };
  }
  const settings = settingsRes.settings;
  const existingById = new Map(
    (skusRes.ok && skusRes.skus ? skusRes.skus : []).map((s) => [s.skuId, s]),
  );

  const { items, source } = collectSkuCandidates();
  if (items.length === 0) {
    return { found: 0, saved: 0, skipped: 0, source: "none" };
  }

  const syncKey = items
    .map(
      (i) =>
        `${i.skuId}:${i.listPrice}:${i.title}:${i.unitsSold}`,
    )
    .join("|");
  if (!force && syncKey === lastSyncKey) {
    return { found: items.length, saved: 0, skipped: 0, source };
  }
  lastSyncKey = syncKey;

  const skus = items.map((item) =>
    toSkuRecord(item, settings, existingById.get(item.skuId)),
  );
  const res = await sendMessage({ type: "SYNC_SKUS", skus });
  const saved = res.ok ? (res.saved ?? skus.length) : 0;
  const skipped = res.ok ? (res.skipped ?? 0) : 0;

  const incomingIds = new Set(skus.map((s) => s.skuId));
  const junkIds = [...existingById.values()]
    .filter(
      (s) => !incomingIds.has(s.skuId) && !looksLikeProductTitle(s.title),
    )
    .map((s) => s.skuId);
  if (junkIds.length > 0) {
    await sendMessage({ type: "REMOVE_SKUS", skuIds: junkIds });
  }

  return { found: items.length, saved, skipped, source };
}

export function watchSellerPagesForAutoSync() {
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const href = window.location.href;
      const onBulk = isProductListPage(document, href);
      const onEditor = /product|listing|catalog|item/i.test(href);
      if (!onBulk && !onEditor) return;
      void autoSyncSkusFromPage(false);
    }, 800);
  }

  schedule();
  if (document.body) {
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  setInterval(schedule, 8000);
}

export function pageSupportsBulkImport(href: string, doc: Document): boolean {
  return isProductListPage(doc, href);
}
