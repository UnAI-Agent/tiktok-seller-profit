import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseProductListPage } from "./parseProductListPage";
import { parseProductFromHtml } from "./parseProductPage";

const REAL_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../test-fixtures/real",
);

type ListRow = {
  productId: string;
  title: string;
  listPrice: number;
  listPriceOriginal: number | null;
  promoPrice: number | null;
  stock: number | null;
  status: string | null;
  unitsSold: number | null;
};

type ListExpected = {
  page: "manage-products-list";
  url: string;
  rows: ListRow[];
  importedCount: number;
  totalRows: number | null;
};

type VariantRow = {
  skuId: string;
  title: string;
  listPrice: number | null;
  promoPrice: number | null;
  stock: number | null;
};

type EditExpected = {
  page: "product-edit-single" | "product-edit-variants" | "product-create-empty";
  url: string;
  productId: string | null;
  title: string;
  listPrice: number | null;
  promoPrice: number | null;
  variants: VariantRow[];
};

type AffiliateExpected = {
  page: "affiliate-commission";
  url: string;
  labels: string[];
};

const FIXTURES = [
  "manage-products-list",
  "product-edit-single",
  "product-edit-variants",
  "product-create-empty",
  "affiliate-commission",
] as const;

function readExpected<T>(name: string): T {
  const path = join(REAL_DIR, `${name}.expected.json`);
  if (!existsSync(path)) {
    throw new Error(`Add ${name}.expected.json next to ${name}.html`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function loadHtml(name: string): string {
  return readFileSync(join(REAL_DIR, `${name}.html`), "utf8");
}

function fixtureReady(name: string): boolean {
  return (
    existsSync(join(REAL_DIR, `${name}.html`)) &&
    existsSync(join(REAL_DIR, `${name}.expected.json`))
  );
}

function projectList(html: string, href: string): Omit<ListExpected, "url" | "page"> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const items = parseProductListPage(doc, href);
  const rows: ListRow[] = items.map((item) => {
    const extra = item as typeof item & {
      listPriceOriginal?: number | null;
      promoPrice?: number | null;
      stock?: number | null;
      status?: string | null;
      unitsSold?: number | null;
    };
    const units = extra.unitsSold;
    return {
      productId: item.skuId,
      title: item.title,
      listPrice: item.listPrice,
      listPriceOriginal: extra.listPriceOriginal ?? null,
      promoPrice: extra.promoPrice ?? null,
      stock: extra.stock ?? null,
      status: extra.status ?? null,
      unitsSold: units == null || units <= 0 ? null : units,
    };
  });
  return {
    rows,
    importedCount: rows.length,
    totalRows: null,
  };
}

function projectEdit(html: string, href: string): Omit<EditExpected, "url" | "page"> {
  const product = parseProductFromHtml(html, href);
  const extra = product as typeof product & {
    promoPrice?: number | null;
    variants?: VariantRow[];
  };
  return {
    productId: product.skuId.startsWith("sku-") ? null : product.skuId,
    title: product.title === "Untitled product" ? "" : product.title,
    listPrice: product.listPrice > 0 ? product.listPrice : null,
    promoPrice: extra.promoPrice ?? null,
    variants: extra.variants ?? [],
  };
}

describe("real Seller Center fixtures", () => {
  it("README lists every required fixture", () => {
    const readme = readFileSync(join(REAL_DIR, "README.md"), "utf8");
    for (const name of FIXTURES) {
      expect(readme).toContain(`${name}.html`);
      expect(readme).toContain(`${name}.expected.json`);
    }
  });

  it.skipIf(!fixtureReady("manage-products-list"))(
    "manage-products-list matches expected rows",
    () => {
      const expected = readExpected<ListExpected>("manage-products-list");
      const actual = projectList(loadHtml("manage-products-list"), expected.url);
      expect(actual.rows).toEqual(expected.rows);
      expect(actual.importedCount).toBe(expected.importedCount);
      expect(actual.totalRows).toBe(expected.totalRows);
    },
  );

  for (const name of [
    "product-edit-single",
    "product-edit-variants",
    "product-create-empty",
  ] as const) {
    it.skipIf(!fixtureReady(name))(
      `${name} matches expected product`,
      () => {
        const expected = readExpected<EditExpected>(name);
        const actual = projectEdit(loadHtml(name), expected.url);
        expect(actual).toEqual({
          productId: expected.productId,
          title: expected.title,
          listPrice: expected.listPrice,
          promoPrice: expected.promoPrice,
          variants: expected.variants,
        });
      },
    );
  }

  it("L7_edit_page_discount_used", () => {
    const expected = readExpected<EditExpected>("product-edit-single");
    const actual = projectEdit(loadHtml("product-edit-single"), expected.url);
    expect(actual.listPrice).toBe(45);
    expect(actual.promoPrice).toBe(36);
    expect(expected.promoPrice).toBe(36);
  });

  it.skipIf(!fixtureReady("affiliate-commission"))(
    "affiliate-commission contains the labels in expected json",
    () => {
      const expected = readExpected<AffiliateExpected>("affiliate-commission");
      const html = loadHtml("affiliate-commission");
      expect(expected.page).toBe("affiliate-commission");
      for (const label of expected.labels) {
        expect(html).toContain(label);
      }
    },
  );
});
