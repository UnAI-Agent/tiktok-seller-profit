import { API_BASE_URL, LLE_TEST_BANNER } from "../config";
import { refreshRemoteConfig } from "../lib/remoteConfig";
import { ApiError, errorTextFromJson } from "../lib/apiErrors";
import { postAuth } from "../lib/authCall";
import { exchangeOAuthTicket, getStoredToken, setStoredToken } from "../lib/apiClient";
import { getCachedTier, refreshSubscriptionCache } from "../lib/subscription";
import {
  isRuntimeMessage,
  type RuntimeResponse,
} from "../lib/messages";
import { parseOAuthDoneUrl } from "../lib/oauthCallback";
import { isSellerCenterUrl, SELLER_CENTER_LINK, SELLER_TAB_URL_PATTERNS } from "../lib/sellerUrl";
import { requestSkuSyncOnTab } from "../lib/tabBridge";
import { safeUrl } from "../lib/safeUrl";
import {
  FREE_SKU_LIMIT,
  getSettings,
  getSkus,
  getSps,
  removeSkuIds,
  saveSettings,
  saveSku,
  syncSkus,
  touchSps,
} from "../lib/storage";

const oauthTicketsInFlight = new Set<string>();
const CLAIMED_TICKETS_KEY = "oauthClaimedTickets";
const CLAIMED_TICKETS_MAX = 30;

async function claimedTickets(): Promise<string[]> {
  const data = await chrome.storage.local.get(CLAIMED_TICKETS_KEY);
  return Array.isArray(data[CLAIMED_TICKETS_KEY])
    ? (data[CLAIMED_TICKETS_KEY] as string[])
    : [];
}

async function markTicketClaimed(ticket: string): Promise<void> {
  const next = [ticket, ...(await claimedTickets()).filter((t) => t !== ticket)].slice(
    0,
    CLAIMED_TICKETS_MAX,
  );
  await chrome.storage.local.set({ [CLAIMED_TICKETS_KEY]: next });
}

async function hrefFromTab(tabId: number): Promise<string | undefined> {
  try {
    const [inj] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const ticket = document
          .getElementById("tst-oauth-ticket")
          ?.getAttribute("data-ticket");
        if (ticket) {
          return `${location.origin}/auth/oauth/done?ticket=${ticket}`;
        }
        return location.href;
      },
    });
    return typeof inj?.result === "string" ? inj.result : undefined;
  } catch {
    return undefined;
  }
}

async function injectClaimer(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const w = window as Window & { __tstOauthClaim?: boolean };
        if (w.__tstOauthClaim) return;
        w.__tstOauthClaim = true;
        const send = () => {
          const fromDom = document
            .getElementById("tst-oauth-ticket")
            ?.getAttribute("data-ticket");
          const fromUrl = new URLSearchParams(location.search).get("ticket");
          const ticket = fromDom || fromUrl;
          if (!ticket || ticket.length < 16) return;
          chrome.runtime.sendMessage({ type: "CLAIM_OAUTH_TICKET", ticket });
        };
        send();
        window.setInterval(send, 400);
      },
    });
  } catch {
    /* no host permission on this tab yet (Google interstitial) */
  }
}

async function showOverlayOnSeller(preferredTabId?: number): Promise<boolean> {
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({ url: [...SELLER_TAB_URL_PATTERNS] });
  } catch {
    tabs = [];
  }
  const target =
    tabs.find((t) => t.id === preferredTabId) ??
    tabs.find((t) => t.active) ??
    tabs[0];
  if (target?.id == null) return false;
  try {
    await chrome.tabs.update(target.id, { active: true });
    if (target.windowId != null) {
      await chrome.windows.update(target.windowId, { focused: true });
    }
  } catch {
    /* tab gone */
  }
  try {
    await showPanelOnTab(target.id);
  } catch {
    /* content script not ready */
  }
  return true;
}

async function finishOAuthUi(tabId?: number): Promise<void> {
  if (typeof tabId === "number") {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      /* tab already gone */
    }
  }
  if (await showOverlayOnSeller()) return;
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.id && isSellerCenterUrl(active.url ?? "")) {
    try {
      await showPanelOnTab(active.id);
    } catch {
      /* content script not ready */
    }
  }
}

async function claimOAuthTicket(ticket: string, tabId?: number): Promise<boolean> {
  if (!ticket || oauthTicketsInFlight.has(ticket)) return false;
  if ((await claimedTickets()).includes(ticket)) {
    await finishOAuthUi(tabId);
    return true;
  }
  oauthTicketsInFlight.add(ticket);
  try {
    await exchangeOAuthTicket(ticket);
    await refreshTierFromServer();
    await markTicketClaimed(ticket);
    await chrome.storage.local.remove("oauthError");
    await finishOAuthUi(tabId);
    return true;
  } catch (err) {
    oauthTicketsInFlight.delete(ticket);
    const alreadyAuthed = Boolean(await getStoredToken());
    const usedTicket = err instanceof ApiError && err.status === 401;
    if (alreadyAuthed && usedTicket) {
      await markTicketClaimed(ticket);
      await chrome.storage.local.remove("oauthError");
      await finishOAuthUi(tabId);
      return true;
    }
    await chrome.storage.local.set({
      oauthError: err instanceof Error ? err.message : "Sign-in could not finish.",
    });
    return false;
  }
}

async function inspectTab(
  tabId: number,
  changeInfo?: chrome.tabs.TabChangeInfo,
  tab?: chrome.tabs.Tab,
): Promise<void> {
  const hints: string[] = [];
  if (changeInfo?.url) hints.push(changeInfo.url);
  if (tab?.url) hints.push(tab.url);
  const shouldProbe =
    Boolean(changeInfo?.url) ||
    changeInfo?.status === "complete" ||
    !changeInfo ||
    hints.some((h) => h.includes("/auth/oauth/"));
  if (shouldProbe) {
    await injectClaimer(tabId);
    const injected = await hrefFromTab(tabId);
    if (injected) hints.push(injected);
  }
  for (const raw of hints) {
    const ticket = parseOAuthDoneUrl(raw, API_BASE_URL);
    if (ticket) {
      await claimOAuthTicket(ticket, tabId);
      return;
    }
  }
}

async function scanOAuthTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id == null) continue;
    await inspectTab(tab.id, { status: "complete" }, tab);
  }
}

async function startOAuth(url: string): Promise<void> {
  let target = url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("client", chrome.runtime.id);
    target = parsed.toString();
  } catch {
    /* keep original */
  }

  const win = await chrome.windows.create({
    url: target,
    type: "popup",
    width: 480,
    height: 720,
    focused: true,
  });
  const tab = win.tabs?.[0];
  if (tab?.id == null) return;
  const tabId = tab.id;
  await chrome.storage.session.set({ oauthTabId: tabId }).catch(() => undefined);
  const started = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - started > 10 * 60 * 1000) {
      clearInterval(timer);
      return;
    }
    void inspectTab(tabId);
  }, 500);
  const stop = () => clearInterval(timer);
  const onRemoved = (id: number) => {
    if (id === tabId) {
      chrome.tabs.onRemoved.removeListener(onRemoved);
      stop();
      void chrome.storage.session.remove("oauthTabId").catch(() => undefined);
    }
  };
  chrome.tabs.onRemoved.addListener(onRemoved);
}

function watchOAuthLanding(): void {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    void inspectTab(tabId, changeInfo, tab);
    const url = tab.url ?? "";
    if (changeInfo.status === "complete" && url.startsWith(`${API_BASE_URL}/billing/done`) && !url.includes("ok=0")) {
      void (async () => {
        const settings = await getSettings();
        if (settings.overlayCollapsed) {
          await saveSettings({ ...settings, overlayCollapsed: false });
        }
        await refreshTierFromServer();
        await showOverlayOnSeller();
      })();
    }
  });
}

watchOAuthLanding();
void scanOAuthTabs();
void chrome.storage.session.get("oauthTabId").then((data) => {
  const tabId = data.oauthTabId;
  if (typeof tabId === "number") void inspectTab(tabId);
}).catch(() => undefined);
void chrome.action.setPopup({ popup: "" });

function trustStorage(): void {
  const local = chrome.storage.local as chrome.storage.LocalStorageArea & {
    setAccessLevel?: (details: { accessLevel: "TRUSTED_CONTEXTS" }) => Promise<void>;
  };
  void local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => undefined);
}

chrome.runtime.onInstalled.addListener(() => {
  trustStorage();
  void getSettings();
  void getSps();
  void chrome.action.setPopup({ popup: "" });
});

chrome.runtime.onStartup.addListener(() => {
  trustStorage();
  void chrome.action.setPopup({ popup: "" });
  void refreshTierFromServer();
});
trustStorage();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const keys = Object.keys(changes);
  void chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (!tab.id || !tab.url || !isSellerCenterUrl(tab.url)) continue;
      void chrome.tabs.sendMessage(tab.id, { type: "STORAGE_PUSH", keys }).catch(() => undefined);
    }
  });
});

async function refreshTierFromServer(): Promise<void> {
  try {
    await refreshSubscriptionCache();
  } catch {
    /* keep the last cached tier when the API is unreachable */
  }
}

void refreshTierFromServer();

if (LLE_TEST_BANNER) {
  void chrome.action.setBadgeText({ text: "LLE" });
  void chrome.action.setBadgeBackgroundColor({ color: "#92400e" });
}

async function pingTab(tabId: number): Promise<boolean> {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "TST_PING" });
    return Boolean((res as { ok?: boolean } | undefined)?.ok);
  } catch {
    return false;
  }
}

async function injectSellerScripts(tabId: number): Promise<void> {
  const scripts = chrome.runtime.getManifest().content_scripts ?? [];
  for (const cs of scripts) {
    const files = (cs.js ?? []).filter((file) => !file.includes("oauthDone"));
    if (!files.length) continue;
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files });
    } catch {
      /* wrong host or already injected */
    }
  }
}

async function showPanelOnTab(tabId: number): Promise<void> {
  if (!(await pingTab(tabId))) {
    await injectSellerScripts(tabId);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  await chrome.tabs.sendMessage(tabId, { type: "SHOW_INPAGE_PANEL" });
}

async function tabHref(tab: chrome.tabs.Tab): Promise<string> {
  if (tab.url) return tab.url;
  if (tab.id == null) return "";
  try {
    const [inj] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => location.href,
    });
    return typeof inj?.result === "string" ? inj.result : "";
  } catch {
    return "";
  }
}

chrome.action.onClicked.addListener((tab) => {
  const tabId = tab.id;
  if (tabId == null) return;
  void (async () => {
    await chrome.action.setPopup({ popup: "" });
    await scanOAuthTabs();
    await inspectTab(tabId, { status: "complete" }, tab);
    const url = await tabHref(tab);
    const onSeller =
      isSellerCenterUrl(url) ||
      isSellerCenterUrl(tab.pendingUrl ?? "") ||
      isSellerCenterUrl(tab.url ?? "");
    if (onSeller) {
      try {
        await refreshTierFromServer();
        await showPanelOnTab(tabId);
      } catch {
        /* inject failed */
      }
      return;
    }
    if (await showOverlayOnSeller(tabId)) return;
    await chrome.tabs.create({ url: SELLER_CENTER_LINK, active: true });
  })();
});

chrome.alarms.create("spsRefresh", { periodInMinutes: 360 });
chrome.alarms.create("remoteConfigRefresh", { periodInMinutes: 15 });
void refreshRemoteConfig();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "spsRefresh") {
    void touchSps();
  }
  if (alarm.name === "remoteConfigRefresh") {
    void refreshRemoteConfig();
    void refreshTierFromServer();
  }
});

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    sender,
    sendResponse: (response: RuntimeResponse) => void,
  ) => {
    const senderUrl = sender.url ?? "";
    const fromExtension = senderUrl.startsWith(`chrome-extension://${chrome.runtime.id}/`);
    if (
      sender.id !== chrome.runtime.id ||
      (!fromExtension && !isSellerCenterUrl(senderUrl)) ||
      !isRuntimeMessage(message)
    ) {
      sendResponse({ ok: false, error: "Invalid message" });
      return false;
    }
    void (async () => {
      try {
        switch (message.type) {
          case "GET_SETTINGS":
            sendResponse({ ok: true, settings: await getSettings() });
            return;
          case "SAVE_SETTINGS":
            await saveSettings(message.settings);
            sendResponse({ ok: true, settings: message.settings });
            return;
          case "GET_SKUS":
            sendResponse({ ok: true, skus: await getSkus() });
            return;
          case "SAVE_SKU": {
            const sub = await chrome.storage.local.get("subscription");
            const storedTier = (sub.subscription as { tier?: string } | undefined)?.tier;
            const tier = storedTier === "pro" || storedTier === "diamond" ? storedTier : "free";
            const saved = await saveSku(message.sku, tier);
            if (!saved.ok) {
              sendResponse({
                ok: false,
                error:
                  saved.reason === "invalid"
                    ? "Skipped invalid SKU data."
                    : `Costs saved: ${FREE_SKU_LIMIT}/${FREE_SKU_LIMIT} free. Upgrade to Pro to save costs on more products.`,
              });
              return;
            }
            sendResponse({ ok: true });
            return;
          }
          case "GET_SPS":
            sendResponse({ ok: true, sps: (await getSps()) ?? undefined });
            return;
          case "REFRESH_OVERLAY":
            sendResponse({ ok: true });
            return;
          case "SYNC_SKUS": {
            const sub = await chrome.storage.local.get("subscription");
            const storedTier = (sub.subscription as { tier?: string } | undefined)?.tier;
            const tier = storedTier === "pro" || storedTier === "diamond" ? storedTier : "free";
            const result = await syncSkus(message.skus, tier);
            sendResponse({
              ok: true,
              saved: result.saved,
              skipped: result.skipped,
            });
            return;
          }
          case "REMOVE_SKUS": {
            await removeSkuIds(message.skuIds);
            sendResponse({ ok: true });
            return;
          }
          case "SYNC_ACTIVE_TAB": {
            const tabId = message.tabId;
            const result = await requestSkuSyncOnTab(tabId);
            sendResponse({ ok: true, ...result });
            return;
          }
          case "OPEN_EXTERNAL_COMPARE": {
            for (let i = 0; i < message.searches.length; i += 1) {
              const parsed = new URL(message.searches[i]);
              if (parsed.protocol !== "https:") continue;
              await chrome.tabs.create({
                url: parsed.toString(),
                active: i === 0,
              });
            }
            sendResponse({ ok: true });
            return;
          }
          case "OPEN_TAB": {
            try {
              await chrome.tabs.create({ url: safeUrl(message.url), active: true });
            } catch {
              sendResponse({ ok: false, error: "Invalid URL" });
              return;
            }
            sendResponse({ ok: true });
            return;
          }
          case "CLAIM_OAUTH_TICKET": {
            const tabId = sender.tab?.id;
            await claimOAuthTicket(message.ticket, tabId);
            sendResponse({ ok: true });
            return;
          }
          case "OAUTH_FINISHED": {
            await finishOAuthUi(sender.tab?.id);
            sendResponse({ ok: true });
            return;
          }
          case "SCAN_OAUTH": {
            await scanOAuthTabs();
            sendResponse({ ok: true });
            return;
          }
          case "START_OAUTH": {
            await startOAuth(message.url);
            sendResponse({ ok: true });
            return;
          }
          case "AUTH_LOGIN":
          case "AUTH_REGISTER":
          case "AUTH_FORGOT": {
            const path =
              message.type === "AUTH_REGISTER"
                ? "/auth/register"
                : message.type === "AUTH_FORGOT"
                  ? "/auth/forgot-password"
                  : "/auth/login";
            const result = await postAuth(
              path,
              {
                email: message.email,
                password: message.type === "AUTH_FORGOT" ? undefined : message.password,
              },
              fetch,
              API_BASE_URL,
            );
            if (!result.ok) {
              sendResponse({ ok: false, error: result.error, status: result.status });
              return;
            }
            if (result.token) await setStoredToken(result.token);
            await refreshTierFromServer();
            sendResponse({ ok: true });
            return;
          }
          case "LOGOUT": {
            await setStoredToken(null);
            await chrome.storage.local.set({
              subscription: { tier: "free", stripeCustomerId: null, expiresAt: null },
            });
            sendResponse({ ok: true });
            return;
          }
          case "GET_TIER": {
            // Cached plan only, no network. Safe to call from a storage-change handler.
            const token = await getStoredToken();
            sendResponse({ ok: true, loggedIn: Boolean(token), tier: await getCachedTier() });
            return;
          }
          case "AUTH_STATUS": {
            await refreshTierFromServer();
            const token = await getStoredToken();
            const tier = await getCachedTier();
            sendResponse({ ok: true, loggedIn: Boolean(token), tier });
            return;
          }
          case "GET_LOCAL": {
            const data = await chrome.storage.local.get(message.keys);
            sendResponse({ ok: true, local: data });
            return;
          }
          case "SET_LOCAL": {
            await chrome.storage.local.set(message.values);
            sendResponse({ ok: true });
            return;
          }
          case "REMOVE_LOCAL": {
            await chrome.storage.local.remove(message.keys);
            sendResponse({ ok: true });
            return;
          }
          case "API_CALL": {
            const token = await getStoredToken();
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (token) headers.Authorization = `Bearer ${token}`;
            const res = await fetch(`${API_BASE_URL}${message.path}`, {
              method: message.method,
              headers,
              body: message.method === "POST" ? message.body ?? "{}" : undefined,
            });
            const text = await res.text();
            let json: unknown = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              json = null;
            }
            const errorText = errorTextFromJson(json, res.status);
            if (!res.ok) {
              sendResponse({ ok: false, error: errorText, status: res.status });
              return;
            }
            if (
              message.path === "/auth/change-password" &&
              json &&
              typeof json === "object" &&
              "access_token" in json &&
              typeof json.access_token === "string"
            ) {
              // Other devices were signed out. Keep this one, and never hand the token to the page.
              await setStoredToken(json.access_token);
              sendResponse({ ok: true, json: { ok: true }, status: res.status });
              return;
            }
            sendResponse({ ok: true, json, status: res.status });
            return;
          }
          default:
            sendResponse({ ok: false, error: "Unknown message" });
        }
      } catch {
        sendResponse({ ok: false, error: "Background handler failed" });
      }
    })();

    return true;
  },
);

chrome.runtime.onMessageExternal.addListener(
  (message: { type?: string; ticket?: string }, sender, sendResponse) => {
    let apiOrigin = "";
    try {
      apiOrigin = new URL(API_BASE_URL).origin;
    } catch {
      /* invalid build-time API URL */
    }
    if (
      sender.origin !== apiOrigin ||
      message?.type !== "CLAIM_OAUTH_TICKET" ||
      typeof message.ticket !== "string" ||
      !/^[A-Za-z0-9_-]{20,128}$/.test(message.ticket)
    ) {
      sendResponse({ ok: false });
      return false;
    }
    void claimOAuthTicket(message.ticket, sender.tab?.id).then((ok) => {
      sendResponse({ ok });
    });
    return true;
  },
);
