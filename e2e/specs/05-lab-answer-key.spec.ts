import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { formatSignedUsd } from "../../src/lib/profit";
import { expect, test } from "../support/fixtures";
import { email, makePro, seedToken } from "../support/session";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type Product = {
  key: string;
  skuId: string;
  title: string;
  cogsPerUnit: number;
  adsPerUnit: number;
  packagingPerUnit: number;
  affiliatePct: number | null;
  net: number | null;
  verdict: string;
  hiddenProfit?: number;
};

test("E-LAB-HEADLINE E-LAB-SYNC E-LAB-NUMBERS E-LAB-BUCKETS-BEFORE E-LAB-STATEMENT lab answer key", async ({
  page,
  harness,
  context,
  extId,
}) => {
  test.setTimeout(180_000);
  const expected = JSON.parse(readFileSync(path.join(root, "test-fixtures", "lab", "expected.json"), "utf8")) as {
    overviewBeforeStatement: Record<string, string[]>;
    overviewAfterStatement: Record<string, string[]>;
    products: Product[];
  };
  const user = await harness.api.registerApi(email());
  await harness.api.verifyEmail(user.userId, "");
  await makePro(harness.api, user.userId);
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/lab/product/manage/`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await expect(panel.getByText("10 products · 10 missing costs")).toBeVisible();
  await panel.getByRole("button", { name: "Products" }).click();
  await panel.getByRole("button", { name: "Sync" }).click();
  await expect(panel.getByText("Imported 10 from this page.")).toBeVisible();
  await panel.getByRole("button", { name: "Sync" }).click();
  await expect(panel.getByText("Found 10. Already up to date.")).toBeVisible();

  const grid = expected.products.filter((row) => ["A", "B", "C", "D", "E"].includes(row.key));
  const listOnly = expected.products.filter((row) => ["F", "H", "I", "J"].includes(row.key));
  for (const product of grid) {
    await page.goto(`${harness.origin}/product/edit/${product.skuId}`);
    await panel.locator("#mm-hero-cost").fill(String(product.cogsPerUnit));
    await panel.getByRole("button", { name: "See my profit" }).click();
    if (product.packagingPerUnit) {
      const field = panel.getByRole("spinbutton", { name: "Packaging" });
      await field.fill(String(product.packagingPerUnit));
      await field.blur();
    }
    if (product.adsPerUnit) {
      const field = panel.getByRole("spinbutton", { name: "Ads per order" });
      await field.fill(String(product.adsPerUnit));
      await field.blur();
    }
    if (product.affiliatePct) {
      const field = panel.getByRole("spinbutton", { name: "Creator commission" });
      await field.fill(String(product.affiliatePct));
      await field.blur();
    }
    await page.waitForTimeout(800); // cost autosave debounce is 400ms
    await expect(panel.getByText("Saved")).toBeVisible();
    if (product.net != null) {
      await expect(panel.getByText(formatSignedUsd(product.net)).first()).toBeVisible();
    }
  }
  await page.goto(`${harness.origin}/lab/product/manage/`);
  await panel.getByRole("button", { name: "Products" }).click();
  for (const product of listOnly) {
    const row = panel.locator("li", { hasText: product.title });
    await row.getByRole("button", { name: "Add cost" }).click();
    await row.getByLabel("Purchase cost").fill(String(product.cogsPerUnit));
    await row.getByLabel("Purchase cost").blur();
    if (product.statement) {
      await expect(row.getByText("Healthy").first()).toBeVisible();
    } else if (product.net != null) {
      await expect(row.getByText(formatSignedUsd(product.net)).first()).toBeVisible();
    }
  }

  await panel.getByRole("button", { name: "Overview" }).click();
  await expect(panel.getByText("$48.59")).toHaveCount(0);
  const buckets = [
    ["Losing", expected.overviewBeforeStatement.losing],
    ["Thin", expected.overviewBeforeStatement.thin],
    ["Healthy", expected.overviewBeforeStatement.healthy],
    ["Missing cost", expected.overviewBeforeStatement.missing],
  ] as const;
  for (const [label, keys] of buckets) {
    await panel.getByRole("button", { name: new RegExp(label) }).click();
    for (const key of keys) {
      const product = expected.products.find((row) => row.key === key);
      if (!product) throw new Error(key);
      await expect(panel.getByText(product.title).first()).toBeVisible();
      if (!product.statement && product.verdict !== "Healthy" && product.verdict !== "Missing cost") {
        await expect(panel.getByText(product.verdict).first()).toBeVisible();
      }
    }
  }

  await panel.getByRole("button", { name: "Products" }).click();
  await panel.getByLabel("Statement file").setInputFiles(path.join(root, "test-fixtures", "lab", "statement.csv"));
  await panel.getByRole("button", { name: "Apply to products" }).click();
  await expect(panel.getByText(/Updated \d+ products/)).toBeVisible();
  await panel.getByRole("button", { name: "Overview" }).click();
  await panel.getByRole("button", { name: /Thin/ }).click();
  await expect(panel.getByText("Statement Fee Bottle")).toBeVisible();
  const after = expected.overviewAfterStatement;
  expect(after.thin).toContain("I");
});

test("E-LAB-XLSX a small xlsx statement imports", async ({ page, harness, context, extId }) => {
  const user = await harness.api.registerApi(email());
  await makePro(harness.api, user.userId);
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/lab/product/manage/`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Products" }).click();
  await panel.getByRole("button", { name: "Sync" }).click();
  const file = path.join(os.tmpdir(), `mm-statement-${Date.now()}.xlsx`);
  const sheet = XLSX.utils.aoa_to_sheet([
    ["SKU", "Order amount"],
    ["1732672081725400001", 39.99],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Sheet1");
  writeFileSync(file, XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
  await panel.getByLabel("Statement file").setInputFiles(file);
  await expect(panel.getByText("Match your columns")).toBeVisible();
});

test("E-LAB-IMPORT-LIMITS oversized files show the size and row limits", async ({ page, harness, context, extId }) => {
  const user = await harness.api.registerApi(email());
  await makePro(harness.api, user.userId);
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/lab/product/manage/`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Products" }).click();
  const big = path.join(os.tmpdir(), `mm-big-${Date.now()}.csv`);
  writeFileSync(big, Buffer.alloc(20 * 1024 * 1024 + 1, 97));
  await panel.getByLabel("Statement file").setInputFiles(big);
  await expect(panel.getByText("20 MB or smaller")).toBeVisible();
  const rows = path.join(os.tmpdir(), `mm-rows-${Date.now()}.csv`);
  writeFileSync(rows, `sku,amount\n${Array.from({ length: 50001 }, (_, i) => `${i},1`).join("\n")}\n`);
  await panel.getByLabel("Statement file").setInputFiles(rows);
  await expect(panel.getByText("50,000 rows")).toBeVisible();
});

test("E-LAB-50-FREE a free account can import 50 price-only rows", async ({ page, harness, context, extId }) => {
  const user = await harness.api.registerApi(email());
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/product/manage-50`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Products" }).click();
  await panel.getByRole("button", { name: "Sync" }).click();
  await expect(panel.getByText(/Imported 50 from this page/)).toBeVisible();
  await expect(panel.getByText("Price-only rows are unlimited.")).toBeVisible();
  await expect(panel.getByText("You've used all your free product costs.")).toHaveCount(0);
});
