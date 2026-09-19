import { MANAGE_PRODUCTS_LINK, SELLER_CENTER_LINK } from "../lib/sellerUrl";

type InactivePopupProps = {
  onOpenSettings: () => void;
};

export default function InactivePopup({ onOpenSettings }: InactivePopupProps) {
  function openSellerCenter() {
    void chrome.tabs.create({ url: SELLER_CENTER_LINK });
  }

  function openManageProducts() {
    void chrome.tabs.create({ url: MANAGE_PRODUCTS_LINK });
  }

  return (
    <div className="flex flex-1 flex-col items-center px-2 pb-4 pt-6 text-center">
      <div
        className="mb-6 flex h-36 w-44 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50"
        aria-hidden
      >
        <svg viewBox="0 0 120 90" className="h-24 w-32 text-slate-400" fill="none">
          <rect x="8" y="8" width="104" height="68" rx="4" stroke="currentColor" strokeWidth="2" />
          <rect x="20" y="22" width="36" height="36" rx="2" fill="#FE2C55" fillOpacity="0.2" stroke="#FE2C55" strokeWidth="1.5" />
          <line x1="64" y1="26" x2="100" y2="26" stroke="currentColor" strokeWidth="2" />
          <line x1="64" y1="36" x2="92" y2="36" stroke="currentColor" strokeWidth="2" />
          <line x1="64" y1="46" x2="96" y2="46" stroke="currentColor" strokeWidth="2" />
          <rect x="20" y="64" width="80" height="6" rx="2" fill="currentColor" fillOpacity="0.25" />
        </svg>
      </div>

      <p className="max-w-[300px] text-sm font-semibold leading-snug text-slate-900">
        Please go to TikTok Seller Center to activate the extension
      </p>
      <p className="mt-2 max-w-[300px] text-xs text-slate-500">
        Open a product listing or add-product page — the profit overlay appears
        on the page while you edit listings.
      </p>

      <button
        type="button"
        className="mt-5 w-full max-w-[280px] rounded-lg bg-tiktok py-2.5 text-sm font-semibold text-white hover:bg-tiktok-dark"
        onClick={openManageProducts}
      >
        Open Manage products
      </button>
      <button
        type="button"
        className="mt-2 w-full max-w-[280px] rounded-lg border border-slate-300 py-2.5 text-sm font-medium text-slate-700"
        onClick={openSellerCenter}
      >
        Seller Center home
      </button>

      <div className="mt-6 w-full max-w-[320px] rounded-lg bg-slate-900 px-4 py-5 text-left text-white">
        <p className="text-sm font-medium">Quick start</p>
        <ol className="mt-2 list-inside list-decimal space-y-1 text-xs text-slate-300">
          <li>Log in to Seller Center</li>
          <li>Add or edit a product</li>
          <li>Use − to dock the profit panel to the side</li>
        </ol>
      </div>

      <button
        type="button"
        className="mt-4 text-xs text-slate-500 underline hover:text-slate-700"
        onClick={onOpenSettings}
      >
        Extension settings
      </button>
    </div>
  );
}
