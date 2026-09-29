import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductCheckCard } from "./ProductCheckCard";

describe("product check card", () => {
  it("renders hostile review text as text", () => {
    const markup = renderToStaticMarkup(
      createElement(ProductCheckCard, {
        onCost: () => undefined,
        view: {
          title: "<img src=x onerror=alert(1)>",
          price: 20,
          soldLabel: "~1.2K sold",
          rating: 4.3,
          reviewCount: 812,
          band: null,
          profits: { low: null, market: null, high: null },
          verdict: "missing_cost",
          recommended: null,
          topFlag: "<img src=x onerror=alert(1)>",
          insight: null,
          insightLocked: true,
          quotaBlocked: false,
          parseFailed: false,
        },
      }),
    );
    const document = new DOMParser().parseFromString(markup, "text/html");
    expect(document.querySelector("img")).toBeNull();
    expect(markup).toContain("~1.2K sold");
    expect(markup).toContain("Enter your cost");
  });
});
