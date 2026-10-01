import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import type { Locator } from "@playwright/test";
import { formatSignedUsd, formatUsd } from "../../src/lib/profit";
import { expect, test } from "../support/fixtures";
import { clickLeaving, email, makePro, seedToken } from "../support/session";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type Numbers = { net: number | null; margin: number | null; verdict: string };
type Product = Numbers & {
  key: string;
  skuId: string;
  title: string;
  cogsPerUnit: number;
  adsPerUnit: number;
  packagingPerUnit: number;
  affiliatePct: number | null;
  hiddenProfit?: number;
  afterStatement: Numbers & { unitsSold: number };
};
type Key = {
  overviewBeforeStatement: Record<Bucket, string[]>;
  overviewAfterStatement: Record<Bucket, string[]>;
  products: Product[];
};
type Bucket = "losing" | "thin" | "healthy" | "missing";

const expected = JSON.parse(readFileSync(path.join(root, "test-fixtures", "lab", "expected.json"), "utf8")) as Key;
/** Answer-key bucket → the Products tab filter that must list exactly those products. */
const TABS: Array<[Bucket, string]> = [
  ["losing", "Losing"],
  ["thin", "Thin"],
  ["healthy", "Healthy"],
  ["missing", "No cost"],
];

function byKey(key: string): Product {
  const product = expected.products.find((row) => row.key === key);
  if (!product) throw new Error(`answer key has no product ${key}`);
  return product;
}

/** Every product row matches the key: net, margin, verdict (Pro sees the verdict text), or the missing-cost state. */
async function expectRows(panel: Locator, pick: (product: Product) => Numbers) {
  await panel.getByRole("tab", { name: /^All/ }).click();
  for (const product of expected.products) {
    const want = pick(product);
    const row = panel.locator(`li[data-sku-id="${product.skuId}"]`);
    await expect(row, `${product.key} ${product.title}`).toHaveCount(1);
    if (want.net == null) {
      await expect(row).toHaveAttribute("data-tone", "missing");
      await expect(row.getByRole("button", { name: "Add cost" })).toBeVisible();
      continue;
    }
    await expect(row, `${product.key} net`).toHaveAttribute("data-net", want.net.toFixed(2));
    await expect(row, `${product.key} margin`).toHaveAttribute("data-margin", want.margin!.toFixed(1));
    await expect(row.getByText(formatSignedUsd(want.net), { exact: true })).toBeVisible();
    await expect(row.getByText(want.verdict, { exact: true }), `${product.key} verdict`).toBeVisible();
  }
}

/** Each filter tab lists exactly the answer key's products for that bucket, no more and no fewer. */
async function expectBuckets(panel: Locator, buckets: Record<Bucket, string[]>) {
  for (const [bucket, label] of TABS) {
    const want = buckets[bucket].map((key) => byKey(key).skuId).sort();
    const tab = panel.getByRole("tab", { name: new RegExp(`^${label}\\s*${want.length}$`) });
    await expect(tab, `${label} tab shows ${want.length}`).toHaveCount(1);
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(async () => (await panel.locator("li[data-sku-id]").evaluateAll((els) => els.map((el) => el.getAttribute("data-sku-id")))).sort(), {
        message: `${label} lists exactly ${buckets[bucket].join(", ")}`,
      })
      .toEqual(want);
  }
}

test("E-LAB-HEADLINE E-LAB-SYNC E-LAB-NUMBERS E-LAB-BUCKETS-BEFORE E-LAB-STATEMENT lab answer key", async ({
  page,
  harness,
  context,
  extId,
}) => {
  test.setTimeout(240_000);
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

  // Costs typed the two ways sellers type them: on the product page (with packaging, ads,
  // commission) and in the Products list (purchase cost only).
  const grid = expected.products.filter((row) => ["A", "B", "C", "D", "E"].includes(row.key));
  const listOnly = expected.products.filter((row) => ["F", "H", "I", "J"].includes(row.key));
  for (const product of grid) {
    await page.goto(`${harness.origin}/product/edit/${product.skuId}`);
    await panel.locator("#mm-hero-cost").fill(String(product.cogsPerUnit));
    await clickLeaving(panel.getByRole("button", { name: "See my profit" }));
    const fields: Array<[string, number | null]> = [
      ["Packaging", product.packagingPerUnit],
      ["Ads per order", product.adsPerUnit],
      ["Creator commission", product.affiliatePct],
    ];
    for (const [name, value] of fields) {
      if (!value) continue;
      const field = panel.getByRole("spinbutton", { name });
      await field.fill(String(value));
      await field.blur();
    }
    await page.waitForTimeout(800); // cost autosave debounce is 400ms
    await expect(panel.getByText("Saved")).toBeVisible();
    await expect(panel.getByText(formatSignedUsd(product.net!)).first(), `${product.key} on its product page`).toBeVisible();
  }
  await page.goto(`${harness.origin}/lab/product/manage/`);
  await panel.getByRole("button", { name: "Products" }).click();
  for (const product of listOnly) {
    const row = panel.locator(`li[data-sku-id="${product.skuId}"]`);
    await row.getByRole("button", { name: "Add cost" }).click();
    await row.getByLabel("Purchase cost").fill(String(product.cogsPerUnit));
    await row.getByLabel("Purchase cost").blur();
    await expect(row).toHaveAttribute("data-net", product.net!.toFixed(2));
  }

  // Before the statement: every row and every bucket matches the key.
  await expectRows(panel, (product) => product);
  await expectBuckets(panel, expected.overviewBeforeStatement);

  // G has no cost: its "hidden profit" is an estimate MarginMark must never show as a number.
  const hidden = byKey("G").hiddenProfit;
  expect(hidden, "key defines G's hidden profit").toBeGreaterThan(0);
  await expect(panel.getByText(formatUsd(hidden!))).toHaveCount(0);
  await panel.getByRole("button", { name: "Overview" }).click();
  await expect(panel.getByText(formatUsd(hidden!))).toHaveCount(0);

  // Import the real statement: fees, commission and refunds come from TikTok, not estimates.
  await panel.getByRole("button", { name: "Products" }).click();
  await panel.getByLabel("Statement file").setInputFiles(path.join(root, "test-fixtures", "lab", "statement.csv"));
  await panel.getByRole("button", { name: "Apply to products" }).click();
  await expect(panel.getByText(/Updated \d+ products?\./)).toBeVisible();

  await expectRows(panel, (product) => product.afterStatement);
  await expectBuckets(panel, expected.overviewAfterStatement);
  await expect(panel.getByText(formatUsd(hidden!))).toHaveCount(0);
});

test("E-LAB-XLSX an xlsx statement imports end to end", async ({ page, harness, context, extId }) => {
  const user = await harness.api.registerApi(email());
  await makePro(harness.api, user.userId);
  await seedToken(context, extId, user.token);
  await page.goto(`${harness.origin}/lab/product/manage/`);
  const panel = page.locator("#tiktok-seller-tool-root");
  await panel.getByRole("button", { name: "Products" }).click();
  await panel.getByRole("button", { name: "Sync" }).click();
  await expect(panel.getByText("Imported 10 from this page.")).toBeVisible();
  const A = byKey("A");
  const row = panel.locator(`li[data-sku-id="${A.skuId}"]`);
  await row.getByRole("button", { name: "Add cost" }).click();
  await row.getByLabel("Purchase cost").fill(String(A.cogsPerUnit));
  await row.getByLabel("Purchase cost").blur();
  await expect(row).toHaveAttribute("data-net", /\d/);
  await expect(row.getByText(/vs est\./)).toHaveCount(0);

  const file = path.join(os.tmpdir(), `mm-statement-${Date.now()}.xlsx`);
  const sheet = XLSX.utils.aoa_to_sheet([
    ["SKU", "Order amount", "Referral fee"],
    [A.skuId, 39.99, 2.3994],
    [A.skuId, 39.99, 2.3994],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Sheet1");
  writeFileSync(file, XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
  await panel.getByLabel("Statement file").setInputFiles(file);
  await expect(panel.getByText("Match your columns")).toBeVisible();
  await panel.getByRole("button", { name: "Apply to products" }).click();
  await expect(panel.getByText("Updated 1 product. Stays on your computer.")).toBeVisible();
  // The row now runs on the statement's fees and shows how far the estimate was off.
  await expect(row.getByText(/vs est\./)).toBeVisible();
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
