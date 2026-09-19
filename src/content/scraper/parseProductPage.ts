import { SELECTORS } from "./domSelectors";
import { extractUnitsSoldFromText } from "./extractUnitsSold";
import {
  findByAriaLabel,
  findControlByLabel,
  findLargestProductNameTextarea,
  readPageHeaderTitle,
  type FormControl,
} from "./findLabeledField";

export type ScrapeStatus = "complete" | "partial" | "manual";

export type ScrapedProduct = {
  skuId: string;
  title: string;
  listPrice: number;
  unitsSold: number;
  scrapeStatus: ScrapeStatus;
  /** @deprecated use scrapeStatus === 'complete' */
  scrapeComplete: boolean;
  hints: {
    hasTitle: boolean;
    hasPriceField: boolean;
    onProductEditor: boolean;
  };
};

const PRODUCT_NAME = /^product\s*name\*?$/i;
const RETAIL_PRICE =
  /^(retail|sale|list|unit)?\s*price\*?$|^price\s*\(/i;
const UNITS_SOLD = /units?\s*sold|total\s*sales|items?\s*sold|sold\s*quantity/i;

export function parseMoney(raw: string): number {
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function firstText(
  selectors: readonly string[],
  doc: Document,
): string | null {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return null;
}

function readControl(el: FormControl | null): string {
  if (!el) return "";
  return el.value.trim();
}

function findPriceByNearbyText(doc: Document): FormControl | null {
  for (const input of doc.querySelectorAll("input")) {
    if (input.type === "hidden" || input.type === "checkbox") continue;
    const block = input.closest("div, section, li");
    const context = (block?.textContent ?? "").slice(0, 120);
    if (!/price/i.test(context)) continue;
    if (/compare|was|msrp|original/i.test(context) && !/retail|sale|your/i.test(context))
      continue;
    return input;
  }
  return null;
}

function findPriceControl(doc: Document): FormControl | null {
  return (
    findControlByLabel(RETAIL_PRICE, doc) ??
    findByAriaLabel(/price/i, doc) ??
    findControlByLabel(/^your\s*price/i, doc) ??
    findPriceByNearbyText(doc)
  );
}

function findTitleControl(doc: Document): FormControl | null {
  return (
    findControlByLabel(PRODUCT_NAME, doc) ??
    findByAriaLabel(/product\s*name/i, doc) ??
    findLargestProductNameTextarea(doc)
  );
}

function isProductEditorPage(doc: Document, href: string): boolean {
  let path = "/";
  try {
    path = new URL(href).pathname.toLowerCase();
  } catch {
    path = href.toLowerCase();
  }
  if (/product|listing|catalog|item/.test(path)) return true;
  return (
    findTitleControl(doc) !== null ||
    doc.body?.textContent?.includes("Product name") === true
  );
}

/** Testable entry: pass DOM + URL from fixtures or self-test. */
export function parseProductFromDocument(
  doc: Document,
  href: string,
): ScrapedProduct {
  const onProductEditor = isProductEditorPage(doc, href);

  const titleControl = findTitleControl(doc);
  const titleFromField = readControl(titleControl);
  const titleFromHeader = readPageHeaderTitle(doc);
  const titleFromSelectors = firstText(SELECTORS.productTitle, doc);
  const title =
    titleFromField ||
    titleFromHeader ||
    titleFromSelectors ||
    "Untitled product";

  const priceControl = findPriceControl(doc);
  const priceFromField = readControl(priceControl);
  let priceFromSelectors = "";
  for (const sel of SELECTORS.listPrice) {
    const el = doc.querySelector(sel);
    if (el instanceof HTMLInputElement && el.value) {
      priceFromSelectors = el.value;
      break;
    }
  }
  const listPrice = parseMoney(priceFromField || priceFromSelectors || "0");

  const soldControl =
    findControlByLabel(UNITS_SOLD, doc) ??
    findByAriaLabel(/units?\s*sold|sold/i, doc);
  const soldFromField = readControl(soldControl);
  const soldRaw =
    soldFromField ||
    firstText(SELECTORS.unitsSold, doc) ||
    "";
  let unitsSold = Math.max(0, Math.floor(parseMoney(soldRaw)));
  if (unitsSold <= 0 && soldRaw) {
    unitsSold = extractUnitsSoldFromText(soldRaw);
  }
  if (unitsSold <= 0) {
    unitsSold = extractUnitsSoldFromText(doc.body?.innerText ?? "");
  }

  let pathname = "/";
  try {
    pathname = new URL(href).pathname;
  } catch {
    pathname = href;
  }
  let search = "";
  try {
    search = new URL(href).search;
  } catch {
    /* ignore */
  }

  const pathMatch = pathname.match(
    /\/product\/(?:edit\/)?([a-zA-Z0-9_-]+)/,
  );
  const skuId =
    new URLSearchParams(search).get("product_id") ??
    pathMatch?.[1] ??
    `sku-${hashString(title)}`;

  const hasTitle = title !== "Untitled product" && title.length >= 3;
  const hasPriceField = priceControl !== null;

  let scrapeStatus: ScrapeStatus = "manual";
  if (listPrice > 0 && hasTitle) scrapeStatus = "complete";
  else if (hasTitle || listPrice > 0 || (onProductEditor && hasPriceField)) {
    scrapeStatus = "partial";
  }

  return {
    skuId,
    title,
    listPrice,
    unitsSold,
    scrapeStatus,
    scrapeComplete: listPrice > 0,
    hints: { hasTitle, hasPriceField, onProductEditor },
  };
}

export function parseProductFromHtml(html: string, href: string): ScrapedProduct {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return parseProductFromDocument(doc, href);
}

export function parseProductPage(): ScrapedProduct {
  return parseProductFromDocument(document, window.location.href);
}

function hashString(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h << 5) - h + value.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}
