const SELLER_HOSTS = [
  "seller-us.tiktok.com",
  "seller.us.tiktok.com",
  "seller.tiktokglobalshop.com",
  "seller-us.tiktokglobalshop.com",
];

export const SELLER_TAB_URL_PATTERNS = [
  "https://seller-us.tiktok.com/*",
  "https://seller.us.tiktok.com/*",
  "https://seller.tiktokglobalshop.com/*",
  "https://seller-us.tiktokglobalshop.com/*",
  ...(import.meta.env.VITE_STRIP_DEV_HOSTS === "1"
    ? []
    : ["http://127.0.0.1:8765/*"]),
];

export function isSellerCenterHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (SELLER_HOSTS.includes(host)) return true;
  if (host.endsWith(".tiktokshop.com") && host.startsWith("seller")) return true;
  return host.endsWith(".tiktok.com") && /^seller[-.]/.test(host);
}

export function isSellerCenterUrl(url: string): boolean {
  if (!url) return false;
  if (
    import.meta.env.VITE_STRIP_DEV_HOSTS !== "1" &&
    url.startsWith("http://127.0.0.1:8765/")
  ) {
    return true;
  }
  try {
    return isSellerCenterHost(new URL(url).hostname);
  } catch {
    return SELLER_HOSTS.some((h) => url.includes(h));
  }
}

export const SELLER_CENTER_LINK = "https://seller-us.tiktok.com/";

/** Best-effort deep link to the product table (imports all visible rows). */
export const MANAGE_PRODUCTS_LINK =
  "https://seller-us.tiktok.com/product/manage?shop_region=US";

export function isManageProductsUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes("product/manage") ||
    lower.includes("manage-product") ||
    lower.includes("products/manage")
  );
}
