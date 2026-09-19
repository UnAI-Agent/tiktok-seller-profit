import { computeProfit } from "./profit";
import { parseProductFromHtml } from "../content/scraper/parseProductPage";
import {
  MOCK_PRODUCT_EDITOR_HTML,
  MOCK_PRODUCT_PARTIAL_HTML,
  MOCK_SELLER_HREF,
} from "../test/mockPages";

export type SelfTestResult = {
  name: string;
  pass: boolean;
  detail: string;
};

export type SelfTestReport = {
  passed: number;
  failed: number;
  results: SelfTestResult[];
};

export function runSelfTest(): SelfTestReport {
  const results: SelfTestResult[] = [];

  const full = parseProductFromHtml(MOCK_PRODUCT_EDITOR_HTML, MOCK_SELLER_HREF);
  results.push({
    name: "Scraper reads product name",
    pass: full.title.includes("Ailun") && full.hints.hasTitle,
    detail: full.title,
  });
  results.push({
    name: "Scraper reads retail price",
    pass: full.listPrice === 29.99 && full.scrapeStatus === "complete",
    detail: `price=${full.listPrice}, status=${full.scrapeStatus}`,
  });

  const partial = parseProductFromHtml(
    MOCK_PRODUCT_PARTIAL_HTML,
    MOCK_SELLER_HREF,
  );
  results.push({
    name: "Partial page (name only) → partial status",
    pass:
      partial.scrapeStatus === "partial" &&
      partial.hints.hasTitle &&
      partial.listPrice === 0,
    detail: `status=${partial.scrapeStatus}`,
  });

  const profit = computeProfit({
    listPrice: 29.99,
    unitsSold: 10,
    cogsPerUnit: 4,
    shippingOut: 1,
    adsPerUnit: 0.5,
    platformFeePct: 8,
    paymentFeePct: 2.9,
    paymentFixed: 0.3,
    refundRatePct: 3,
  });
  results.push({
    name: "Profit formula net margin",
    pass: profit.netProfit > 0 && profit.netMarginPct > 15,
    detail: `net=${profit.netProfit.toFixed(2)}, margin=${profit.netMarginPct.toFixed(1)}%`,
  });

  const passed = results.filter((r) => r.pass).length;
  return {
    passed,
    failed: results.length - passed,
    results,
  };
}
