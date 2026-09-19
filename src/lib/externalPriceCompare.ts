export type MarketplaceSearch = {
  id: string;
  label: string;
  url: string;
};

/** Public search URLs — user verifies same SKU/UPC before trusting prices. */
export function buildExternalPriceSearches(
  title: string,
  tiktokListPrice = 0,
): MarketplaceSearch[] {
  const trimmed = title.trim().slice(0, 120);
  if (trimmed.length < 3) return [];

  const q = encodeURIComponent(trimmed);
  const priceHint =
    tiktokListPrice > 0
      ? encodeURIComponent(` ${Math.ceil(tiktokListPrice)}`)
      : "";

  return [
    {
      id: "google-shopping",
      label: "Google Shopping",
      url: `https://www.google.com/search?tbm=shop&q=${q}`,
    },
    {
      id: "amazon",
      label: "Amazon",
      url: `https://www.amazon.com/s?k=${q}${priceHint ? `%20${priceHint}` : ""}`,
    },
    {
      id: "ebay",
      label: "eBay",
      url: `https://www.ebay.com/sch/i.html?_nkw=${q}`,
    },
    {
      id: "walmart",
      label: "Walmart",
      url: `https://www.walmart.com/search?q=${q}`,
    },
  ];
}

export function compareSummary(
  tiktokListPrice: number,
  foundPrice: number,
): string {
  if (tiktokListPrice <= 0 || foundPrice <= 0) {
    return "Enter or scrape your TikTok list price, then compare the same item in search results.";
  }
  const diff = tiktokListPrice - foundPrice;
  if (diff > 0.01) {
    return `Found listing is ${formatUsdSimple(diff)} cheaper than your TikTok price (${formatUsdSimple(foundPrice)} vs ${formatUsdSimple(tiktokListPrice)}).`;
  }
  if (diff < -0.01) {
    return `Your TikTok price is ${formatUsdSimple(-diff)} below this reference (${formatUsdSimple(tiktokListPrice)} vs ${formatUsdSimple(foundPrice)}).`;
  }
  return "Prices match closely — confirm same SKU and shipping terms.";
}

function formatUsdSimple(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}
