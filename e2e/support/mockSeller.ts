import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { accountHealthHtml, blankHtml, editPageHtml, loadLabProducts, nopriceHtml, remotePriceHtml, withSaveHtml } from "./editPages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtures = path.join(root, "test-fixtures");

const FILES = {
  "/product/manage": "real/manage-products-list.html",
  "/product/manage-50": "synthetic/manage-products-50.html",
  "/lab/product/manage/": "lab/product/manage/index.html",
  "/lab/product/manage": "lab/product/manage/index.html",
  "/product/edit/real": "real/product-edit-single.html",
};

function bodyFor(urlPath) {
  if (FILES[urlPath]) return readFileSync(path.join(fixtures, FILES[urlPath]));
  if (urlPath === "/product/edit/noprice") return nopriceHtml();
  if (urlPath === "/product/edit/blank") return blankHtml();
  if (urlPath === "/product/edit/with-save") return withSaveHtml();
  if (urlPath === "/product/edit/remote") return remotePriceHtml();
  const health = urlPath.match(/^\/account\/health(?:\/(\d(?:\.\d{1,2})?|none))?$/);
  if (health) return accountHealthHtml(health[1] === "none" ? null : health[1] ?? "4.3");
  if (urlPath === "/elsewhere") return "<!doctype html><html><body><h1>Not a product</h1></body></html>";
  const edit = urlPath.match(/^\/product\/edit\/(\d+)$/);
  if (edit) {
    const product = loadLabProducts().find((row) => row.skuId === edit[1]);
    if (product) return editPageHtml(product);
  }
  const file = path.join(fixtures, urlPath.replace(/^\//, ""));
  if (existsSync(file)) return readFileSync(file);
  return null;
}

function listen(port) {
  const server = createServer((req, res) => {
    const urlPath = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const body = bodyFor(urlPath);
    if (body == null) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

export async function startMockSeller() {
  const seller = await listen(8765);
  const other = await listen(8766);
  return {
    origin: "http://127.0.0.1:8765",
    otherOrigin: "http://127.0.0.1:8766",
    async stop() {
      await new Promise((resolve) => seller.close(resolve));
      await new Promise((resolve) => other.close(resolve));
    },
  };
}
