import { describe, expect, it } from "vitest";
import {
  isProductListPage,
  parseProductListPage,
} from "./parseProductListPage";

const LIST_HTML = `
<main>
  <h1>Manage products</h1>
  <input placeholder="Product name, ID, or SKU" />
  <table>
    <thead><tr><th>Product</th><th>Retail price</th></tr></thead>
    <tbody>
      <tr>
        <td><a href="/product/1732672081725330342">Ailun Screen Protector</a></td>
        <td>1732672081725330342</td>
        <td>Live</td>
        <td>0</td>
        <td>$45.00</td>
        <td>$36.00</td>
      </tr>
    </tbody>
  </table>
</main>
`;

const DIV_GRID_HTML = `
<main>
  <h1>Manage products</h1>
  <div class="grid">
    <div class="row">
      <a href="/product/edit/1732672081725330342">Ailun Screen Protector + Camera Lens Protector</a>
      <span>ID: 1732672081725330342</span>
      <span>Live</span>
      <span>$45.00</span>
      <span>Promotion: $36.00</span>
    </div>
  </div>
</main>
`;

describe("parseProductListPage", () => {
  it("detects manage products page", () => {
    const doc = new DOMParser().parseFromString(LIST_HTML, "text/html");
    expect(isProductListPage(doc, "https://seller-us.tiktok.com/product/manage")).toBe(
      true,
    );
  });

  it("extracts product id, title, and retail price", () => {
    const doc = new DOMParser().parseFromString(LIST_HTML, "text/html");
    const items = parseProductListPage(
      doc,
      "https://seller-us.tiktok.com/product/manage",
    );
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0]?.skuId).toBe("1732672081725330342");
    expect(items[0]?.title).toContain("Ailun");
    expect(items[0]?.listPrice).toBe(45);
  });

  it("n6_promotion_price_is_the_active_price", () => {
    const doc = new DOMParser().parseFromString(DIV_GRID_HTML, "text/html");
    const items = parseProductListPage(
      doc,
      "https://seller-us.tiktok.com/product/manage?shop_region=US",
    );
    const row = items.find((item) => item.skuId === "1732672081725330342");
    expect(row?.listPrice).toBe(36);
    expect(row?.listPriceOriginal).toBe(45);
  });

  it("extracts from div grid via product links", () => {
    const doc = new DOMParser().parseFromString(DIV_GRID_HTML, "text/html");
    const items = parseProductListPage(
      doc,
      "https://seller-us.tiktok.com/product/manage?shop_region=US",
    );
    expect(items.some((i) => i.skuId === "1732672081725330342")).toBe(true);
    expect(items.some((i) => i.title.includes("Ailun"))).toBe(true);
  });

  it("ignores page chrome and keeps the listing title", () => {
    const html = `
      <main class="product-manage">
        <h1>Manage products</h1>
        <header><span>Seller Center</span></header>
        <button>Combined listings</button>
        <button>Bulk actions</button>
        <button>Add product</button>
        <div class="product-promo">All 🔥 Spotlight productsEvergreen pro $1.00</div>
        <div class="row"><div>Category</div><div>Category</div></div>
        <div class="product-row">
          <img alt="" />
          <div>
            <span>Ailun Screen Protector + Camera Lens Protector for iPhone 16 Pro Max</span>
            <span>ID:1732672081725330342</span>
          </div>
          <span>Live</span>
          <span>$45.00</span>
          <span>Promotion: $36.00</span>
        </div>
      </main>
    `;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const items = parseProductListPage(
      doc,
      "https://seller-us.tiktok.com/product/manage",
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.skuId).toBe("1732672081725330342");
    expect(items[0]?.title).toContain("Ailun Screen Protector");
    expect(items[0]?.title).not.toMatch(/category|spotlight|evergreen/i);
    expect(items[0]?.listPrice).toBe(36);
    expect(items[0]?.listPriceOriginal).toBe(45);
  });

  it("reads a strikethrough price when the promo label is gone", () => {
    const html = `
      <main>
        <h1>Manage products</h1>
        <div class="product-row">
          <span>Ailun Screen Protector for iPhone 16 Pro Max</span>
          <span>ID:1732672081725330342</span>
          <span>Live</span>
          <s>$45.00</s>
          <span>$36.00</span>
        </div>
      </main>
    `;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const items = parseProductListPage(doc, "https://seller-us.tiktok.com/product/manage");
    expect(items[0]?.listPrice).toBe(36);
    expect(items[0]?.listPriceOriginal).toBe(45);
    expect(items[0]?.status).toBe("Live");
  });
});
