import type { RuntimeMessage, RuntimeResponse } from "../lib/messages";
import { requestSkuSyncOnTab } from "../lib/tabBridge";
import {
  FREE_SKU_LIMIT,
  getSettings,
  getSkus,
  getSps,
  saveSettings,
  saveSku,
  syncSkus,
  touchSps,
} from "../lib/storage";

chrome.runtime.onInstalled.addListener(() => {
  void getSettings();
  void getSps();
});

chrome.alarms.create("spsRefresh", { periodInMinutes: 360 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "spsRefresh") {
    void touchSps();
  }
});

chrome.runtime.onMessage.addListener(
  (
    message: RuntimeMessage,
    _sender,
    sendResponse: (response: RuntimeResponse) => void,
  ) => {
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
            const tier =
              (sub.subscription as { tier?: string } | undefined)?.tier === "pro"
                ? "pro"
                : "free";
            const saved = await saveSku(message.sku, tier);
            if (!saved.ok) {
              sendResponse({
                ok: false,
                error:
                  saved.reason === "invalid"
                    ? "Skipped invalid SKU data."
                    : `Free tier limit: ${FREE_SKU_LIMIT} SKUs. Upgrade to Pro.`,
              });
              return;
            }
            sendResponse({ ok: true });
            return;
          }
          case "GET_SPS":
            sendResponse({ ok: true, sps: await getSps() });
            return;
          case "REFRESH_OVERLAY":
            sendResponse({ ok: true });
            return;
          case "SYNC_SKUS": {
            const sub = await chrome.storage.local.get("subscription");
            const tier =
              (sub.subscription as { tier?: string } | undefined)?.tier === "pro"
                ? "pro"
                : "free";
            const result = await syncSkus(message.skus, tier);
            sendResponse({
              ok: true,
              saved: result.saved,
              skipped: result.skipped,
            });
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
              await chrome.tabs.create({
                url: message.searches[i],
                active: i === 0,
              });
            }
            sendResponse({ ok: true });
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
