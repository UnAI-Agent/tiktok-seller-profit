import { extractUnitsSoldFromText } from "./extractUnitsSold";
import { parseMoney } from "./parseProductPage";

export type ScrapedListItem = {
  skuId: string;
  title: string;
  listPrice: number;
  unitsSold: number;
};

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

function hashTitle(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i += 1) {
    h = (h << 5) - h + title.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
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
  const m = text.match(/\b(\d{12,22})\b/);
  return m?.[1] ?? null;
}

function titleFromRow(row: Element): string | null {
  const link = row.querySelector("a[href*='product'], a[href*='/product/']");
  const fromLink = link?.textContent?.trim();
  if (fromLink && fromLink.length >= 4 && !/^\d+$/.test(fromLink)) {
    return fromLink;
  }

  for (const el of row.querySelectorAll("span, p, div")) {
    const t = el.textContent?.trim() ?? "";
    if (t.length < 8 || t.length > 180) continue;
    if (/^\d+$/.test(t)) continue;
    if (/^ID:/i.test(t)) continue;
    if (/live|inactive|draft|stock|retail|promotion|minutes ago/i.test(t) && t.length < 24)
      continue;
    if (el.querySelector("a, button, img")) continue;
    return t;
  }
  return null;
}

function parseTableLikeRows(doc: Document): ScrapedListItem[] {
  const seen = new Set<string>();
  const items: ScrapedListItem[] = [];

  const rowCandidates = doc.querySelectorAll(
    "table tbody tr, tr, [role='row'], [class*='product'], [class*='row'], [class*='table'] > div",
  );

  for (const row of rowCandidates) {
    const text = row.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (text.length < 12) continue;
    if (!/\$\d/.test(text) && !/\d{12,}/.test(text)) continue;
    if (
      /product name|retail price|promotion|listing quality|combined listings/i.test(
        text,
      ) &&
      text.length < 100
    ) {
      continue;
    }

    const title = titleFromRow(row);
    if (!title) continue;

    const prices = extractPrices(text);
    const listPrice = prices[0] ?? 0;
    const skuId = extractProductId(text) ?? `sku-${hashTitle(title)}`;

    if (seen.has(skuId)) continue;
    seen.add(skuId);

    const unitsSold = extractUnitsSoldFromText(text);
    items.push({ skuId, title, listPrice, unitsSold });
  }

  return items;
}

/** TikTok often uses div grids — follow product links with numeric IDs. */
function parseByProductLinks(doc: Document): ScrapedListItem[] {
  const seen = new Set<string>();
  const items: ScrapedListItem[] = [];

  for (const anchor of doc.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    if (!/\d{12,22}/.test(href) && !/product/.test(href)) continue;

    const idMatch = href.match(/(\d{12,22})/);
    const skuId = idMatch?.[1];
    if (!skuId || seen.has(skuId)) continue;

    const title = anchor.textContent?.trim() ?? "";
    if (title.length < 5 || /^\d+$/.test(title)) continue;

    let listPrice = 0;
    let container: Element | null = anchor;
    for (let depth = 0; depth < 10 && container; depth += 1) {
      const prices = extractPrices(container.textContent ?? "");
      if (prices.length > 0) {
        listPrice = prices[0];
        break;
      }
      container = container.parentElement;
    }

    const unitsSold = container
      ? extractUnitsSoldFromText(container.textContent ?? "")
      : 0;

    seen.add(skuId);
    items.push({ skuId, title: title.slice(0, 200), listPrice, unitsSold });
  }

  return items;
}

function parseByIdLabels(doc: Document): ScrapedListItem[] {
  const seen = new Set<string>();
  const items: ScrapedListItem[] = [];
  const bodyText = doc.body?.innerText ?? "";

  for (const m of bodyText.matchAll(/\bID:\s*(\d{12,22})\b/gi)) {
    const skuId = m[1];
    if (!skuId || seen.has(skuId)) continue;

    let title = "Product";
    let listPrice = 0;
    let rowText = "";

    const all = doc.querySelectorAll("span, p, div, a, td");
    for (const el of all) {
      const t = el.textContent ?? "";
      if (!t.includes(skuId)) continue;
      const row = el.closest("tr, [role='row'], div");
      if (!row) continue;
      rowText = row.textContent?.replace(/\s+/g, " ") ?? "";
      const parsedTitle = titleFromRow(row);
      if (parsedTitle) title = parsedTitle;
      const prices = extractPrices(rowText);
      if (prices[0]) listPrice = prices[0];
      break;
    }

    const unitsSold = extractUnitsSoldFromText(rowText);
    seen.add(skuId);
    items.push({ skuId, title, listPrice, unitsSold });
  }

  return items;
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

  const strategies = [
    parseTableLikeRows(doc),
    parseByProductLinks(doc),
    parseByIdLabels(doc),
  ];

  const seen = new Set<string>();
  const merged: ScrapedListItem[] = [];
  for (const list of strategies) {
    for (const item of list) {
      if (seen.has(item.skuId)) continue;
      seen.add(item.skuId);
      merged.push(item);
    }
  }

  return merged;
}
