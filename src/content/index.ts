import {
  mountOverlayFromSettings,
  watchOverlaySettings,
} from "./mountOverlay";
import {
  autoSyncSkusFromPage,
  watchSellerPagesForAutoSync,
} from "./syncPageSkus";

function debounceRoute(fn: () => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

function hookSpaNavigation(onRoute: () => void) {
  const debounced = debounceRoute(onRoute, 500);
  const push = history.pushState.bind(history);
  history.pushState = (...args) => {
    push(...args);
    debounced();
  };
  window.addEventListener("popstate", debounced);
}

try {
  watchOverlaySettings();
  watchSellerPagesForAutoSync();
  hookSpaNavigation(() => {
    void mountOverlayFromSettings();
    void autoSyncSkusFromPage(false);
  });
  void mountOverlayFromSettings();

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "TST_PING") {
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "REQUEST_SKU_SYNC") {
      void autoSyncSkusFromPage(true).then((result) => {
        sendResponse({ ok: true, ...result });
      });
      return true;
    }
    return undefined;
  });
} catch (err) {
  console.error("[TikTok Seller Tool] content script failed", err);
}
