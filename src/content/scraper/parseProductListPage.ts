import { extractUnitsSoldFromText } from "./extractUnitsSold";
import { parseMoney } from "./parseProductPage";

export type ScrapedListItem = {
  skuId: string;
  skuIds?: string[];
  title: string;
  listPrice: number;
  unitsSold: number;
  listPriceOriginal?: number | null;
  promoPrice?: number | null;
  stock?: number | null;
  status?: string | null;
};

const PRODUCT_ID_RE = /\b(\d{12,22})\b/;
const LABELED_ID_RE = /\bID:\s*(\d{12,22})\b/gi;
const MAX_ROW_CHARS = 420;

const CHROME_TITLE = new RegExp(
  [
    "^(all|active|category|status|stock|price|performance|filter|live|draft|deleted",
    "|reviewing|deactivated|good|seller center|manage products|add product|overview",
    "|spotlight|evergreen(?: pro)?|combined listings|bulk actions|recommendations for you",
    "|needs attention|listing quality|sold out|sort by|action|promotion)$",
  ].join(""),
  "i",
);

export function isProductListPage(doc: Document, href: string): boolean {
  const path = href.toLowerCase();
  if (
    /product\/manage|manage-product|products\/manage|\/product\/list|product\/overview/.test(
      path,
    )
  ) {
    return true;
  }
  const body = doc.body?.textContent ?? "";
  return (
    body.includes("Manage products") ||
    body.includes("Product name, ID, or SKU") ||
    body.includes("Bulk actions") ||
    (body.includes("Retail price") && body.includes("Stock")) ||
    (body.includes("Active (") && body.includes("Add product"))
  );
}

export function looksLikeProductTitle(raw: string): boolean {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length < 6 || t.length > 200) return false;
  if (!/[a-z]/i.test(t)) return false;
  if (/\$\s*\d/.test(t)) return false;
  if (/^ID:/i.test(t)) return false;
  if (CHROME_TITLE.test(t)) return false;
  if (/spotlight|evergreen|bulk actions|combined listings|manage products/i.test(t)) {
    return false;
  }
  if (/^([A-Za-z][A-Za-z ]{2,24})\1$/i.test(t.replace(/\s/g, ""))) return false;
  return true;
}

function normalizeTitle(raw: string, skuId?: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  if (skuId) {
    t = t.replace(new RegExp(`ID:\\s*${skuId}`, "i"), " ").replace(skuId, " ");
  }
  t = t.replace(/\bID:\s*\d{12,22}\b/gi, " ").replace(/\s+/g, " ").trim();
  return t.slice(0, 200);
}

function extractPrices(text: string): number[] {
  const prices: number[] = [];
  for (const m of text.matchAll(/\$\s*(\d+(?:\.\d{1,2})?)/g)) {
    const n = parseMoney(m[1] ?? "0");
    if (n > 0) prices.push(n);
  }
  return prices;
}

function extractProductId(text: string): string | null {
  const labeled = text.match(/\bID:\s*(\d{12,22})\b/i);
  if (labeled?.[1]) return labeled[1];
  const m = text.match(PRODUCT_ID_RE);
  return m?.[1] ?? null;
}

function extractUnitsSoldFromRow(text: string): number {
  return extractUnitsSoldFromText(text);
}

function plainText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("svg, style, script").forEach((node) => node.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

function isHugeChrome(text: string): boolean {
  if (text.length > MAX_ROW_CHARS) return true;
  return (
    text.length > 80 &&
    /bulk actions|combined listings|manage products|recommendations for you/i.test(
      text,
    )
  );
}

function smallestElementContaining(doc: Document, needle: string): Element | null {
  let best: Element | null = null;
  let bestLen = Infinity;
  for (const el of doc.querySelectorAll("span, p, div, a, td, li, h3, h4")) {
    const raw = el.textContent ?? "";
    if (!raw.includes(needle)) continue;
    if (raw.length < bestLen) {
      best = el;
      bestLen = raw.length;
    }
  }
  return best;
}

function titleNearId(host: Element, skuId: string): string | null {
  let el: Element | null = host;
  for (let depth = 0; depth < 10 && el; depth += 1) {
    const parentText = el.textContent ?? "";
    if (isHugeChrome(parentText.replace(/\s+/g, " ").trim())) break;

    for (const child of el.querySelectorAll("span, p, div, a")) {
      const raw = (child.textContent ?? "").replace(/\s+/g, " ").trim();
      if (raw.includes(skuId) && raw.length < 40) continue;
      const cleaned = normalizeTitle(raw, skuId);
      if (looksLikeProductTitle(cleaned)) return cleaned;
    }

    const own = normalizeTitle(parentText, skuId);
    if (looksLikeProductTitle(own)) return own;
    el = el.parentElement;
  }
  return null;
}

function rowAround(host: Element): Element {
  let el: Element = host;
  let best = host;
  for (let depth = 0; depth < 10; depth += 1) {
    const parent = el.parentElement;
    if (!parent || parent === host.ownerDocument.body) break;
    const text = plainText(parent);
    if (isHugeChrome(text)) break;
    best = parent;
    if (extractPrices(text).length > 0) return parent;
    el = parent;
  }
  return best;
}

const PROMO_RE =
  /(?:Promotion|Promo price|Promo|Sale price|Discounted price):\s*\$\s*(\d+(?:\.\d{1,2})?)/i;

function struckAmount(row: Element): number | null {
  const node = row.querySelector(
    "s, del, strike, [style*='line-through' i], [class*='line-through' i]",
  );
  if (!node) return null;
  return extractPrices(plainText(node))[0] ?? null;
}

function withPromo(item: ScrapedListItem, text: string, struck: number | null): ScrapedListItem {
  const promoMatch = text.match(PROMO_RE);
  const prices = extractPrices(text);
  const status =
    text.match(/\b(Live|Reviewing|Deactivated|Draft|Deleted)(?![A-Za-z])/i)?.[1] ?? null;
  const stockMatch = text.match(/(\d+)\s*\$/);
  const stock = stockMatch ? Number(stockMatch[1]) : null;
  const promo = promoMatch ? parseMoney(promoMatch[1] ?? "0") : 0;
  if (promo > 0) {
    const original = prices.find((price) => Math.abs(price - promo) > 0.001) ?? struck;
    return {
      ...item,
      listPrice: promo,
      listPriceOriginal: original,
      promoPrice: promo,
      stock,
      status,
    };
  }
  if (struck != null && struck > 0) {
    const buyer = prices.find((price) => Math.abs(price - struck) > 0.001);
    if (buyer != null) {
      return {
        ...item,
        listPrice: buyer,
        listPriceOriginal: struck,
        promoPrice: buyer,
        stock,
        status,
      };
    }
  }
  return { ...item, listPriceOriginal: null, promoPrice: null, stock, status };
}

function itemFromSkuId(doc: Document, skuId: string): ScrapedListItem | null {
  const host = smallestElementContaining(doc, skuId);
  if (!host) return null;
  const title = titleNearId(host, skuId);
  if (!title) return null;
  const row = rowAround(host);
  const rowText = plainText(row);
  const prices = extractPrices(rowText);
  return withPromo(
    {
      skuId,
      title,
      listPrice: prices[0] ?? 0,
      unitsSold: extractUnitsSoldFromRow(rowText),
    },
    rowText,
    struckAmount(row),
  );
}

function collectSkuIds(doc: Document): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const body = doc.body?.innerText ?? doc.body?.textContent ?? "";
  for (const m of body.matchAll(LABELED_ID_RE)) {
    const id = m[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  for (const anchor of doc.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    const id = href.match(/(\d{12,22})/)?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function parseByIdAnchors(doc: Document): ScrapedListItem[] {
  const items: ScrapedListItem[] = [];
  const seen = new Set<string>();
  for (const skuId of collectSkuIds(doc)) {
    const item = itemFromSkuId(doc, skuId);
    if (!item || seen.has(item.skuId)) continue;
    seen.add(item.skuId);
    items.push(item);
  }
  return items;
}

function titleFromRow(row: Element, skuId?: string): string | null {
  const link = row.querySelector("a[href*='product'], a[href*='/product/']");
  const fromLink = normalizeTitle(link?.textContent ?? "", skuId);
  if (looksLikeProductTitle(fromLink)) return fromLink;

  for (const el of row.querySelectorAll("span, p, div, a")) {
    const cleaned = normalizeTitle(el.textContent ?? "", skuId);
    if (!looksLikeProductTitle(cleaned)) continue;
    if (el.querySelector("button")) continue;
    return cleaned;
  }
  return null;
}

function parseTableLikeRows(doc: Document): ScrapedListItem[] {
  const seen = new Set<string>();
  const items: ScrapedListItem[] = [];
  const rowCandidates = doc.querySelectorAll(
    "table tbody tr, [role='row']",
  );

  for (const row of rowCandidates) {
    const text = plainText(row);
    if (text.length < 12 || isHugeChrome(text)) continue;
    const skuId = extractProductId(text);
    if (!skuId) continue;

    const title = titleFromRow(row, skuId);
    if (!title) continue;

    const prices = extractPrices(text);
    if (seen.has(skuId)) continue;
    seen.add(skuId);
    items.push(
      withPromo(
        {
          skuId,
          title,
          listPrice: prices[0] ?? 0,
          unitsSold: extractUnitsSoldFromRow(text),
        },
        text,
        struckAmount(row),
      ),
    );
  }

  return items;
}

function parseByProductLinks(doc: Document): ScrapedListItem[] {
  const seen = new Set<string>();
  const items: ScrapedListItem[] = [];

  for (const anchor of doc.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    const skuId = href.match(/(\d{12,22})/)?.[1];
    if (!skuId || seen.has(skuId)) continue;

    const title =
      normalizeTitle(anchor.textContent ?? "", skuId) ||
      titleNearId(anchor, skuId) ||
      "";
    if (!looksLikeProductTitle(title)) continue;

    let listPrice = 0;
    let container: Element | null = anchor;
    let rowText = "";
    for (let depth = 0; depth < 8 && container; depth += 1) {
      const text = plainText(container);
      if (isHugeChrome(text)) break;
      rowText = text;
      const prices = extractPrices(text);
      if (prices.length > 0) {
        listPrice = prices[0];
        break;
      }
      container = container.parentElement;
    }

    seen.add(skuId);
    items.push(
      withPromo(
        {
          skuId,
          title,
          listPrice,
          unitsSold: extractUnitsSoldFromRow(rowText),
        },
        rowText,
        container ? struckAmount(container) : null,
      ),
    );
  }

  return items;
}

function betterItem(current: ScrapedListItem, next: ScrapedListItem): ScrapedListItem {
  const title =
    looksLikeProductTitle(next.title) &&
    (!looksLikeProductTitle(current.title) || next.title.length > current.title.length)
      ? next.title
      : current.title;
  return {
    ...current,
    title,
    listPrice:
      next.promoPrice != null
        ? next.listPrice
        : current.promoPrice != null
          ? current.listPrice
          : current.listPrice > 0
            ? current.listPrice
            : next.listPrice,
    listPriceOriginal: current.listPriceOriginal ?? next.listPriceOriginal ?? null,
    promoPrice: current.promoPrice ?? next.promoPrice ?? null,
    stock: current.stock ?? next.stock ?? null,
    status: current.status ?? next.status ?? null,
    unitsSold: current.unitsSold > 0 ? current.unitsSold : next.unitsSold,
  };
}

/** Scrape visible rows on Manage products (table or div layout). */
export function parseProductListPage(
  doc: Document,
  href: string,
): ScrapedListItem[] {
  const onList = isProductListPage(doc, href);
  if (!onList && !href.includes("product/manage")) {
    return [];
  }

  const merged = new Map<string, ScrapedListItem>();
  for (const list of [parseByIdAnchors(doc), parseTableLikeRows(doc), parseByProductLinks(doc)]) {
    for (const item of list) {
      const prev = merged.get(item.skuId);
      merged.set(item.skuId, prev ? betterItem(prev, item) : item);
    }
  }

  return [...merged.values()];
}
