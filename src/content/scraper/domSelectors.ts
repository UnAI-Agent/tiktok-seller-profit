export const SELECTOR_VERSION = 2;

/** TikTok DOM changes often — keep fallbacks ordered most stable first. */
export const SELECTORS = {
  productTitle: [
    '[data-testid="product-title"]',
    'textarea[aria-label*="product name" i]',
    'input[aria-label*="product name" i]',
  ],
  listPrice: [
    '[data-testid="retail-price"]',
    'input[aria-label*="price" i]',
    'input[name*="price" i]',
    'input[placeholder*="price" i]',
  ],
  unitsSold: [
    '[data-testid="units-sold"]',
    '[class*="sold"]',
  ],
  spsScore: ['[data-testid="seller-score"]', '[class*="performance-score"]'],
} as const;
