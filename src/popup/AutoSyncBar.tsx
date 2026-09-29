import { openTab } from "../lib/openTab";
import { isManageProductsUrl, isSellerCenterUrl, MANAGE_PRODUCTS_LINK } from "../lib/sellerUrl";
import { RefreshIcon } from "../ui/icons";
import { Button } from "../ui/primitives";

type AutoSyncBarProps = {
  tabUrl: string;
  skuCount: number;
  syncing: boolean;
  lastMessage: string | null;
  onSync: () => void;
};

export default function AutoSyncBar({ tabUrl, skuCount, syncing, lastMessage, onSync }: AutoSyncBarProps) {
  const onSeller = isSellerCenterUrl(tabUrl);
  const onManage = isManageProductsUrl(tabUrl);

  let status = "Open Seller Center and we sync your listings.";
  if (onSeller && onManage) status = "Syncing the products on this page.";
  else if (onSeller) status = "Open Manage products to bring in all of them.";

  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-900">
          {skuCount > 0 ? `${skuCount} product${skuCount === 1 ? "" : "s"}` : "No products yet"}
        </p>
        <p className="truncate text-slate-500">{lastMessage ?? status}</p>
      </div>
      {!onManage && onSeller && (
        <Button variant="secondary" size="sm" onClick={() => void openTab(MANAGE_PRODUCTS_LINK)}>
          Manage
        </Button>
      )}
      <Button variant="primary" size="sm" busy={syncing} disabled={!onSeller} onClick={onSync} title="Refresh from this page">
        {!syncing && <RefreshIcon size={13} />}
        Sync
      </Button>
    </div>
  );
}
