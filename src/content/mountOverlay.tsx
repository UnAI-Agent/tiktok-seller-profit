import { createRoot, type Root } from "react-dom/client";
import { StrictMode } from "react";
import ProfitOverlay from "./components/ProfitOverlay";
import { parseProductPage } from "./scraper/parseProductPage";
import { sendMessage } from "../lib/messages";
import type { Settings } from "../types/settings";
import {
  clearOverlayDismissForTab,
  dismissOverlayForTab,
  isOverlayDismissedForTab,
} from "./overlaySession";
import css from "../index.css?inline";

const HOST_ID = "tiktok-seller-tool-root";

let reactRoot: Root | null = null;
let hostEl: HTMLDivElement | null = null;
let lastSettings: Settings | null = null;

export function positionHost(
  el: HTMLElement,
  settings: Settings,
  collapsed: boolean,
) {
  el.style.position = "fixed";
  el.style.zIndex = "2147483646";
  el.style.transform = "";

  if (collapsed) {
    el.style.top = "50%";
    el.style.right = "0";
    el.style.bottom = "auto";
    el.style.left = "auto";
    el.style.transform = "translateY(-50%)";
    return;
  }

  el.style.top = "auto";
  el.style.bottom = "16px";
  el.style.transform = "";
  if (settings.overlayPosition === "bottom-left") {
    el.style.left = "16px";
    el.style.right = "auto";
  } else {
    el.style.right = "16px";
    el.style.left = "auto";
  }
}

function injectStyles(shadow: ShadowRoot) {
  const style = document.createElement("style");
  style.textContent = css;
  shadow.appendChild(style);
}

async function renderOverlay(settings: Settings) {
  lastSettings = settings;

  if (!settings.overlayEnabled || isOverlayDismissedForTab()) {
    unmountOverlay();
    return;
  }

  const product = parseProductPage();
  const spsRes = await sendMessage({ type: "GET_SPS" });
  const spsScore = spsRes.ok && spsRes.sps ? spsRes.sps.score : 82;
  const collapsed = settings.overlayCollapsed;

  if (!hostEl) {
    hostEl = document.createElement("div");
    hostEl.id = HOST_ID;
    positionHost(hostEl, settings, collapsed);
    const shadow = hostEl.attachShadow({ mode: "open" });
    injectStyles(shadow);
    const mount = document.createElement("div");
    mount.style.pointerEvents = "auto";
    shadow.appendChild(mount);
    hostEl.style.pointerEvents = "none";
    document.body.appendChild(hostEl);
    reactRoot = createRoot(mount);
  } else {
    positionHost(hostEl, settings, collapsed);
    hostEl.style.pointerEvents = "none";
  }

  reactRoot?.render(
    <StrictMode>
      <ProfitOverlay
        product={product}
        settings={settings}
        spsScore={spsScore}
        onCollapsedChange={(next) => {
          if (hostEl && lastSettings) {
            positionHost(hostEl, lastSettings, next);
          }
        }}
        onDismiss={() => {
          dismissOverlayForTab();
          unmountOverlay();
        }}
      />
    </StrictMode>,
  );
}

export function unmountOverlay() {
  reactRoot?.unmount();
  reactRoot = null;
  hostEl?.remove();
  hostEl = null;
}

export async function mountOverlayFromSettings() {
  const res = await sendMessage({ type: "GET_SETTINGS" });
  if (!res.ok || !res.settings) return;
  await renderOverlay(res.settings);
}

export function watchOverlaySettings() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    const settings = changes.settings.newValue as Settings;
    const wasDisabled =
      (changes.settings.oldValue as Settings | undefined)?.overlayEnabled ===
      false;
    if (settings?.overlayEnabled) {
      if (wasDisabled) clearOverlayDismissForTab();
      void renderOverlay(settings);
    } else {
      unmountOverlay();
    }
  });
}
