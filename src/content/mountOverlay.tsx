import { createRoot, type Root } from "react-dom/client";
import { StrictMode } from "react";
import ProfitOverlay from "./components/ProfitOverlay";
import { detectPageType } from "./scraper/detectPageType";
import { parseProductPage } from "./scraper/parseProductPage";
import { extensionContextAlive, sendMessage } from "../lib/messages";
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
let authPanelForced = false;

export function positionHost(
  el: HTMLElement,
  settings: Settings,
  collapsed: boolean,
  drag?: { x: number; y: number } | null,
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

  if (drag && Number.isFinite(drag.x) && Number.isFinite(drag.y)) {
    el.style.left = `${drag.x}px`;
    el.style.top = `${drag.y}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
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

function nudgeOffSave(el: HTMLElement) {
  const buttons = el.ownerDocument.querySelectorAll("button");
  for (const btn of buttons) {
    if (!/^(save|submit)$/i.test((btn.textContent || "").trim())) continue;
    const a = el.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const hit = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    if (!hit) continue;
    const top = Math.max(8, a.top - (a.bottom - b.top) - 8);
    el.style.top = `${top}px`;
    el.style.bottom = "auto";
    break;
  }
}

function bindDrag(host: HTMLElement) {
  if (host.dataset.dragBound === "1" || !host.shadowRoot) return;
  host.dataset.dragBound = "1";
  const shadow = host.shadowRoot;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;

  shadow.addEventListener("pointerdown", (event) => {
    const pointer = event as PointerEvent;
    const target = pointer.target as HTMLElement | null;
    if (!target?.closest?.("[data-drag-handle]")) return;
    if (target.closest("button, input, select, a")) return;
    dragging = true;
    const rect = host.getBoundingClientRect();
    startX = pointer.clientX;
    startY = pointer.clientY;
    origLeft = rect.left;
    origTop = rect.top;
    host.style.left = `${origLeft}px`;
    host.style.top = `${origTop}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
    host.style.transform = "";
  });
  shadow.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const pointer = event as PointerEvent;
    host.style.left = `${origLeft + pointer.clientX - startX}px`;
    host.style.top = `${origTop + pointer.clientY - startY}px`;
  });
  shadow.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    const rect = host.getBoundingClientRect();
    void sendMessage({ type: "SET_LOCAL", values: { overlayDrag: { x: rect.left, y: rect.top } } });
  });
}

function injectStyles(shadow: ShadowRoot) {
  const style = document.createElement("style");
  style.textContent = css;
  shadow.appendChild(style);
}

async function renderOverlay(settings: Settings) {
  if (hostEl && !hostEl.isConnected) {
    reactRoot?.unmount();
    reactRoot = null;
    hostEl = null;
  }
  lastSettings = settings;
  const status = await sendMessage({ type: "AUTH_STATUS" });
  const loggedIn = Boolean(status.ok && status.loggedIn);
  const reportedTier = status.ok ? status.tier : undefined;
  const accountTier = reportedTier === "pro" || reportedTier === "diamond" ? reportedTier : "free";
  const showForced = authPanelForced;
  const showNormal = settings.overlayEnabled && !isOverlayDismissedForTab();
  if (!showForced && !showNormal) {
    unmountOverlay();
    return;
  }

  const collapsed = loggedIn && settings.overlayCollapsed && !authPanelForced;
  const product = parseProductPage();
  const dragStored = await sendMessage({ type: "GET_LOCAL", keys: ["overlayDrag"] });
  const drag = (dragStored.ok ? dragStored.local?.overlayDrag : undefined) as
    | { x: number; y: number }
    | undefined;

  if (!hostEl) {
    document.getElementById(HOST_ID)?.remove();
    hostEl = document.createElement("div");
    hostEl.id = HOST_ID;
    positionHost(hostEl, settings, collapsed, drag);
    const shadow = hostEl.attachShadow({ mode: "closed" });
    injectStyles(shadow);
    const mount = document.createElement("div");
    mount.style.pointerEvents = "auto";
    shadow.appendChild(mount);
    hostEl.style.pointerEvents = "none";
    document.body.appendChild(hostEl);
    reactRoot = createRoot(mount);
  } else {
    positionHost(hostEl, settings, collapsed, drag);
    hostEl.style.pointerEvents = "none";
  }

  bindDrag(hostEl);
  if (!collapsed) nudgeOffSave(hostEl);

  reactRoot?.render(
    <StrictMode>
      <ProfitOverlay
        key={`${detectPageType(location.href, document)}:${location.pathname}`}
        product={product}
        settings={settings}
        loggedIn={loggedIn}
        accountTier={loggedIn ? accountTier : "free"}
        onAuthed={() => {
          authPanelForced = false;
          void mountOverlayFromSettings();
        }}
        onCollapsedChange={(next) => {
          if (hostEl && lastSettings) {
            positionHost(hostEl, lastSettings, next);
          }
        }}
        onDismiss={() => {
          authPanelForced = false;
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

export async function toggleInPagePanel() {
  if (hostEl) {
    authPanelForced = false;
    dismissOverlayForTab();
    unmountOverlay();
    return;
  }
  authPanelForced = true;
  clearOverlayDismissForTab();
  await mountOverlayFromSettings();
}

export async function showInPagePanel() {
  authPanelForced = true;
  clearOverlayDismissForTab();
  await mountOverlayFromSettings();
}

export function watchOverlaySettings() {
  chrome.runtime.onMessage.addListener((message: { type?: string; keys?: string[] }) => {
    if (!extensionContextAlive()) return;
    if (message?.type !== "STORAGE_PUSH") return;
    const keys = message.keys ?? [];
    if (keys.includes("authToken") || keys.includes("settings")) {
      void mountOverlayFromSettings();
    }
  });
}
