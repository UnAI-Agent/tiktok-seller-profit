import { describe, expect, it } from "vitest";
import { bulkSkusFrom, matchBulkRows, parseBulkText } from "./bulkCost";

describe("paste costs @F-BULK-COST", () => {
  it("reads comma, tab and semicolon lines and skips headers and junk", () => {
    const { rows, skipped } = parseBulkText(
      "Product ID,Cost\n1732672081725400001, 8.00\nBLUE-MUG-01\t$4.50\nMug, Blue; 3.25\nWinner Ceramic Mug, 7\nno cost here\nX, -2\n\n",
    );
    expect(rows).toEqual([
      { key: "1732672081725400001", cost: 8 },
      { key: "BLUE-MUG-01", cost: 4.5 },
      { key: "Mug, Blue", cost: 3.25 },
      { key: "Winner Ceramic Mug", cost: 7 },
    ]);
    expect(skipped).toHaveLength(3);
  });

  it("matches product ids, stored seller SKU ids and exact titles", () => {
    const skus = bulkSkusFrom([
      { skuId: "1732672081725400001", title: "Winner Ceramic Mug", skuIds: ["BLUE-MUG-01"] },
      { skuId: "1732672081725400002", title: "Promo Candle Set" },
    ]);
    const { matched, unmatched } = matchBulkRows(
      [
        { key: "BLUE-MUG-01", cost: 4.5 },
        { key: "Promo Candle Set", cost: 14 },
        { key: "nope", cost: 1 },
      ],
      skus,
    );
    expect(matched).toEqual([
      { skuId: "1732672081725400001", cost: 4.5 },
      { skuId: "1732672081725400002", cost: 14 },
    ]);
    expect(unmatched).toEqual([{ key: "nope", cost: 1 }]);
  });
});
