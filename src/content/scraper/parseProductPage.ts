import { SELECTORS, withRemote } from "./domSelectors";
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
  skuIds?: string[];
  title: string;
  listPrice: number;
  /** Buyer price after a discount or promotion. Retail stays in listPrice. */
  promoPrice?: number | null;
  listPriceOriginal?: number | null;
  unitsSold: number;
  scrapeStatus: ScrapeStatus;
  /** @deprecated use scrapeStatus === 'complete' */
  scrapeComplete: boolean;
  hints: {
    hasTitle: boolean;
    hasPriceField: boolean;
    onProductEditor: boolean;
    /** The document is an error page, not a product. */
    pageMissing?: boolean;
  };
};

/** A short 404 body. A real Seller Center page is much longer than this. */
export function isMissingPage(doc: Document): boolean {
  const title = doc.title.replace(/\s+/g, " ").trim().toLowerCase();
  if (title === "404" || title.startsWith("404 ") || title.startsWith("404|")) return true;
  const text = (doc.body?.innerText ?? doc.body?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (text.length > 800) return false;
  return (
    /\b404\b/.test(text) &&
    /not found|could not be found|does not exist|doesn't exist/.test(text)
  );
}

const PRODUCT_NAME = /^product\s*name\*?$/i;
const RETAIL_PRICE =
  /^\*?\s*(retail|sale|list|unit)?\s*price\*?$|^price\s*\(/i;
const UNITS_SOLD = /units?\s*sold|total\s*sales|items?\s*sold|sold\s*quantity/i;

export function parseMoney(raw: string): number {
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function headerText(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

function tableCell(doc: Document, header: RegExp): string {
  const headers = [...doc.querySelectorAll("th")];
  const index = headers.findIndex((th) => header.test(headerText(th).replace(/^\*\s*/, "")));
  if (index < 0) return "";
  const cell = doc.querySelector("tbody tr")?.querySelectorAll("td")[index];
  return headerText(cell ?? doc.createElement("td"));
}

function discountFraction(raw: string): number | null {
  const match = raw.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const pct = Number(match[1]);
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return null;
  return pct / 100;
}

export function sellingPrice(product: {
  listPrice: number;
  promoPrice?: number | null;
}): number {
  return product.promoPrice != null && product.promoPrice > 0
    ? product.promoPrice
    : product.listPrice;
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

function findRetailPriceInTable(doc: Document): FormControl | null {
  const headers = [...doc.querySelectorAll("th")];
  const index = headers.findIndex((th) =>
    /^\*?\s*retail\s*price\*?$/i.test((th.textContent ?? "").replace(/\s+/g, " ").trim()),
  );
  if (index < 0) return null;
  const cell = doc.querySelector("tbody tr")?.querySelectorAll("td")[index];
  const input = cell?.querySelector("input");
  return input instanceof HTMLInputElement ? input : null;
}

function findDisplayedProductTitle(doc: Document): string | null {
  const named = doc.querySelector("[class*='productName']");
  const text = named?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  if (text.length >= 8 && text.length <= 200) return text;
  return null;
}

function findPriceControl(doc: Document): FormControl | null {
  return (
    findRetailPriceInTable(doc) ??
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
  if (isMissingPage(doc)) {
    return {
      skuId: "",
      title: "Untitled product",
      listPrice: 0,
      unitsSold: 0,
      scrapeStatus: "manual",
      scrapeComplete: false,
      hints: {
        hasTitle: false,
        hasPriceField: false,
        onProductEditor: false,
        pageMissing: true,
      },
    };
  }

  const onProductEditor = isProductEditorPage(doc, href);

  const titleControl = findTitleControl(doc);
  const titleFromField = readControl(titleControl);
  const onList = /product\/manage|manage-product|\/product\/list/.test(href);
  const titleFromHeader = onList ? null : readPageHeaderTitle(doc);
  const titleFromSelectors = firstText(withRemote("productTitle", SELECTORS.productTitle), doc);
  const title =
    titleFromField ||
    titleFromHeader ||
    findDisplayedProductTitle(doc) ||
    titleFromSelectors ||
    "Untitled product";

  const priceControl = findPriceControl(doc);
  const priceFromField = readControl(priceControl);
  let priceFromSelectors = "";
  for (const sel of withRemote("listPrice", SELECTORS.listPrice)) {
    const el = doc.querySelector(sel);
    if (el instanceof HTMLInputElement && el.value.trim()) {
      priceFromSelectors = el.value;
      break;
    }
    const text = el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (text && /\$?\d/.test(text)) {
      priceFromSelectors = text;
      break;
    }
  }
  const listPrice = parseMoney(priceFromField || priceFromSelectors || "0");
  const promoLabeled = parseMoney(
    (doc.body?.innerText ?? "").match(
      /(?:Promotion price|Promo price)\s*:?\s*\$?\s*(\d+(?:\.\d{1,2})?)/i,
    )?.[1] ?? "",
  );
  const discount = discountFraction(tableCell(doc, /^discount$/i));
  let promoPrice: number | null = null;
  let listPriceOriginal: number | null = null;
  if (promoLabeled > 0) {
    promoPrice = promoLabeled;
    listPriceOriginal = listPrice > 0 ? listPrice : null;
  } else if (discount != null && listPrice > 0) {
    promoPrice = Math.round(listPrice * (1 - discount) * 100) / 100;
    listPriceOriginal = listPrice;
  }

  const soldControl =
    findControlByLabel(UNITS_SOLD, doc) ??
    findByAriaLabel(/units?\s*sold|sold/i, doc);
  const soldFromField = readControl(soldControl);
  const soldRaw =
    soldFromField ||
    firstText(withRemote("unitsSold", SELECTORS.unitsSold), doc) ||
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
    skuIds: extractVariantSkuIds(doc.body?.innerText ?? doc.body?.textContent ?? "", skuId),
    title,
    listPrice,
    promoPrice,
    listPriceOriginal,
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

const VARIANT_ID_RE = /(?:SKU\s*ID|Seller\s*SKU|Variant\s*ID)\s*[:#]?\s*([A-Za-z0-9_-]{4,64})/gi;

/** Variant ids printed on the edit page. Statements sometimes use these instead of the product id. */
export function extractVariantSkuIds(text: string, productId: string): string[] {
  VARIANT_ID_RE.lastIndex = 0;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(VARIANT_ID_RE)) {
    const id = match[1];
    if (!id || id === productId || seen.has(id)) continue;
    seen.add(id);
    if (ids.length >= 50) break;
    ids.push(id);
  }
  return ids;
}

function hashString(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h << 5) - h + value.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}
