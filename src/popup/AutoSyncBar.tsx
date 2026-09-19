import {
  isManageProductsUrl,
  isSellerCenterUrl,
  MANAGE_PRODUCTS_LINK,
} from "../lib/sellerUrl";

type AutoSyncBarProps = {
  tabUrl: string;
  skuCount: number;
  syncing: boolean;
  lastMessage: string | null;
  onSync: () => void;
};

export default function AutoSyncBar({
  tabUrl,
  skuCount,
  syncing,
  lastMessage,
  onSync,
}: AutoSyncBarProps) {
  const onSeller = isSellerCenterUrl(tabUrl);
  const onManage = isManageProductsUrl(tabUrl);

  let status = "Open Seller Center — we sync listings automatically.";
  if (onSeller && onManage) {
    status = "Auto-syncing visible products on this page.";
  } else if (onSeller) {
    status = "Auto-syncing this product tab. Open Manage products for bulk import.";
  }

  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-800">
          {skuCount > 0 ? `${skuCount} SKUs` : "No SKUs yet"}
          <span className="font-normal text-slate-500"> · {status}</span>
        </p>
        {lastMessage && (
          <p className="truncate text-[10px] text-slate-500">{lastMessage}</p>
        )}
      </div>
      <button
        type="button"
        disabled={!onSeller || syncing}
        title="Refresh from current tab"
        className="shrink-0 rounded-md bg-slate-900 px-2.5 py-1.5 font-semibold text-white disabled:opacity-40"
        onClick={onSync}
      >
        {syncing ? "…" : "Sync"}
      </button>
      {!onManage && onSeller && (
        <button
          type="button"
          className="shrink-0 rounded-md border border-slate-300 px-2 py-1.5 font-medium text-slate-700"
          onClick={() => void chrome.tabs.create({ url: MANAGE_PRODUCTS_LINK })}
        >
          Manage
        </button>
      )}
    </div>
  );
}
