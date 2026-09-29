export const SELECTOR_VERSION = 2;

/** TikTok DOM changes often — keep fallbacks ordered most stable first. */
const remoteCss: Record<string, string> = {};

/** Verified remote config may prepend one CSS selector. Bundled selectors stay as fallback. */
export function setRemoteCss(map: Record<string, string>): void {
  for (const key of Object.keys(remoteCss)) delete remoteCss[key];
  Object.assign(remoteCss, map);
}

export function withRemote(field: string, bundled: readonly string[]): readonly string[] {
  const extra = remoteCss[field];
  if (!extra) return bundled;
  return [extra, ...bundled.filter((selector) => selector !== extra)];
}

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
