import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ProfitOverlay from "../content/components/ProfitOverlay";
import SkuDashboard from "../dashboard/SkuDashboard";
import { DEFAULT_SETTINGS } from "../types/settings";
import { csvEscape } from "./exportCsv";

describe("untrusted output hardening", () => {
  it("neutralizes spreadsheet formulas in CSV cells", () => {
    for (const value of ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\tformula", "\rformula"]) {
      expect(csvEscape(value).startsWith("'")).toBe(true);
    }
    expect(csvEscape(-5.2)).toBe("-5.2");
  });

  it("renders a hostile product title as text", () => {
    const title = "<img src=x onerror=alert(1)>";
    const markup = renderToStaticMarkup(
      createElement(ProfitOverlay, {
        product: {
          skuId: "hostile-title",
          title,
          listPrice: 20,
          unitsSold: 1,
          scrapeStatus: "complete",
          scrapeComplete: true,
          hints: {
            hasTitle: true,
            hasPriceField: true,
            onProductEditor: true,
          },
        },
        settings: DEFAULT_SETTINGS,
        loggedIn: true,
        onDismiss: () => undefined,
      }),
    );
    const document = new DOMParser().parseFromString(markup, "text/html");
    expect(document.querySelector("img")).toBeNull();

    const dashboard = renderToStaticMarkup(
      createElement(SkuDashboard, {
        skus: [
          {
            skuId: "hostile-title",
            title,
            listPrice: 20,
            cogsPerUnit: 5,
            shippingOut: 1,
            adsPerUnit: 0,
            unitsSold: 1,
            refundRatePct: 0,
            netMarginPct: 50,
            netProfit: 10,
            sourceUrl: "https://seller-us.tiktok.com/product/1",
            updatedAt: "2026-09-23T00:00:00Z",
          },
        ],
        isPro: true,
        settings: DEFAULT_SETTINGS,
      }),
    );
    const dashboardDocument = new DOMParser().parseFromString(dashboard, "text/html");
    expect(dashboardDocument.querySelector("img")).toBeNull();
    expect(dashboardDocument.body.textContent).toContain(title);
  });
});
