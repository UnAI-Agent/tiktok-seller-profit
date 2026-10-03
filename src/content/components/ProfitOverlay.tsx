import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Settings } from "../../types/settings";
import {
  computeProfit,
  formatSignedUsd,
  formatUsd,
  marginTone,
  priceGuard,
  type ProfitInput,
} from "../../lib/profit";
import { sendMessage } from "../../lib/messages";
import { SELECTOR_VERSION } from "../scraper/domSelectors";
import { parseProductPage, sellingPrice, type ScrapedProduct } from "../scraper/parseProductPage";
import {
  countMissingCosts,
  detectPageType,
  type PageType,
} from "../scraper/detectPageType";
import { parseProductListPage } from "../scraper/parseProductListPage";
import { ApiError, CONNECTION_LOST, fetchMe, logout, trackEvent } from "../../lib/apiClient";
import { FREE_SKU_LIMIT, LLE_TEST_BANNER } from "../../config";
import { extensionVersion } from "../../lib/reportProblem";
import { HelpPanel, type HelpTopic } from "./FieldHelp";
import { isPaidTier, readTier, tierFromProfile } from "../../lib/subscription";
import { effectiveShippingPerUnit } from "../../lib/shippingCost";
import { profitInputFor } from "../../lib/skuEconomics";
import { portfolioStats } from "../../lib/diagnose";
import type { SubscriptionTier } from "../../types/auth";
import type { ActualFees, CostSource, SkuRecord } from "../../types/sku";
import SkuDashboard, { type ProductFilter } from "../../dashboard/SkuDashboard";
import AutoSyncBar from "../../popup/AutoSyncBar";
import ProfilePanel from "../../popup/ProfilePanel";
import SettingsPanel from "../../popup/SettingsPanel";
import SupportCenter from "../../popup/SupportCenter";
import { autoSyncSkusFromPage } from "../syncPageSkus";
import OverlayAuth from "./OverlayAuth";
import LoginScreen from "../../popup/LoginScreen";
import MarkLogo from "./MarkLogo";
import OverlayHeader from "./OverlayHeader";
import CostInputs, { type CostDraft } from "./CostInputs";
import CommissionCard from "./CommissionCard";
import AdsCard from "./AdsCard";
import CostWaterfall from "./CostWaterfall";
import WhatIfPanel from "./WhatIfPanel";
import FirstRunChecklist from "./FirstRunChecklist";
import ProfitBoard from "./ProfitBoard";
import { clearPriceGuardChip, syncPriceGuardChip } from "../priceGuardChip";
import { guardCopy } from "./PriceGuardBanner";
import type { BoardBucket } from "../../lib/profitBoard";
import PlanPicker from "../../ui/PlanPicker";
import ProLock from "../../ui/ProLock";
import { UpgradeContext } from "../../ui/upgrade";
import { Alert, Button, cx } from "../../ui/primitives";
import { ChevronLeftIcon, HelpIcon, BoxIcon, ChartIcon, SettingsIcon, UserIcon } from "../../ui/icons";
import CreatorBoard from "../../dashboard/CreatorBoard";
import SpsStrip from "./SpsBadge";
import WeeklyRecap from "./WeeklyRecap";
import type { SpsSnapshot } from "../../lib/sps";
import { flagEnabled } from "../activeConfig";
import { TONE, toneForNet } from "../../ui/tone";

type OverlayNav = "overview" | "products" | "creators" | "settings";

type OverlayView = "main" | "account" | "support" | "plans" | "auth";

/** Login and account screens hide their body when the session flips. Show the main panel instead of a bare footer. */
export function shownOverlayView(view: OverlayView, loggedIn: boolean): OverlayView {
  if ((view === "auth" && loggedIn) || (view === "account" && !loggedIn)) return "main";
  return view;
}

const NAV_ALL: Array<[OverlayNav, string]> = [
  ["overview", "Overview"],
  ["products", "Products"],
  ["creators", "Creators"],
  ["settings", "Settings"],
];

const NAV_ICON = {
  overview: ChartIcon,
  products: BoxIcon,
  creators: UserIcon,
  settings: SettingsIcon,
} as const;

/** Blurred stand-in for the Pro commission + ad cards. Fixed numbers, never the seller's data. */
const INSIGHT_PREVIEW = (
  <div className="space-y-2 text-xs">
    <div className="flex items-center justify-between"><span>Pay creators up to</span><b className="text-emerald-700">14.5%</b></div>
    <div className="h-2.5 rounded-full bg-gradient-to-r from-emerald-400 via-amber-300 to-red-300" />
    <div className="flex items-center justify-between"><span>Spend up to</span><b>$3.20 per order</b></div>
    <div className="flex items-center justify-between"><span>GMV Max ROI at least</span><b>4.8</b></div>
  </div>
);

let lastOverlayNav: OverlayNav = "overview";

function initialPageType(): PageType {
  if (typeof document === "undefined") return "other";
  return detectPageType(window.location.href, document);
}

type ProfitOverlayProps = {
  product: ScrapedProduct;
  settings: Settings;
  loggedIn: boolean;
  accountTier?: SubscriptionTier;
  onAuthed?: () => void;
  onCollapsedChange?: (collapsed: boolean) => void;
  onDismiss: () => void;
};

function defaultsFrom(settings: Settings): CostDraft {
  return {
    cogsPerUnit: settings.defaultCogs || 0,
    shippingOut: settings.defaultShippingOut || 0,
    packagingPerUnit: settings.packagingPerUnit || 0,
    adsPerUnit: settings.defaultAdsPerUnit || 0,
    affiliatePct: settings.affiliateCommissionPct || 0,
  };
}

export default function ProfitOverlay({
  product: initialProduct,
  settings,
  loggedIn,
  accountTier = "free",
  onAuthed,
  onCollapsedChange,
  onDismiss,
}: ProfitOverlayProps) {
  const [product, setProduct] = useState(initialProduct);
  const [pageType] = useState<PageType>(initialPageType);
  const [collapsed, setCollapsed] = useState(settings.overlayCollapsed);
  const [title, setTitle] = useState(initialProduct.title);
  const [listPrice, setListPrice] = useState(
    initialProduct.hints.pageMissing ? 0 : sellingPrice(initialProduct),
  );
  const [listPriceOriginal, setListPriceOriginal] = useState<number | null>(
    initialProduct.promoPrice ? initialProduct.listPrice : null,
  );
  const [unitsSold, setUnitsSold] = useState(initialProduct.unitsSold);
  const [draft, setDraft] = useState<CostDraft>(() => defaultsFrom(settings));
  const [costSource, setCostSource] = useState<CostSource>("default");
  const [samplesSent, setSamplesSent] = useState(0);
  const [sampleUnitCost, setSampleUnitCost] = useState<number | undefined>();
  const [actualFees, setActualFees] = useState<ActualFees | undefined>();
  const [saved, setSaved] = useState(false);
  const [tier, setTier] = useState<SubscriptionTier>(
    accountTier === "pro" || accountTier === "diamond" ? accountTier : "free",
  );
  const [help, setHelp] = useState<HelpTopic | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; message: string } | null>(null);
  const [view, setView] = useState<OverlayView>("main");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [priceWaitDone, setPriceWaitDone] = useState(false);
  const [scrapeFailed, setScrapeFailed] = useState(initialProduct.hints.pageMissing === true);
  const [tab, setTab] = useState<OverlayNav>(
    pageType === "productList" ? "overview" : lastOverlayNav,
  );
  const [connectionLost, setConnectionLost] = useState(false);
  const [skus, setSkus] = useState<SkuRecord[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const userEmailRef = useRef(userEmail);
  userEmailRef.current = userEmail;
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  const [costFocus, setCostFocus] = useState<{ skuId: string; token: number } | null>(null);
  const [filterRequest, setFilterRequest] = useState<{ filter: ProductFilter; token: number } | null>(null);
  const [checklistDismissed, setChecklistDismissed] = useState(true);
  const [limitHit, setLimitHit] = useState(false);
  const [sps, setSps] = useState<SpsSnapshot | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasLoss = useRef(false);
  const lastTier = useRef<SubscriptionTier>(tier);

  const isPro = loggedIn && isPaidTier(tier);

  function selectTab(next: OverlayNav) {
    lastOverlayNav = next;
    setView("main");
    setHelp(null);
    setTab(next);
  }

  const openAuth = useCallback((mode: "login" | "signup") => {
    setAuthMode(mode);
    setHelp(null);
    setView("auth");
  }, []);

  const openUpgrade = useCallback(
    (placement: string) => {
      trackEvent("upgrade.opened", { placement });
      setHelp(null);
      setView("plans");
    },
    [],
  );

  function openPurchaseCost(skuId: string) {
    setCostFocus({ skuId, token: Date.now() });
    selectTab("products");
  }

  function openProducts(filter: ProductFilter) {
    setFilterRequest({ filter, token: Date.now() });
    selectTab("products");
  }

  function bucketToFilter(bucket: BoardBucket): ProductFilter {
    return bucket === "losing" ? "losing" : bucket === "thin" ? "below-target" : bucket === "healthy" ? "healthy" : "missing-cost";
  }

  // "Pro unlocked" moment: fires once when the plan goes from Free to paid while the panel is open.
  useEffect(() => {
    if (!isPaidTier(lastTier.current) && isPaidTier(tier) && loggedIn) {
      setBanner({ ok: true, message: "Pro unlocked. Every lock is open." });
      setView((current) => (current === "plans" ? "main" : current));
    }
    lastTier.current = tier;
  }, [tier, loggedIn]);

  useEffect(() => {
    trackEvent("overlay.shown", { pageType });
    trackEvent("scrape.result", {
      pageType,
      titleFound: product.title !== "Untitled product",
      priceFound: product.listPrice > 0,
      selectorVersion: SELECTOR_VERSION,
    });
  }, [pageType, product.skuId, product.title, product.listPrice]);

  useEffect(() => {
    setCollapsed(settings.overlayCollapsed);
  }, [settings.overlayCollapsed]);

  // The plan comes from the API through the service worker. A missing answer
  // (offline, signed out) must never downgrade a Pro account to Free.
  useEffect(() => {
    let cancel = false;
    void (async () => {
      if (!loggedIn) {
        setUserEmail(null);
        setView("main");
        setTier("free");
        return;
      }
      setView((current) => (current === "auth" ? "main" : current));
      try {
        const me = await fetchMe();
        if (cancel) return;
        setConnectionLost(false);
        setUserEmail(me?.email ?? null);
        const next = tierFromProfile(me);
        if (next) setTier(next);
      } catch (err: unknown) {
        if (cancel) return;
        setConnectionLost(err instanceof ApiError && err.message === CONNECTION_LOST);
        const cached = await readTier();
        if (!cancel && cached) setTier(cached);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [loggedIn]);

  useEffect(() => {
    if (!loggedIn) {
      setTier("free");
      return;
    }
    // The cache only holds answers the API gave.
    setTier(accountTier);
  }, [accountTier, loggedIn]);

  const refreshSkus = useCallback(async () => {
    const res = await sendMessage({ type: "GET_SKUS" });
    if (res.ok && res.skus) setSkus(res.skus);
  }, []);

  useEffect(() => {
    void refreshSkus();
  }, [product.skuId, refreshSkus]);

  useEffect(() => {
    void sendMessage({ type: "GET_LOCAL", keys: ["firstRun"] }).then((res) => {
      const flag = res.ok ? (res.local?.firstRun as { dismissed?: boolean } | undefined) : undefined;
      setChecklistDismissed(Boolean(flag?.dismissed));
    });
  }, []);

  const refreshSps = useCallback(async () => {
    const res = await sendMessage({ type: "GET_SPS" });
    setSps(res.ok && res.sps ? res.sps : null);
  }, []);

  useEffect(() => {
    void refreshSps();
  }, [refreshSps]);

  useEffect(() => {
    function onPush(message: { type?: string; keys?: string[] }) {
      if (message?.type !== "STORAGE_PUSH") return;
      const keys = message.keys ?? [];
      if (keys.includes("sps")) void refreshSps();
      if (keys.includes("skus")) void refreshSkus();
      if (keys.includes("subscription") || keys.includes("proJustUnlocked")) {
        void readTier().then((next) => {
          if (next) setTier(next);
        });
      }
    }
    chrome.runtime.onMessage.addListener(onPush);
    return () => chrome.runtime.onMessage.removeListener(onPush);
  }, [refreshSkus, refreshSps]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function resync() {
      const next = parseProductPage();
      setProduct(next);
      if (next.hints.pageMissing) {
        setTitle("Untitled product");
        setListPrice(0);
        setUnitsSold(0);
        setScrapeFailed(true);
        return;
      }
      if (next.title && next.title !== "Untitled product") setTitle(next.title);
      if (sellingPrice(next) > 0) setListPrice(sellingPrice(next));
      setListPriceOriginal(next.promoPrice ? next.listPrice : next.listPriceOriginal ?? null);
      if (next.unitsSold > 0) setUnitsSold(next.unitsSold);
      if (next.scrapeStatus === "complete" || next.hints.hasTitle || next.listPrice > 0) {
        setScrapeFailed(false);
      }
    }
    function debounced() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(resync, 250);
    }
    const onPageEdit = (event: Event) => {
      // Typing in the panel must not re-parse the page. That resync replaces the field mid-keystroke.
      const inside = event.composedPath().some((node) => node instanceof HTMLElement && node.id === "tiktok-seller-tool-root");
      if (!inside) debounced();
    };
    document.addEventListener("input", onPageEdit, true);
    document.addEventListener("change", onPageEdit, true);
    // Named timer: overlay resync (2000ms). Ticks read the cached plan
    // (GET_TIER, no network). One forced check ~10s after open catches
    // sign-out-everywhere inside the 15s window. Repeating it would blow the
    // two-requests-a-minute cap on /auth/me.
    let forcedSessionCheck = false;
    let ticks = 0;
    const interval = setInterval(() => {
      resync();
      ticks += 1;
      const checkSession = !forcedSessionCheck && ticks >= 5;
      if (checkSession) forcedSessionCheck = true;
      void sendMessage(checkSession ? { type: "AUTH_STATUS", force: true } : { type: "GET_TIER" }).then((status) => {
        if (!status?.ok) {
          if (status?.error === "Extension reloaded. Refresh this tab.") {
            setBanner({ ok: false, message: status.error });
          }
          return;
        }
        if (!status.loggedIn) return;
        if (status.tier === "free" || status.tier === "pro" || status.tier === "diamond") setTier(status.tier);
        // The load-time profile read can miss. The forced check already asked
        // the server; keep that address if the field is still empty.
        if (checkSession && !userEmailRef.current && status.email) setUserEmail(status.email);
      });
    }, 2000);
    const failTimer = setTimeout(() => {
      setProduct((current) => {
        const empty =
          current.scrapeStatus !== "complete" &&
          current.listPrice <= 0 &&
          !current.hints.hasTitle;
        if (empty && pageType === "productEdit") setScrapeFailed(true);
        return current;
      });
    }, 8000);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("input", onPageEdit, true);
      document.removeEventListener("change", onPageEdit, true);
      clearInterval(interval);
      clearTimeout(failTimer);
    };
  }, []);

  // Set once the seller types into this product's costs. After that, a late load of the
  // saved record (it reruns whenever settings change) must not wipe what they typed.
  const editedSku = useRef<string | null>(null);
  function editDraft(next: CostDraft) {
    editedSku.current = product.skuId ?? null;
    setDraft(next);
  }

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const res = await sendMessage({ type: "GET_SKUS" });
      if (cancel) return;
      const keepTyped = Boolean(product.skuId) && editedSku.current === product.skuId;
      if (product.hints.pageMissing || !product.skuId) {
        setCostSource("default");
        setDraft(defaultsFrom(settings));
        setListPrice(0);
        return;
      }
      const match = res.ok && res.skus ? res.skus.find((s) => s.skuId === product.skuId) : undefined;
      const source = match?.costSource ?? "default";
      setCostSource(source);
      setSamplesSent(match?.samplesSent ?? 0);
      setSampleUnitCost(match?.sampleUnitCost);
      setActualFees(match?.actualFees);
      if (match) {
        if (match.title) {
          setTitle((current) => (current && current !== "Untitled product" ? current : match.title));
        }
        if (match.listPrice > 0) {
          setListPrice((current) => (current > 0 ? current : match.listPrice));
        }
      }
      if (keepTyped) return;
      if (match && source !== "default") {
        setDraft({
          cogsPerUnit: match.cogsPerUnit,
          shippingOut: match.shippingOut,
          packagingPerUnit: match.packagingPerUnit ?? settings.packagingPerUnit,
          adsPerUnit: match.adsPerUnit,
          affiliatePct: match.affiliatePct ?? settings.affiliateCommissionPct,
        });
        if (match.unitsSold > 0) setUnitsSold((u) => (u > 0 ? u : match.unitsSold));
        if (match.listPrice > 0) setListPrice((p) => (p > 0 ? p : match.listPrice));
        return;
      }
      setDraft(defaultsFrom(settings));
    })();
    return () => {
      cancel = true;
    };
  }, [product.hints.pageMissing, product.skuId, settings]);

  const shippingInCost = effectiveShippingPerUnit(
    draft.shippingOut,
    settings.shippingPassedToBuyer ?? true,
  );
  const needsCost = costSource === "default" && draft.cogsPerUnit === 0;
  const priceKnown = listPrice > 0 && !product.hints.pageMissing;

  useEffect(() => {
    const timer = setTimeout(() => setPriceWaitDone(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    void sendMessage({ type: "REMOVE_LOCAL", keys: ["proJustUnlocked"] });
  }, []);

  // Same economics as the Products tab and the board: one code path, so a product
  // never shows two different nets. Includes the refund admin fee for typed costs.
  const input: ProfitInput = useMemo(
    () =>
      profitInputFor(
        {
          skuId: product.skuId || "page-sku",
          title,
          listPrice,
          cogsPerUnit: draft.cogsPerUnit,
          shippingOut: draft.shippingOut,
          adsPerUnit: draft.adsPerUnit,
          unitsSold,
          refundRatePct: settings.refundRatePct,
          netMarginPct: 0,
          netProfit: 0,
          sourceUrl: "",
          updatedAt: "",
          packagingPerUnit: draft.packagingPerUnit,
          affiliatePct: draft.affiliatePct,
          costSource: actualFees ? "settlement" : costSource,
          samplesSent,
          sampleUnitCost,
          actualFees,
        },
        settings,
      ),
    [product.skuId, title, listPrice, unitsSold, draft, settings, actualFees, costSource, samplesSent, sampleUnitCost],
  );

  const result = useMemo(() => computeProfit(input), [input]);
  const unitResult = useMemo(
    () => computeProfit({ ...input, unitsSold: 1, orderCount: 1 }),
    [input],
  );
  const guard = priceKnown ? priceGuard(input, settings.targetMarginPct) : ({ kind: "ok" } as const);
  const tone = marginTone(result.netPerUnit, result.netMarginPct, settings.targetMarginPct);
  const singleProductPage = pageType === "productEdit" || pageType === "productCreate";
  const showOverview = singleProductPage && (!loggedIn || tab === "overview");
  const listed = useMemo(
    () => (pageType === "productList" ? parseProductListPage(document, window.location.href) : []),
    [pageType],
  );
  const stats = useMemo(() => portfolioStats(skus, settings), [skus, settings]);
  const portfolio =
    pageType === "productList"
      ? {
          count: listed.length,
          missing: countMissingCosts(listed, skus),
          losing: stats.losing,
          leak: stats.leak,
        }
      : undefined;
  const costsSaved = skus.filter((sku) => (sku.costSource ?? "default") !== "default").length;
  const flagTier = tier === "diamond" ? "diamond" : isPaidTier(tier) ? "pro" : "free";
  const creatorsOn = flagEnabled("creatorProfit", flagTier);
  // Kill switch for the chip MarginMark puts next to TikTok's own price field.
  const priceChipOn = flagEnabled("promoGuard", flagTier);
  const nav = NAV_ALL.filter(([id]) => id !== "creators" || creatorsOn);
  // Value before the paywall: what MarginMark already found in this seller's own numbers.
  const receipt =
    stats.losing > 0
      ? stats.leak > 0
        ? `MarginMark already found ${formatUsd(stats.leak)} lost on ${stats.losing} product${stats.losing === 1 ? "" : "s"}. Pro shows the fix${stats.losing === 1 ? "" : " for each"}.`
        : stats.losing === 1
          ? "1 of your products loses money on every sale. Pro shows the fix."
          : `${stats.losing} of your products lose money on every sale. Pro shows the fix for each.`
      : null;

  useEffect(() => {
    const loss = guard.kind === "loss";
    if (loss && !wasLoss.current) {
      trackEvent("promo_guard.shown", { promo: listPriceOriginal != null && listPriceOriginal > listPrice });
      setPulse(true);
      const timer = window.setTimeout(() => setPulse(false), 1200);
      wasLoss.current = true;
      return () => window.clearTimeout(timer);
    }
    if (!loss) wasLoss.current = false;
  }, [guard, listPrice, listPriceOriginal]);

  // Counted once per panel: the free seller saw MarginMark's dollar finding before the paywall.
  const receiptSeen = useRef(false);
  useEffect(() => {
    if (!receipt || isPro || !(limitHit || tab === "products") || receiptSeen.current) return;
    receiptSeen.current = true;
    trackEvent("value_receipt.viewed", { losing: stats.losing, hasLeak: stats.leak > 0, placement: limitHit ? "limit" : "products" });
  }, [receipt, isPro, limitHit, tab, stats.losing, stats.leak]);

  useEffect(() => {
    if (!priceKnown || !priceChipOn) {
      clearPriceGuardChip();
      return;
    }
    const text = guardCopy(guard, isPro);
    const toneChip = guard.kind === "loss" ? "red" : guard.kind === "below-target" && isPro ? "amber" : null;
    syncPriceGuardChip(text, toneChip);
    return () => clearPriceGuardChip();
  }, [guard, isPro, priceKnown, listPrice, priceChipOn]);

  async function persistCollapsed(next: boolean) {
    setCollapsed(next);
    onCollapsedChange?.(next);
    await sendMessage({
      type: "SAVE_SETTINGS",
      settings: { ...settings, overlayCollapsed: next },
    });
  }

  async function persistSettings(next: Settings) {
    const res = await sendMessage({ type: "SAVE_SETTINGS", settings: next });
    setSaveStatus(res.ok ? "Settings saved" : "Couldn't save settings. Try again.");
  }

  async function persistCosts(next: CostDraft, samples = samplesSent, unitCost = sampleUnitCost) {
    const source: CostSource = costSource === "settlement" ? "settlement" : "custom";
    const skuKey = product.skuId || title.slice(0, 64) || "page-sku";
    const existing = skus.find((row) => row.skuId === skuKey);
    const sold = unitsSold > 0 ? unitsSold : existing?.unitsSold ?? 0;
    const sku: SkuRecord = {
      skuId: skuKey,
      skuIds: product.skuIds && product.skuIds.length > 0 ? product.skuIds : existing?.skuIds,
      title: title || "Product",
      listPrice,
      listPriceOriginal: existing?.listPriceOriginal ?? null,
      cogsPerUnit: next.cogsPerUnit,
      shippingOut: next.shippingOut,
      adsPerUnit: next.adsPerUnit,
      unitsSold: sold,
      salesPeriod: existing?.salesPeriod,
      refundRatePct: settings.refundRatePct,
      netMarginPct: 0,
      netProfit: 0,
      sourceUrl: window.location.href,
      updatedAt: new Date().toISOString(),
      packagingPerUnit: next.packagingPerUnit,
      affiliatePct: next.affiliatePct,
      affiliateSharePct: settings.affiliateSharePct,
      costSource: source,
      samplesSent: samples,
      sampleUnitCost: unitCost,
      actualFees: source === "settlement" ? actualFees : undefined,
    };
    const profit = computeProfit(profitInputFor(sku, settings));
    sku.netMarginPct = profit.netMarginPct ?? 0;
    sku.netProfit = profit.netProfit;
    const res = await sendMessage({ type: "SAVE_SKU", sku });
    if (needsCost && next.cogsPerUnit > 0) trackEvent("cost.first_entered");
    if (!res.ok && /free tier limit|costs saved|limit/i.test(res.error || "")) {
      trackEvent("sku.limit_hit");
      setLimitHit(true);
    }
    if (res.ok) {
      setLimitHit(false);
      setCostSource(source);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
      void refreshSkus();
    } else {
      setSaveStatus(res.error || "Couldn't save this product.");
    }
  }

  // The latest persistCosts (it reads current state), for the flush below.
  const persistRef = useRef(persistCosts);
  persistRef.current = persistCosts;
  const pendingSave = useRef<CostDraft | null>(null);

  function scheduleSave(next: CostDraft) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingSave.current = next;
    // Don't show "Saved" for an edit that hasn't been written yet.
    setSaved(false);
    saveTimer.current = setTimeout(() => {
      pendingSave.current = null;
      void persistCosts(next);
    }, 400);
  }

  // A seller who types a cost and leaves (closes the panel, the tab, or Seller Center
  // navigates) inside the 400ms debounce must not lose the edit.
  useEffect(() => {
    const flush = () => {
      const next = pendingSave.current;
      if (!next) return;
      pendingSave.current = null;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void persistRef.current(next);
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
      flush();
    };
  }, []);

  async function addSample() {
    const next = samplesSent + 1;
    const unit = sampleUnitCost ?? draft.cogsPerUnit + shippingInCost;
    setSamplesSent(next);
    setSampleUnitCost(unit);
    await persistCosts(draft, next, unit);
  }

  async function handleLogout() {
    lastOverlayNav = "overview";
    setTab("overview");
    setView("main");
    await logout();
    onAuthed?.();
  }

  async function syncNow() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await autoSyncSkusFromPage(true);
      await refreshSkus();
      if (res.skipped > 0 && !res.saved) {
        setSyncMsg("Couldn't save some products. The data looked invalid.");
      } else if (res.found > 0) {
        setSyncMsg(
          res.saved
            ? `Imported ${res.saved} from this page.${!isPro && res.saved > FREE_SKU_LIMIT ? " Price-only rows are unlimited." : ""}`
            : `Found ${res.found}. Already up to date.`,
        );
      } else {
        setSyncMsg("Nothing to import here. Open Manage products or a listing.");
      }
    } catch {
      if (pageType === "productEdit" || pageType === "productCreate") {
        setSyncMsg("Couldn't read this page. Try refreshing it.");
      }
    } finally {
      setSyncing(false);
    }
  }

  async function dismissChecklist() {
    setChecklistDismissed(true);
    await sendMessage({ type: "SET_LOCAL", values: { firstRun: { dismissed: true } } });
  }

  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(null), 5000);
    return () => window.clearTimeout(timer);
  }, [banner]);

  const showChecklist = !checklistDismissed && costsSaved < 3 && skus.length > 0;
  const checklist = (
    <FirstRunChecklist
      productCount={skus.length}
      costsSaved={costsSaved}
      onAddCosts={() => {
        trackEvent("onboarding.step", { step: "add-costs" });
        openProducts("missing-cost");
      }}
      onSeeLosers={() => {
        trackEvent("onboarding.step", { step: "see-losers" });
        openProducts("losing");
      }}
      onDismiss={() => {
        trackEvent("onboarding.step", { step: "dismissed" });
        void dismissChecklist();
      }}
    />
  );
  const netTone = TONE[toneForNet(result.netPerUnit, priceKnown && !needsCost)];
  const dot = needsCost ? "bg-slate-400" : tone === "profit" ? "bg-emerald-500" : tone === "warning" ? "bg-amber-500" : "bg-red-600";

  if (collapsed) {
    return (
      <div
        className="flex w-[68px] flex-col items-center rounded-l-xl border border-r-0 border-slate-200 bg-white text-slate-900 shadow-xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close overlay"
          className="w-full rounded-tl-xl py-1 text-base text-slate-500 hover:bg-slate-100"
          onClick={onDismiss}
        >
          ×
        </button>
        <button
          type="button"
          className="flex flex-col items-center gap-1 px-1 pb-2.5 pt-0.5"
          title="Open MarginMark"
          aria-label="Open MarginMark"
          onClick={() => void persistCollapsed(false)}
        >
          <MarkLogo size={28} />
          <span className={`h-2 w-2 rounded-full ${dot} ${pulse ? "animate-pulse" : ""}`} />
          <span className={cx("text-xs font-extrabold tabular-nums leading-tight", needsCost || !priceKnown ? "text-slate-600" : netTone.text)}>
            {needsCost ? "Add cost" : priceKnown ? formatSignedUsd(result.netPerUnit) : "—"}
          </span>
        </button>
      </div>
    );
  }

  const shownView = shownOverlayView(view, loggedIn);
  const inMain = shownView === "main" && !help;
  const losingCount = stats.losing;

  return (
    <UpgradeContext.Provider value={openUpgrade}>
      <div
        className="max-h-[min(620px,calc(100vh-32px))] w-[400px] overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl tabular-nums"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {LLE_TEST_BANNER ? (
          <p className="bg-amber-100 px-3 py-1 text-center text-xs font-semibold text-amber-950">{LLE_TEST_BANNER}</p>
        ) : null}

        {shownView === "support" && (
          <SupportCenter
            onClose={() => setView("main")}
            context={{ version: extensionVersion(), pageType, priceRead: priceKnown, plan: tier }}
            defaultEmail={userEmail ?? ""}
            defaultKind="problem"
          />
        )}

        {shownView === "account" && loggedIn && (
          <ProfilePanel
            defaultEmail={userEmail ?? ""}
            costsSaved={costsSaved}
            onClose={() => setView("main")}
            onLogout={() => {
              setView("main");
              void handleLogout();
            }}
            onAccountChanged={() => {
              void readTier().then((next) => {
                if (next) setTier(next);
              });
              void fetchMe()
                .then((me) => setUserEmail(me?.email ?? null))
                .catch(() => undefined);
            }}
          />
        )}

        {shownView === "plans" && (
          <div className="space-y-3 px-4 py-4">
            <button
              type="button"
              onClick={() => setView("main")}
              className="-ml-1 flex items-center gap-0.5 rounded-md px-1 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              <ChevronLeftIcon size={16} /> Back
            </button>
            {!loggedIn ? (
              <div className="space-y-3">
                <h2 className="text-base font-bold text-slate-900">Create a free account to go Pro</h2>
                <p className="text-xs text-slate-600">Your plan is tied to your account, so it follows you across devices.</p>
                <OverlayAuth onOpen={openAuth} />
              </div>
            ) : (
              <PlanPicker
                placement="plans"
                onNeedVerify={() => setView("account")}
                onUnlocked={() =>
                  void readTier().then((next) => {
                    if (next) setTier(next);
                  })
                }
                me={undefined}
              />
            )}
          </div>
        )}

        {shownView === "auth" && !loggedIn && (
          <div className="space-y-3 px-4 py-4">
            <button
              type="button"
              onClick={() => setView("main")}
              className="-ml-1 flex items-center gap-0.5 rounded-md px-1 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              <ChevronLeftIcon size={16} /> Back
            </button>
            <LoginScreen
              defaultMode={authMode}
              onAuthChange={() => {
                setView("main");
                onAuthed?.();
              }}
            />
          </div>
        )}

        {help && shownView === "main" && <HelpPanel topic={help} onClose={() => setHelp(null)} />}

        {inMain && (
          <>
            <OverlayHeader
              title={title}
              listPrice={listPrice}
              listPriceOriginal={listPriceOriginal}
              unitsSold={unitsSold}
              netPerUnit={result.netPerUnit}
              netMarginPct={result.netMarginPct ?? 0}
              tone={tone}
              priceKnown={priceKnown}
              costKnown={!needsCost}
              guard={guard}
              showTargetGuard={isPro}
              isPro={isPro}
              planLabel={tier === "diamond" ? "Diamond" : "Pro"}
              portfolio={portfolio}
              lifetimeProfit={unitsSold > 0 ? result.netProfit : null}
              loggedIn={loggedIn}
              costEntry={
                singleProductPage && priceKnown && needsCost
                  ? {
                      onCommit: (value) => {
                        const next = { ...draft, cogsPerUnit: value };
                        editDraft(next);
                        void persistCosts(next);
                      },
                    }
                  : undefined
              }
              onAccount={() => {
                setHelp(null);
                setView("account");
              }}
              onUpgrade={() => openUpgrade("header")}
              onMinimize={() => void persistCollapsed(true)}
              onClose={onDismiss}
            />

            {connectionLost && (
              <div className="px-4 pt-3">
                <Alert tone="warning">{CONNECTION_LOST} Profit on this page still works.</Alert>
              </div>
            )}
            {banner && (
              <div className="px-4 pt-3">
                <Alert tone={banner.ok ? "ok" : "loss"}>{banner.message}</Alert>
              </div>
            )}

            {!loggedIn && <OverlayAuth onOpen={openAuth} />}

            <SpsStrip sps={sps} showHint={loggedIn && pageType === "productList" && tab === "overview"} />

            {loggedIn && (
              <nav className="flex gap-1 border-b border-slate-100 px-3 py-2" aria-label="MarginMark sections">
                {nav.map(([id, label]) => {
                  const Icon = NAV_ICON[id];
                  const active = tab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500",
                        active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
                      )}
                      onClick={() => selectTab(id)}
                    >
                      <Icon size={14} />
                      {label}
                      {id === "products" && losingCount > 0 && (
                        <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-4 text-white">{losingCount}</span>
                      )}
                    </button>
                  );
                })}
              </nav>
            )}

            {loggedIn && tab === "overview" && pageType === "productList" && showChecklist && (
              <div className="pt-3">{checklist}</div>
            )}

            {showOverview && product.hints.pageMissing && (
              <div className="px-4 pt-3">
                <Alert tone="loss">This page didn't load. Profit isn't shown until the product page opens.</Alert>
              </div>
            )}
            {showOverview && scrapeFailed && !product.hints.pageMissing && (
              <div className="px-4 pt-3">
                <Alert tone="warning">Couldn't read the price on this page. Enter it below.</Alert>
              </div>
            )}
            {showOverview && !priceKnown && !scrapeFailed && !priceWaitDone && (
              <div className="space-y-2 px-4 py-4" aria-label="Reading the page">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-3 animate-pulse rounded bg-slate-100" />
                ))}
              </div>
            )}
            {showOverview && !product.hints.pageMissing && !priceKnown && (priceWaitDone || scrapeFailed) && (
              <label className="mx-4 mt-3 flex flex-col gap-1 text-xs font-semibold text-slate-700">
                Selling price
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  autoFocus
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                  value={listPrice || ""}
                  onChange={(e) => setListPrice(e.target.value === "" ? 0 : Number(e.target.value))}
                />
              </label>
            )}

            {showOverview && !product.hints.pageMissing && priceKnown && (
              <div className="space-y-3 py-3">
                {limitHit && !isPro && (
                  <div className="mx-4">
                    <Alert tone="warning">
                      You've used all your free product costs. <button type="button" className="font-bold underline" onClick={() => openUpgrade("limit")}>Unlock unlimited</button>
                      {receipt && <span className="mt-1 block font-normal">{receipt}</span>}
                    </Alert>
                  </div>
                )}
                {!needsCost && (
                  <CostInputs
                    draft={draft}
                    showShipping={!settings.shippingPassedToBuyer}
                    costSource={costSource}
                    periodLabel={actualFees?.periodLabel}
                    saved={saved}
                    onChange={editDraft}
                    onBlur={(next) => {
                      editDraft(next);
                      scheduleSave(next);
                    }}
                    onHelp={(topic) => setHelp(topic)}
                  />
                )}
                {!needsCost && (
                  <>
                    {isPro ? (
                      <>
                        <CommissionCard
                          input={input}
                          currentPct={input.affiliatePct ?? 0}
                          creatorNet={result.netPerUnitCreator}
                          targetMarginPct={settings.targetMarginPct}
                          isPro
                          losing={tone === "loss"}
                        />
                        <AdsCard input={input} targetMarginPct={settings.targetMarginPct} isPro />
                      </>
                    ) : (
                      <div className="mx-4">
                        <ProLock
                          placement="insights"
                          title={tone === "loss" ? "See the fix for this loss" : "Max commission & ad limits"}
                          blurb={
                            tone === "loss"
                              ? `You lose ${formatUsd(Math.abs(result.netPerUnit))} a sale. Pro shows the commission, ad, and price limits that turn it green.`
                              : "Pro shows the most you can pay creators and spend on ads and still hit your margin goal."
                          }
                          preview={INSIGHT_PREVIEW}
                        />
                      </div>
                    )}
                    <CostWaterfall
                      result={unitResult}
                      settings={settings}
                      units={1}
                      cogsPerUnit={draft.cogsPerUnit}
                      shippingInCost={shippingInCost}
                      adsPerUnit={draft.adsPerUnit}
                      affiliatePct={input.affiliatePct ?? 0}
                      affiliateSharePct={input.affiliateSharePct ?? 0}
                    />
                    {isPro && flagEnabled("whatIf", flagTier) && (
                      <WhatIfPanel
                        key={`${listPrice}-${draft.affiliatePct}-${draft.adsPerUnit}`}
                        base={input}
                        targetMarginPct={settings.targetMarginPct}
                        isPro
                      />
                    )}
                    {isPro && (
                      <div className="mx-4">
                        <Button variant="secondary" size="sm" onClick={() => void addSample()}>
                          +1 free sample sent{samplesSent > 0 ? ` (${samplesSent})` : ""}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {loggedIn && tab === "overview" && singleProductPage && showChecklist && !needsCost && (
              <div className="pb-3">{checklist}</div>
            )}

            {loggedIn && tab === "overview" && !singleProductPage && (
              <WeeklyRecap skus={skus} settings={settings} isPro={isPro} />
            )}

            {pageType === "productList" && tab === "overview" && (
              <ProfitBoard
                skus={skus}
                settings={settings}
                isPro={isPro}
                onHelp={(topic) => setHelp(topic)}
                onAddCost={openPurchaseCost}
                onOpenProducts={(bucket) => openProducts(bucketToFilter(bucket))}
              />
            )}

            {loggedIn && !singleProductPage && pageType !== "productList" && tab === "overview" && (
              <p className="mx-4 my-3 rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-600">
                Open <b>Manage products</b> or a product to see profit. Open the Products tab to see everything you've synced.
              </p>
            )}

            {loggedIn && tab === "products" && (
              <div className="space-y-3 px-4 py-3">
                <AutoSyncBar
                  tabUrl={window.location.href}
                  skuCount={skus.length}
                  syncing={syncing}
                  lastMessage={syncMsg}
                  onSync={() => void syncNow()}
                />
                <SkuDashboard
                  skus={skus}
                  isPro={isPro}
                  settings={settings}
                  editCost={costFocus}
                  filterRequest={filterRequest}
                  onHelp={(topic) => setHelp(topic)}
                />
              </div>
            )}

            {loggedIn && tab === "creators" && creatorsOn && (
              <div className="px-4 py-3">
                <CreatorBoard skus={skus} settings={settings} isPro={isPro} />
              </div>
            )}

            {loggedIn && tab === "settings" && (
              <SettingsPanel
                settings={settings}
                onSave={(n) => persistSettings(n)}
                onLogout={() => void handleLogout()}
                userEmail={userEmail}
                saveStatus={saveStatus}
                onOpenAccount={() => setView("account")}
                onAccountChanged={() => {
                  void readTier().then((next) => {
                    if (next) setTier(next);
                  });
                  void fetchMe()
                    .then((me) => setUserEmail(me?.email ?? null))
                    .catch(() => undefined);
                }}
              />
            )}
          </>
        )}

        {(inMain || shownView === "plans" || shownView === "account" || shownView === "auth") && (
          <footer className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
            <span>Not affiliated with or endorsed by TikTok.</span>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-semibold text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              onClick={() => {
                setHelp(null);
                setView("support");
              }}
            >
              <HelpIcon size={14} /> Help &amp; support
            </button>
          </footer>
        )}
        
      </div>
    </UpgradeContext.Provider>
  );
}
