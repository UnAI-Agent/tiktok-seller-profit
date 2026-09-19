const SELLER_HOSTS = [
  "seller-us.tiktok.com",
  "seller.tiktokglobalshop.com",
  "seller-us.tiktokglobalshop.com",
];

export function isSellerCenterUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("http://127.0.0.1:8765/")) return true;
  try {
    const { hostname } = new URL(url);
    return SELLER_HOSTS.some(
      (h) => hostname === h || hostname.endsWith(".tiktokshop.com"),
    );
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
