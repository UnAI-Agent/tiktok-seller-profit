import { useCallback, useEffect, useState } from "react";
import SkuDashboard from "../dashboard/SkuDashboard";
import CreatorPerformance from "../dashboard/CreatorPerformance";
import { fetchMe, getStoredToken, logout, trackEvent } from "../lib/apiClient";
import { AUTH_EXPIRED_EVENT, isConnectionError } from "../lib/apiErrors";
import { isSellerCenterUrl } from "../lib/sellerUrl";
import { sendMessage } from "../lib/messages";
import { refreshSubscriptionCache } from "../lib/subscription";
import { DEFAULT_SETTINGS, type Settings } from "../types/settings";
import type { SkuRecord } from "../types/sku";
import AuthSplash from "./AuthSplash";
import AutoSyncBar from "./AutoSyncBar";
import InactivePopup from "./InactivePopup";
import LoginScreen from "./LoginScreen";
import PopupHeader from "./PopupHeader";
import ProUpsell from "./ProUpsell";
import SettingsPanel from "./SettingsPanel";
import SupportScreen from "./SupportScreen";

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
        setIsPro(tier === "pro");
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
    await refreshAuth();
    setAuthChecked(true);
    await refreshSkus();
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
  const showInactive =
    isLoggedIn &&
    screen === "main" &&
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
        setIsPro(next?.tier === "pro");
      }
      if (changes.authToken) {
        void refreshAuth();
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
        : "TikTok Seller Tool";

  if (!authChecked) {
    return (
      <div className="flex w-[380px] min-h-[420px] flex-col items-center justify-center p-4 font-sans text-slate-500">
        <div className="h-8 w-8 animate-pulse rounded-full bg-slate-200" />
        <p className="mt-3 text-sm">Loading…</p>
      </div>
    );
  }

  return (
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

      {showSplash && (
        <AuthSplash
          onLogIn={() => openLogin("login")}
          onSignUp={() => openLogin("signup")}
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
          <SupportScreen />
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

      {screen === "main" && isLoggedIn && !showInactive && (
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
                ["summary", "Summary"],
                ["skus", "SKUs"],
                ["settings", "Settings"],
                ["creators", "Creators"],
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
              <div className="space-y-3 text-sm">
                <p className="text-slate-600">
                  Overlay is {settings.overlayEnabled ? "on" : "off"} on Seller
                  Center. Price, units, and SKUs update automatically — use − to
                  dock the panel.
                </p>
                <ProUpsell isPro={isPro} featureLabel="Upgrade to Pro" />
              </div>
            )}

            {tab === "skus" && <SkuDashboard skus={skus} isPro={isPro} />}

            {tab === "settings" && (
              <SettingsPanel
                settings={settings}
                onSave={(n) => persistSettings(n)}
                onLogout={() => void handleLogout()}
                userEmail={userEmail}
                saveStatus={status}
              />
            )}

            {tab === "creators" && <CreatorPerformance isPro={isPro} />}
          </div>
        </>
      )}

      {status && screen === "main" && isLoggedIn && tab !== "settings" && (
        <p className="mt-2 text-center text-xs text-slate-400">{status}</p>
      )}
    </div>
  );
}
