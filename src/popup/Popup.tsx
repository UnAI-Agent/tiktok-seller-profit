import { useCallback, useEffect, useMemo, useState } from "react";
import SkuDashboard from "../dashboard/SkuDashboard";
import CreatorPerformance from "../dashboard/CreatorPerformance";
import { EXTENSION_SHORT_NAME } from "../config";
import { fetchMe, fetchRemoteConfig, getStoredToken, logout, trackEvent, createCheckoutUrl } from "../lib/apiClient";
import { acceptPublishedConfig, announcementFromVerified } from "../lib/remoteConfig";
import { AUTH_EXPIRED_EVENT, isConnectionError } from "../lib/apiErrors";
import { portfolioStats } from "../lib/diagnose";
import { formatUsd } from "../lib/profit";
import { isSellerCenterUrl, MANAGE_PRODUCTS_LINK } from "../lib/sellerUrl";
import { sendMessage } from "../lib/messages";
import { refreshSubscriptionCache } from "../lib/subscription";
import { DEFAULT_SETTINGS, type Settings } from "../types/settings";
import type { SkuRecord } from "../types/sku";
import {
  bumpPopupOpenCount,
  dismissNudge,
  loadUxFlags,
  markWelcomeSeen,
  NUDGE_AFTER_OPENS,
  SHOW_CREATOR_DEMO,
} from "../lib/uxFlags";
import AuthSplash from "./AuthSplash";
import AutoSyncBar from "./AutoSyncBar";
import InactivePopup from "./InactivePopup";
import LoginScreen from "./LoginScreen";
import PopupHeader from "./PopupHeader";
import ProUpsell from "./ProUpsell";
import SettingsPanel from "./SettingsPanel";
import SoftNudge from "./SoftNudge";
import SupportScreen from "./SupportScreen";
import { UpgradeContext } from "../ui/upgrade";
import WelcomeGuide from "./WelcomeGuide";

type Tab = "summary" | "skus" | "settings" | "creators";
type PopupScreen = "main" | "login" | "support";

type SyncTabResponse = {
  ok?: boolean;
  found?: number;
  saved?: number;
  skipped?: number;
  source?: string;
};

export default function Popup() {
  const [screen, setScreen] = useState<PopupScreen>("main");
  const [loginMode, setLoginMode] = useState<"login" | "signup">("login");
  const [tab, setTab] = useState<Tab>("summary");
  const [focusMissing, setFocusMissing] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [skus, setSkus] = useState<SkuRecord[]>([]);
  const [tabUrl, setTabUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [forceSettings, setForceSettings] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [welcomeSeen, setWelcomeSeen] = useState(true);
  const [showNudge, setShowNudge] = useState(false);
  const [nudgeBusy, setNudgeBusy] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const refreshSkus = useCallback(async () => {
    const skusRes = await sendMessage({ type: "GET_SKUS" });
    if (skusRes.ok && skusRes.skus) setSkus(skusRes.skus);
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const me = await fetchMe();
      const loggedIn = !!me;
      setConnectionLost(false);
      setIsLoggedIn(loggedIn);
      setUserEmail(me?.email ?? null);
      if (loggedIn) {
        const tier = await refreshSubscriptionCache();
        setIsPro(tier === "pro" || tier === "diamond");
      } else {
        setIsPro(false);
      }
      return loggedIn;
    } catch (err) {
      if (isConnectionError(err)) {
        setConnectionLost(true);
        const token = await getStoredToken();
        const loggedIn = !!token;
        setIsLoggedIn(loggedIn);
        return loggedIn;
      }
      setIsLoggedIn(false);
      setUserEmail(null);
      setIsPro(false);
      return false;
    }
  }, []);

  const load = useCallback(async () => {
    const [settingsRes, tabs] = await Promise.all([
      sendMessage({ type: "GET_SETTINGS" }),
      chrome.tabs.query({ active: true, currentWindow: true }),
    ]);

    if (settingsRes.ok && settingsRes.settings) {
      setSettings(settingsRes.settings);
    }
    setTabUrl(tabs[0]?.url ?? "");
    await sendMessage({ type: "SCAN_OAUTH" });
    const loggedIn = await refreshAuth();
    setAuthChecked(true);
    const storedErr = await chrome.storage.local.get("oauthError");
    setOauthError(
      !loggedIn && typeof storedErr.oauthError === "string"
        ? storedErr.oauthError
        : null,
    );
    const flags = await loadUxFlags();
    setWelcomeSeen(flags.welcomeSeen);
    if (loggedIn) {
      const opens = await bumpPopupOpenCount();
      setShowNudge(
        flags.welcomeSeen && !flags.nudgeDismissed && opens >= NUDGE_AFTER_OPENS,
      );
    }
    await refreshSkus();
    const remote = await fetchRemoteConfig();
    const accepted = await acceptPublishedConfig(remote, null, Date.now());
    setAnnouncement(announcementFromVerified(accepted));
  }, [refreshSkus, refreshAuth]);

  useEffect(() => {
    void load();
  }, [load]);

  const syncFromActiveTab = useCallback(async () => {
    if (!isLoggedIn) return;
    setSyncing(true);
    setImportMessage(null);
    try {
      const [tabs] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs?.id || !isSellerCenterUrl(tabs.url ?? "")) {
        setImportMessage("Open a Seller Center tab first.");
        return;
      }
      const res = (await Promise.race([
        sendMessage({
          type: "SYNC_ACTIVE_TAB",
          tabId: tabs.id,
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("scrape-timeout")), 15_000);
        }),
      ])) as SyncTabResponse;
      await refreshSkus();
      if (typeof res?.skipped === "number" && res.skipped > 0 && !res.saved) {
        setImportMessage(
          `Couldn't save ${res.skipped} SKU(s) — free limit or invalid data.`,
        );
      } else if (res?.found && res.found > 0) {
        const src =
          res.source === "list"
            ? "product list"
            : res.source === "editor"
              ? "product editor"
              : "page";
        setImportMessage(
          res.saved
            ? `Imported ${res.saved} from ${src}.`
            : `Found ${res.found} on ${src} (already up to date).`,
        );
        trackEvent("popup.sku_sync", {
          found: res.found ?? 0,
          saved: res.saved ?? 0,
          source: res.source ?? "unknown",
        });
      } else {
        setImportMessage(
          "Nothing to import here. Try Manage products or open a product to edit.",
        );
      }
    } catch (err) {
      const timedOut =
        err instanceof Error && err.message === "scrape-timeout";
      setImportMessage(
        timedOut
          ? "Couldn't read page. Try refresh."
          : isConnectionError(err)
            ? "Connection lost. Check your internet."
            : "Sync failed — hard-refresh Manage products (Ctrl+Shift+R), then try again.",
      );
    } finally {
      setSyncing(false);
    }
  }, [refreshSkus, isLoggedIn]);

  const onSellerSite = isSellerCenterUrl(tabUrl);
  const showSplash = authChecked && !isLoggedIn && screen === "main";
  const showWelcome = isLoggedIn && screen === "main" && !welcomeSeen;
  const showInactive =
    isLoggedIn &&
    screen === "main" &&
    !showWelcome &&
    !onSellerSite &&
    !forceSettings &&
    tab !== "settings" &&
    tab !== "skus";

  useEffect(() => {
    if (!isLoggedIn || screen !== "main" || !isSellerCenterUrl(tabUrl)) return;
    void syncFromActiveTab();
  }, [tabUrl, syncFromActiveTab, screen, isLoggedIn]);

  useEffect(() => {
    function onStorage(
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) {
      if (area !== "local") return;
      if (changes.skus && isLoggedIn) void refreshSkus();
      if (changes.subscription) {
        const next = changes.subscription.newValue as { tier?: string } | undefined;
        setIsPro(next?.tier === "pro" || next?.tier === "diamond");
      }
      if (changes.authToken) {
        void refreshAuth().then((logged) => {
          if (logged) {
            setScreen("main");
            setOauthError(null);
          }
        });
      }
      if (changes.oauthError) {
        const next = changes.oauthError.newValue;
        setOauthError(typeof next === "string" ? next : null);
      }
    }
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, [refreshSkus, refreshAuth, isLoggedIn]);

  useEffect(() => {
    function onExpired() {
      setIsLoggedIn(false);
      setUserEmail(null);
      setIsPro(false);
      setScreen("login");
      setLoginMode("login");
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  async function persistSettings(next: Settings) {
    setSettings(next);
    const res = await sendMessage({ type: "SAVE_SETTINGS", settings: next });
    if (res.ok) {
      setStatus("Settings saved");
      await sendMessage({ type: "REFRESH_OVERLAY" });
      window.setTimeout(() => setStatus((s) => (s === "Settings saved" ? null : s)), 2500);
    } else {
      setStatus("Couldn't save settings. Try again.");
    }
  }

  async function handleLogout() {
    await logout();
    setIsLoggedIn(false);
    setUserEmail(null);
    setIsPro(false);
    setScreen("main");
  }

  function closePopup() {
    window.close();
  }

  function goMain() {
    setScreen("main");
  }

  async function handleAuthChange() {
    const loggedIn = await refreshAuth();
    if (loggedIn) setScreen("main");
  }

  async function skipWelcome() {
    await markWelcomeSeen();
    setWelcomeSeen(true);
  }

  async function handleNudgeUpgrade() {
    setNudgeBusy(true);
    try {
      const url = await createCheckoutUrl("monthly");
      await chrome.tabs.create({ url });
    } catch {
      setNudgeBusy(false);
    }
  }

  async function skipNudge() {
    await dismissNudge();
    setShowNudge(false);
  }

  function openLogin(mode: "login" | "signup") {
    setLoginMode(mode);
    setScreen("login");
  }

  const headerTitle =
    screen === "login"
      ? isLoggedIn
        ? "Account"
        : loginMode === "signup"
          ? "Sign up"
          : "Log in"
      : screen === "support"
        ? "Support"
        : EXTENSION_SHORT_NAME;

  if (!authChecked) {
    return (
      <div className="flex w-[380px] min-h-[420px] flex-col items-center justify-center p-4 font-sans text-slate-500">
        <div className="h-8 w-8 animate-pulse rounded-full bg-slate-200" />
        <p className="mt-3 text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <UpgradeContext.Provider value={() => void handleNudgeUpgrade()}>
    <div className="flex w-[380px] max-h-[600px] min-h-[420px] flex-col p-4 font-sans text-slate-900">
      <PopupHeader
        onClose={closePopup}
        onLoginClick={() => openLogin("login")}
        onSupportClick={() => {
          if (!isLoggedIn) {
            openLogin("login");
            return;
          }
          setScreen("support");
        }}
        onLogout={() => void handleLogout()}
        isLoggedIn={isLoggedIn}
        userEmail={userEmail}
        showBack={screen !== "main" && !(showSplash && screen === "main")}
        onBack={goMain}
        title={headerTitle}
        minimal={showSplash}
      />

      {connectionLost && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Connection lost. Check your internet.
        </p>
      )}

      {oauthError && !isLoggedIn && (
        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
          Google sign-in did not reach the extension. {oauthError}
        </p>
      )}

      {announcement && (
        <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          {announcement}
        </p>
      )}

      {showSplash && (
        <AuthSplash
          onLogIn={() => openLogin("login")}
          onSignUp={() => openLogin("signup")}
        />
      )}

      {showWelcome && (
        <WelcomeGuide
          settings={settings}
          worst={portfolioStats(skus, settings).worstCreatorLoss}
          onSave={persistSettings}
          onSkip={() => void skipWelcome()}
        />
      )}

      {screen === "login" && !showSplash && (
        <div className="mt-3 flex flex-1 flex-col overflow-hidden">
          <LoginScreen
            defaultMode={loginMode}
            onAuthChange={() => void handleAuthChange()}
          />
        </div>
      )}

      {screen === "support" && isLoggedIn && (
        <div className="mt-3 flex flex-1 flex-col overflow-hidden">
          <SupportScreen onClose={goMain} />
        </div>
      )}

      {screen === "main" && isLoggedIn && showInactive && (
        <InactivePopup
          onOpenSettings={() => {
            setForceSettings(true);
            setTab("settings");
          }}
        />
      )}

      {screen === "main" && isLoggedIn && !showInactive && !showWelcome && (
        <>
          <AutoSyncBar
            tabUrl={tabUrl}
            skuCount={skus.length}
            syncing={syncing}
            lastMessage={importMessage}
            onSync={() => void syncFromActiveTab()}
          />
          <nav className="mt-3 flex gap-1 text-xs">
            {(
              [
                ["summary", "Home"],
                ["skus", "Products"],
                ["settings", "Settings"],
                ...(SHOW_CREATOR_DEMO ? [["creators", "Creators"] as const] : []),
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`rounded-full px-2.5 py-1 ${
                  tab === id
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
                onClick={() => {
                  setTab(id);
                  if (id === "settings") setForceSettings(true);
                  if (id !== "settings" && !onSellerSite) setForceSettings(false);
                }}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="mt-3 flex-1 overflow-auto">
            {tab === "summary" && (
              <HomeSummary
                skus={skus}
                settings={settings}
                isPro={isPro}
                showNudge={showNudge}
                nudgeBusy={nudgeBusy}
                onUpgrade={() => void handleNudgeUpgrade()}
                onDismiss={() => void skipNudge()}
                onMissing={() => {
                  setFocusMissing(true);
                  setTab("skus");
                }}
              />
            )}

            {tab === "skus" && (
              <SkuDashboard skus={skus} isPro={isPro} settings={settings} focusMissing={focusMissing} />
            )}

            {tab === "settings" && (
              <SettingsPanel
                settings={settings}
                onSave={(n) => persistSettings(n)}
                onLogout={() => void handleLogout()}
                userEmail={userEmail}
                saveStatus={status}
                onAccountChanged={() => void refreshAuth()}
              />
            )}

            {SHOW_CREATOR_DEMO && tab === "creators" && <CreatorPerformance isPro={isPro} />}
          </div>
        </>
      )}

      {status && screen === "main" && isLoggedIn && tab !== "settings" && (
        <p className="mt-2 text-center text-xs text-slate-400">{status}</p>
      )}
    </div>
    </UpgradeContext.Provider>
  );
}

function HomeSummary({
  skus,
  settings,
  isPro,
  showNudge,
  nudgeBusy,
  onUpgrade,
  onDismiss,
  onMissing,
}: {
  skus: SkuRecord[];
  settings: Settings;
  isPro: boolean;
  showNudge: boolean;
  nudgeBusy: boolean;
  onUpgrade: () => void;
  onDismiss: () => void;
  onMissing: () => void;
}) {
  const stats = useMemo(() => portfolioStats(skus, settings), [skus, settings]);
  const meter = stats.total === 0 ? 0 : Math.round((stats.realCosts / stats.total) * 100);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-2xl font-semibold tabular-nums text-slate-900">
        {formatUsd(stats.leak)}
      </p>
      <p className="text-xs text-slate-600">
        Estimated leak on recorded sales · {stats.losing} products losing money
      </p>
      <button type="button" className="w-full text-left" onClick={onMissing}>
        <div className="mb-1 flex justify-between text-[11px] text-slate-600">
          <span>
            {stats.realCosts} / {stats.total} products have real costs
          </span>
          <span>{meter}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded bg-slate-100">
          <div className="h-full bg-slate-800" style={{ width: `${meter}%` }} />
        </div>
      </button>
      <button
        type="button"
        className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white"
        onClick={() => chrome.tabs.create({ url: MANAGE_PRODUCTS_LINK })}
      >
        Open Seller Center
      </button>
      {showNudge && !isPro ? (
        <SoftNudge busy={nudgeBusy} onUpgrade={onUpgrade} onDismiss={onDismiss} />
      ) : (
        <ProUpsell
          isPro={isPro}
          featureLabel="Pro shows the max commission and ad cost that keep a product profitable"
        />
      )}
    </div>
  );
}
