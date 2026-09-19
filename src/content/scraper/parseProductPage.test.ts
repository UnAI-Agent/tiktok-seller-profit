import { describe, expect, it } from "vitest";
import { parseMoney, parseProductFromHtml } from "./parseProductPage";
import {
  MOCK_PRODUCT_EDITOR_HTML,
  MOCK_PRODUCT_PARTIAL_HTML,
  MOCK_SELLER_HREF,
} from "../../test/mockPages";

describe("parseProductFromHtml", () => {
  it("reads title and price from mock TikTok editor", () => {
    const p = parseProductFromHtml(MOCK_PRODUCT_EDITOR_HTML, MOCK_SELLER_HREF);
    expect(p.hints.onProductEditor).toBe(true);
    expect(p.title).toContain("Ailun");
    expect(p.listPrice).toBe(29.99);
    expect(p.scrapeStatus).toBe("complete");
  });

  it("marks partial when price missing", () => {
    const p = parseProductFromHtml(MOCK_PRODUCT_PARTIAL_HTML, MOCK_SELLER_HREF);
    expect(p.title).toContain("Wireless Earbuds");
    expect(p.listPrice).toBe(0);
    expect(p.scrapeStatus).toBe("partial");
    expect(p.hints.hasPriceField).toBe(true);
  });
});

describe("parseMoney", () => {
  it("parses currency strings", () => {
    expect(parseMoney("$29.99")).toBe(29.99);
    expect(parseMoney("USD 1,234.50")).toBe(1234.5);
  });
});
