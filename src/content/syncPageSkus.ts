import { computeProfit } from "../lib/profit";
import { effectiveShippingPerUnit } from "../lib/shippingCost";
import { sendMessage } from "../lib/messages";
import type { Settings } from "../types/settings";
import type { SkuRecord } from "../types/sku";
import { parseProductPage } from "./scraper/parseProductPage";
import {
  isProductListPage,
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

function profitUnits(unitsSold: number): number {
  return unitsSold > 0 ? unitsSold : 1;
}

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
  const ship = effectiveShippingPerUnit(
    shipRaw,
    settings.shippingPassedToBuyer ?? true,
  );
  const ads = existing?.adsPerUnit ?? settings.defaultAdsPerUnit;

  const profit = computeProfit({
    listPrice,
    unitsSold: profitUnits(unitsSold),
    cogsPerUnit: cogs,
    shippingOut: ship,
    adsPerUnit: ads,
    platformFeePct: settings.platformFeePct,
    paymentFeePct: settings.paymentFeePct,
    paymentFixed: settings.paymentFixed,
    refundRatePct: settings.refundRatePct,
    salesTaxPct: settings.salesTaxPct,
    packagingPerUnit: settings.packagingPerUnit,
  });

  return {
    skuId: item.skuId,
    title: item.title || existing?.title || "Product",
    listPrice,
    cogsPerUnit: cogs,
    shippingOut: ship,
    adsPerUnit: ads,
    unitsSold,
    refundRatePct: settings.refundRatePct,
    netMarginPct: profit.netMarginPct,
    netProfit: profit.netProfit,
    sourceUrl: window.location.href,
    updatedAt: new Date().toISOString(),
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
