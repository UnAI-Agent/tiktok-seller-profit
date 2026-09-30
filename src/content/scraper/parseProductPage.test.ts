import { describe, expect, it } from "vitest";
import { editPageHtml, loadLabProducts } from "../../../e2e/support/editPages.mjs";
import { parseMoney, parseProductFromHtml } from "./parseProductPage";
import {
  MOCK_PRODUCT_EDITOR_HTML,
  MOCK_PRODUCT_PARTIAL_HTML,
  MOCK_SELLER_HREF,
} from "../../test/mockPages";

describe("parseProductFromHtml", () => {
  it("reads title and price from mock TikTok editor @F-SCRAPE", () => {
    const p = parseProductFromHtml(MOCK_PRODUCT_EDITOR_HTML, MOCK_SELLER_HREF);
    expect(p.hints.onProductEditor).toBe(true);
    expect(p.title).toContain("Ailun");
    expect(p.listPrice).toBe(29.99);
    expect(p.scrapeStatus).toBe("complete");
  });

  it("does not treat a 404 as a product", () => {
    const html =
      "<!doctype html><html><head><title>404</title></head><body><p>404 | The requested path could not be found</p></body></html>";
    const p = parseProductFromHtml(
      html,
      "http://127.0.0.1:8765/product/edit/1732672081725400001",
    );
    expect(p.hints.pageMissing).toBe(true);
    expect(p.listPrice).toBe(0);
    expect(p.title).toBe("Untitled product");
    expect(p.scrapeStatus).not.toBe("complete");
  });

  it("marks partial when price missing", () => {
    const p = parseProductFromHtml(MOCK_PRODUCT_PARTIAL_HTML, MOCK_SELLER_HREF);
    expect(p.title).toContain("Wireless Earbuds");
    expect(p.listPrice).toBe(0);
    expect(p.scrapeStatus).toBe("partial");
    expect(p.hints.hasPriceField).toBe(true);
  });
});

describe("generated lab edit pages", () => {
  it("reads each lab product title, list price, and promo price @F-SCRAPE", () => {
    for (const product of loadLabProducts()) {
      const href = `http://127.0.0.1:8765/product/edit/${product.skuId}`;
      const parsed = parseProductFromHtml(editPageHtml(product), href);
      expect(parsed.title).toBe(product.title);
      if (product.listPriceOriginal != null) {
        expect(parsed.listPrice).toBe(product.listPriceOriginal);
        expect(parsed.promoPrice).toBe(product.listPrice);
      } else {
        expect(parsed.listPrice).toBe(product.listPrice);
        expect(parsed.promoPrice ?? null).toBeNull();
      }
    }
  });
});

describe("parseMoney", () => {
  it("parses currency strings", () => {
    expect(parseMoney("$29.99")).toBe(29.99);
    expect(parseMoney("USD 1,234.50")).toBe(1234.5);
  });
});
