/**
 * Edit pages the scraper can read. The mock seller and the vitest case share this markup.
 * Retail stays in the price field. A promotion line is the buyer price.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function loadLabProducts() {
  const file = path.join(root, "test-fixtures", "lab", "expected.json");
  return JSON.parse(readFileSync(file, "utf8")).products;
}

export function editPageHtml(product) {
  const original = product.listPriceOriginal;
  const retail = original != null ? original : product.listPrice;
  const promo =
    original != null
      ? `<p>Promotion price: $${Number(product.listPrice).toFixed(2)}</p>`
      : "";
  return `<!doctype html>
<html><head><title>${product.title}</title></head>
<body>
  <div data-testid="product-title">${product.title}</div>
  <section>
    <div>Product name</div>
    <textarea>${product.title}</textarea>
  </section>
  <section>
    <div>Retail price</div>
    <input data-testid="retail-price" type="text" value="${retail}" />
  </section>
  ${promo}
</body></html>`;
}

export function nopriceHtml() {
  return `<!doctype html><html><body>
    <div data-testid="product-title">Priceless Sample</div>
    <div>Product name</div>
    <textarea>Priceless Sample</textarea>
  </body></html>`;
}

export function blankHtml() {
  return "<!doctype html><html><head><title>404</title></head><body><p>404 Not found. This page does not exist.</p></body></html>";
}

export function remotePriceHtml() {
  return `<!doctype html><html><body>
    <h1 data-testid="product-title">Remote Price Mug</h1>
    <span data-e2e-remote-price>$27.50</span>
  </body></html>`;
}

export function withSaveHtml() {
  const product = loadLabProducts()[0];
  const page = editPageHtml(product);
  return page.replace(
    "</body>",
    `<button style="position:fixed;right:16px;bottom:16px">Save</button></body>`,
  );
}

/** Account Health with a Shop Performance Score card, shaped like Seller Center's. */
export function accountHealthHtml(score) {
  const value = score == null ? "Not enough orders yet (12/30)" : String(score);
  return `<!doctype html><html><head><title>Account health</title></head><body>
  <h1>Account health</h1>
  <section class="health-card">
    <div class="card-title"><span>Shop Performance Score</span><span class="tip">?</span></div>
    <div class="score-value">${value}</div>
    <div class="sub">Last 60 days · 97% on-time dispatch · 0.4% cancellations</div>
  </section>
  <section class="health-card"><div class="card-title"><span>Violations</span></div><div>0 points</div></section>
</body></html>`;
}
