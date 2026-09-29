import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  countMissingCosts,
  detectPageType,
  portfolioHeadline,
} from "./detectPageType";
import { parseProductListPage } from "./parseProductListPage";

const REAL_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../test-fixtures/real",
);

function doc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

const LIST_URL = "https://seller-us.tiktok.com/product/manage";
const EDIT_URL =
  "https://seller-us.tiktok.com/product/edit/1732672081725330342";

describe("detectPageType", () => {
  const listHtml = readFileSync(join(REAL_DIR, "manage-products-list.html"), "utf8");
  const editHtml = readFileSync(join(REAL_DIR, "product-edit-single.html"), "utf8");

  it("detects the real Manage products table", () => {
    const parsed = doc(listHtml);
    expect(detectPageType(LIST_URL, parsed)).toBe("productList");
    const rows = parseProductListPage(parsed, LIST_URL);
    expect(rows.map((row) => row.skuId)).toContain("1732672081725330342");
  });

  it("detects the real product edit price table", () => {
    expect(detectPageType(EDIT_URL, doc(editHtml))).toBe("productEdit");
  });

  it("detects an empty add-product URL", () => {
    expect(
      detectPageType("https://seller-us.tiktok.com/product/listing", doc("<main></main>")),
    ).toBe("productCreate");
  });

  it("detects an affiliate URL", () => {
    expect(
      detectPageType("https://seller-us.tiktok.com/affiliate/landing", doc("<main></main>")),
    ).toBe("affiliate");
  });

  it("leaves other Seller Center pages as other", () => {
    expect(
      detectPageType("https://seller-us.tiktok.com/homepage", doc("<main>Home</main>")),
    ).toBe("other");
  });

  it("does not treat the edit price table as a product list", () => {
    expect(detectPageType(EDIT_URL, doc(editHtml))).not.toBe("productList");
  });
});

describe("portfolio headline", () => {
  it("counts products and missing costs", () => {
    expect(portfolioHeadline(1, 1)).toBe("1 product · 1 missing cost");
    expect(
      countMissingCosts(
        [{ skuId: "1732672081725330342" }],
        [],
      ),
    ).toBe(1);
    expect(
      countMissingCosts(
        [{ skuId: "1732672081725330342" }],
        [{ skuId: "1732672081725330342", cogsPerUnit: 4, costSource: "custom" }],
      ),
    ).toBe(0);
  });
});
