/**
 * Phase 2: server-side Playwright scraper (see backend scraper route).
 * MVP uses DOM parsing in parseProductPage.ts with multi-strategy fallbacks.
 */
import {
  parseProductFromDocument,
  type ScrapedProduct,
} from "./parseProductPage";

export type ScrapeStrategy = "dom" | "playwright";

/** Extension-side entry — always DOM today; swap to API when Pro backend scraper ships. */
export function scrapeProductPage(
  doc: Document = document,
  href: string = window.location.href,
  _strategy: ScrapeStrategy = "dom",
): ScrapedProduct {
  return parseProductFromDocument(doc, href);
}
