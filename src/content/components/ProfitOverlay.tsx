import { useEffect, useMemo, useState } from "react";
import type { Settings } from "../../types/settings";
import {
  computeProfit,
  formatPct,
  formatUsd,
  marginHealthLabel,
  marginTone,
  type ProfitInput,
} from "../../lib/profit";
import { sendMessage } from "../../lib/messages";
import {
  parseProductPage,
  type ScrapedProduct,
} from "../scraper/parseProductPage";
import { getCachedTier } from "../../lib/subscription";
import { effectiveShippingPerUnit } from "../../lib/shippingCost";
import ExternalPriceCompare from "./ExternalPriceCompare";
import SpsBadge from "./SpsBadge";

type ProfitOverlayProps = {
  product: ScrapedProduct;
  settings: Settings;
  spsScore: number;
  onCollapsedChange?: (collapsed: boolean) => void;
  onDismiss: () => void;
};

function scrapeBanner(product: ScrapedProduct, scrapeFailed: boolean): string | null {
  if (scrapeFailed) return "Couldn't read page. Try refresh.";
  if (product.scrapeStatus === "complete") return null;
  if (product.hints.hasTitle && product.listPrice <= 0) {
    return "Waiting for price on this form — profit updates automatically.";
  }
  if (product.scrapeStatus === "partial") {
    return "Reading listing data from the page…";
  }
  return "Using Settings defaults for costs until page data loads.";
}

function unitDetail(units: number, perUnit: number): string {
  const u = units > 0 ? units : 1;
  return `(${u}u@${formatUsd(perUnit)})`;
}

export default function ProfitOverlay({
  product: initialProduct,
  settings,
  spsScore,
  onCollapsedChange,
  onDismiss,
}: ProfitOverlayProps) {
  const [product, setProduct] = useState(initialProduct);
  const [collapsed, setCollapsed] = useState(settings.overlayCollapsed);
  const [title, setTitle] = useState(initialProduct.title);
  const [listPrice, setListPrice] = useState(initialProduct.listPrice);
  const [unitsSold, setUnitsSold] = useState(initialProduct.unitsSold);
  const [cogsPerUnit, setCogsPerUnit] = useState(settings.defaultCogs || 0);
  const [shippingOut, setShippingOut] = useState(settings.defaultShippingOut || 0);
  const [adsPerUnit, setAdsPerUnit] = useState(settings.defaultAdsPerUnit || 0);
  const [isPro, setIsPro] = useState(false);
  const [scrapeFailed, setScrapeFailed] = useState(false);

  useEffect(() => {
    setCollapsed(settings.overlayCollapsed);
  }, [settings.overlayCollapsed]);

  useEffect(() => {
    void getCachedTier().then((tier) => setIsPro(tier === "pro"));
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    function resync() {
      const next = parseProductPage();
      setProduct(next);
      if (next.title && next.title !== "Untitled product") setTitle(next.title);
      if (next.listPrice > 0) setListPrice(next.listPrice);
      if (next.unitsSold >= 0) setUnitsSold(next.unitsSold);
      if (next.scrapeStatus === "complete" || next.hints.hasTitle || next.listPrice > 0) {
        setScrapeFailed(false);
      }
    }

    function debounced() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(resync, 250);
    }

    document.addEventListener("input", debounced, true);
    document.addEventListener("change", debounced, true);
    const interval = setInterval(resync, 2000);
    const failTimer = setTimeout(() => {
      setProduct((current) => {
        const empty =
          current.scrapeStatus !== "complete" &&
          current.listPrice <= 0 &&
          !current.hints.hasTitle;
        if (empty) setScrapeFailed(true);
        return current;
      });
    }, 8000);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("input", debounced, true);
      document.removeEventListener("change", debounced, true);
      clearInterval(interval);
      clearTimeout(failTimer);
    };
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await sendMessage({ type: "GET_SKUS" });
      if (!res.ok || !res.skus) return;
      const match = res.skus.find((s) => s.skuId === product.skuId);
      if (match) {
        if (match.cogsPerUnit > 0) setCogsPerUnit(match.cogsPerUnit);
        if (match.shippingOut > 0) setShippingOut(match.shippingOut);
        if (match.adsPerUnit > 0) setAdsPerUnit(match.adsPerUnit);
        if (match.unitsSold > 0 && unitsSold <= 0) setUnitsSold(match.unitsSold);
        if (match.listPrice > 0 && listPrice <= 0) setListPrice(match.listPrice);
      }
    })();
  }, [product.skuId]);

  const profitUnits = unitsSold > 0 ? unitsSold : 1;
  const shippingInCost = effectiveShippingPerUnit(
    shippingOut,
    settings.shippingPassedToBuyer ?? true,
  );

  const input: ProfitInput = useMemo(
    () => ({
      listPrice,
      unitsSold: profitUnits,
      cogsPerUnit,
      shippingOut: shippingInCost,
      adsPerUnit,
      platformFeePct: settings.platformFeePct,
      paymentFeePct: settings.paymentFeePct,
      paymentFixed: settings.paymentFixed,
      refundRatePct: settings.refundRatePct,
      salesTaxPct: settings.salesTaxPct,
      packagingPerUnit: settings.packagingPerUnit,
    }),
    [listPrice, profitUnits, cogsPerUnit, shippingInCost, adsPerUnit, settings],
  );

  const result = useMemo(() => computeProfit(input), [input]);
  const tone = marginTone(result.netProfit, result.netMarginPct);
  const health = marginHealthLabel(tone);
  const banner = scrapeBanner(product, scrapeFailed);

  const toneClass =
    tone === "profit"
      ? "text-green-600"
      : tone === "warning"
        ? "text-yellow-600"
        : "text-red-600";

  const healthEmoji =
    tone === "profit" ? "🟢" : tone === "warning" ? "🟡" : "🔴";

  async function persistCollapsed(next: boolean) {
    setCollapsed(next);
    onCollapsedChange?.(next);
    await sendMessage({
      type: "SAVE_SETTINGS",
      settings: { ...settings, overlayCollapsed: next },
    });
  }

  if (collapsed) {
    return (
      <div
        className="flex w-12 flex-col items-center rounded-l-lg border border-r-0 border-slate-200 bg-white text-slate-900 shadow-lg"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close overlay"
          title="Close"
          className="w-full rounded-tl-lg py-1 text-sm text-slate-500 hover:bg-slate-100"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
        >
          ×
        </button>
        <button
          type="button"
          className="flex flex-col items-center gap-1 px-1 py-2"
          title="Expand profit snapshot"
          onClick={(e) => {
            e.stopPropagation();
            void persistCollapsed(false);
          }}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-tiktok text-[10px] font-bold text-white">
            TT
          </span>
          <span className={`text-[11px] font-semibold leading-tight ${toneClass}`}>
            {formatUsd(result.netProfit)}
          </span>
          <span className="text-[9px] text-slate-500">
            {formatPct(result.netMarginPct)}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      className="w-[340px] max-h-[480px] overflow-auto rounded-xl border border-slate-200 bg-white text-slate-900 shadow-xl"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Profit snapshot</span>
            <SpsBadge score={spsScore} />
          </div>
          <p className="truncate text-xs text-slate-700" title={title}>
            SKU: {title}
          </p>
          <p className="text-[10px] text-slate-500">
            List {listPrice > 0 ? formatUsd(listPrice) : "—"} | Sold:{" "}
            {unitsSold > 0 ? unitsSold.toLocaleString() : "—"} units
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            aria-label="Minimize"
            className="rounded px-2 py-1 text-lg text-slate-500 hover:bg-slate-100"
            onClick={() => void persistCollapsed(true)}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Close"
            className="rounded px-2 py-1 text-lg text-slate-500 hover:bg-slate-100"
            onClick={onDismiss}
          >
            ×
          </button>
        </div>
      </div>

      {banner && (
        <p className={`mx-3 mt-2 rounded-md px-2 py-1 text-[11px] ${
          scrapeFailed ? "bg-rose-50 text-rose-800" : "bg-slate-50 text-slate-600"
        }`}>
          {banner}
        </p>
      )}

      <div className="space-y-0.5 px-3 py-2 text-xs text-slate-700">
        <div className="flex justify-between font-medium">
          <span>Gross revenue</span>
          <span>{formatUsd(result.grossRevenue)}</span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>Platform fee ({settings.platformFeePct}%)</span>
          <span>-{formatUsd(result.platformFee)}</span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>Payment processing</span>
          <span>-{formatUsd(result.paymentFee)}</span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>
            COGS {unitDetail(profitUnits, cogsPerUnit)}
          </span>
          <span>-{formatUsd(result.cogsTotal)}</span>
        </div>
        {shippingInCost > 0 ? (
          <div className="flex justify-between text-slate-600">
            <span>
              Shipping out {unitDetail(profitUnits, shippingInCost)}
            </span>
            <span>-{formatUsd(result.shippingTotal)}</span>
          </div>
        ) : (
          settings.defaultShippingOut > 0 && (
            <div className="text-[10px] text-slate-400">
              Shipping paid by buyer — not in your margin
            </div>
          )
        )}
        <div className="flex justify-between text-slate-600">
          <span>
            Ads {unitDetail(profitUnits, adsPerUnit)}
          </span>
          <span>-{formatUsd(result.adsTotal)}</span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>Refunds ({settings.refundRatePct}%)</span>
          <span>-{formatUsd(result.refunds)}</span>
        </div>
        {result.salesTax > 0 && (
          <div className="flex justify-between text-slate-600">
            <span>Sales tax (est.)</span>
            <span>-{formatUsd(result.salesTax)}</span>
          </div>
        )}
        {result.packagingTotal > 0 && (
          <div className="flex justify-between text-slate-600">
            <span>Packaging</span>
            <span>-{formatUsd(result.packagingTotal)}</span>
          </div>
        )}
        <div className="my-1 border-t border-slate-200" />
        <div className="flex justify-between text-sm font-semibold">
          <span className={toneClass}>NET PROFIT</span>
          <span className={toneClass}>{formatUsd(result.netProfit)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Margin</span>
          <span className={toneClass}>
            {formatPct(result.netMarginPct)} {healthEmoji} {health}
          </span>
        </div>
        <div className="flex justify-between text-[11px] text-slate-500">
          <span>Break-even price</span>
          <span>{formatUsd(result.breakEvenPrice)}</span>
        </div>
      </div>

      <ExternalPriceCompare
        compact
        title={title}
        listPrice={listPrice}
        isPro={isPro}
      />

      <p className="border-t border-slate-100 px-3 py-2 text-center text-[10px] text-slate-400">
        Auto-synced · COGS & shipping rules in Settings
      </p>
    </div>
  );
}
