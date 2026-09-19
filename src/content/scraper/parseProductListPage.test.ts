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

  it("extracts from div grid via product links", () => {
    const doc = new DOMParser().parseFromString(DIV_GRID_HTML, "text/html");
    const items = parseProductListPage(
      doc,
      "https://seller-us.tiktok.com/product/manage?shop_region=US",
    );
    expect(items.some((i) => i.skuId === "1732672081725330342")).toBe(true);
    expect(items.some((i) => i.title.includes("Ailun"))).toBe(true);
  });
});
