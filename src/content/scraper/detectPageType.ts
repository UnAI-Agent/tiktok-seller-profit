export type PageType =
  | "productList"
  | "productEdit"
  | "productCreate"
  | "affiliate"
  | "other";

const LIST_URL = /\/product\/manage\b|manage-product|products\/manage|\/product\/list\b/;
const EDIT_URL = /\/product\/edit\b/;
const CREATE_URL = /\/product\/(?:create|listing|add)\b/;
const AFFILIATE_URL = /\/affiliate\b/;

function headerLabel(th: Element): string {
  return (th.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function hasHeader(doc: Document, name: string): boolean {
  const want = name.toLowerCase();
  return [...doc.querySelectorAll("th")].some((th) => {
    const label = headerLabel(th);
    return label === want || label.startsWith(`${want} `);
  });
}

function isListTable(doc: Document): boolean {
  return (
    hasHeader(doc, "product") &&
    hasHeader(doc, "status") &&
    hasHeader(doc, "stock") &&
    hasHeader(doc, "price")
  );
}

function isEditTable(doc: Document): boolean {
  return hasHeader(doc, "retail price") && hasHeader(doc, "stock");
}

/** Seller Center page kind from the URL and stable header text. */
export function detectPageType(url: string, doc: Document): PageType {
  let path = url.toLowerCase();
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    /* keep the raw string */
  }

  if (LIST_URL.test(path) || isListTable(doc)) return "productList";
  if (EDIT_URL.test(path) || isEditTable(doc)) return "productEdit";
  if (CREATE_URL.test(path)) return "productCreate";
  if (AFFILIATE_URL.test(path)) return "affiliate";
  return "other";
}

export function portfolioHeadline(productCount: number, missingCosts: number): string {
  const products = productCount === 1 ? "1 product" : `${productCount} products`;
  const missing = missingCosts === 1 ? "1 missing cost" : `${missingCosts} missing costs`;
  return `${products} · ${missing}`;
}

export function countMissingCosts(
  rows: ReadonlyArray<{ skuId: string }>,
  skus: ReadonlyArray<{ skuId: string; cogsPerUnit: number; costSource?: string }>,
): number {
  const byId = new Map(skus.map((sku) => [sku.skuId, sku]));
  return rows.filter((row) => {
    const saved = byId.get(row.skuId);
    if (!saved) return true;
    if (saved.cogsPerUnit <= 0) return true;
    return !saved.costSource || saved.costSource === "default";
  }).length;
}
