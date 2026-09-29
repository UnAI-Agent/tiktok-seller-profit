import { describe, expect, it } from "vitest";
import {
  aggregateStatement,
  findSkuForStatementId,
  rowsMatchedToProducts,
  STATEMENT_ID_MISMATCH,
  suggestMapping,
} from "./statementImport";

describe("statement import", () => {
  it("maps headers by keyword and aggregates per SKU", () => {
    const headers = [
      "SKU",
      "Order amount",
      "Referral fee",
      "Affiliate commission",
      "Shipping subsidy",
      "Refund amount",
      "Order date",
    ];
    const mapping = suggestMapping(headers);
    expect(mapping.sku).toBe("SKU");
    expect(mapping.orderAmount).toBe("Order amount");
    expect(mapping.referralFee).toBe("Referral fee");
    expect(mapping.affiliateFee).toBe("Affiliate commission");
    expect(mapping.shipping).toBe("Shipping subsidy");
    expect(mapping.refund).toBe("Refund amount");

    const rows = aggregateStatement(
      [
        {
          SKU: "A",
          "Order amount": 20,
          "Referral fee": 1.6,
          "Affiliate commission": 4,
          "Shipping subsidy": 1,
          "Refund amount": 0,
        },
        {
          SKU: "A",
          "Order amount": 20,
          "Referral fee": 1.6,
          "Affiliate commission": 0,
          "Shipping subsidy": 1,
          "Refund amount": 0,
        },
      ],
      mapping,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].referralPct).toBeCloseTo(8, 2);
    expect(rows[0].affiliatePct).toBeCloseTo(20, 2);
    expect(rows[0].affiliateSharePct).toBeCloseTo(50, 2);
    expect(rows[0].shippingPerUnit).toBeCloseTo(1, 2);
  });

  it("aggregates 50000 rows without dropping a sku", () => {
    const mapping = { sku: "SKU", orderAmount: "Order amount" };
    const rows = Array.from({ length: 50000 }, (_, i) => ({
      SKU: i % 2 === 0 ? "A" : "B",
      "Order amount": 10,
    }));
    const started = Date.now();
    const out = aggregateStatement(rows, mapping);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(out).toHaveLength(2);
    expect(out.reduce((sum, row) => sum + row.orders, 0)).toBe(50000);
  });

  it("treats a negative fee as a positive rate", () => {
    const mapping = suggestMapping([
      "SKU",
      "Order amount",
      "Referral fee",
      "Affiliate commission",
      "Shipping subsidy",
      "Refund amount",
    ]);
    const rows = aggregateStatement(
      [
        {
          SKU: "A",
          "Order amount": 100,
          "Referral fee": -6,
          "Affiliate commission": -10,
          "Shipping subsidy": -2,
          "Refund amount": -3,
        },
      ],
      mapping,
    );
    expect(rows[0].referralPct).toBeCloseTo(6, 2);
    expect(rows[0].affiliatePct).toBeCloseTo(10, 2);
    expect(rows[0].affiliateSharePct).toBeCloseTo(100, 2);
    expect(rows[0].shippingPerUnit).toBeCloseTo(2, 2);
    expect(rows[0].refundPct).toBeCloseTo(3, 2);
  });

  it("matches a statement id to the product id or a stored SKU id", () => {
    const skus = [{ skuId: "product-1", skuIds: ["variant-9"] }];
    expect(findSkuForStatementId(skus, "product-1")?.skuId).toBe("product-1");
    expect(findSkuForStatementId(skus, "variant-9")?.skuId).toBe("product-1");
    const linked = rowsMatchedToProducts(
      [{ SKU: "variant-9", "Order amount": 10 }],
      { sku: "SKU", orderAmount: "Order amount" },
      skus,
    );
    expect(linked.matched).toBe(1);
    expect(linked.rows[0].SKU).toBe("product-1");
    const missed = rowsMatchedToProducts(
      [{ SKU: "order-999", "Order amount": 10 }],
      { sku: "SKU", orderAmount: "Order amount" },
      skus,
    );
    expect(missed.matched).toBe(0);
    expect(STATEMENT_ID_MISMATCH).toContain("different ID column");
  });
});
