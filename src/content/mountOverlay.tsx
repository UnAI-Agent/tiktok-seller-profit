import { createRoot, type Root } from "react-dom/client";
import { StrictMode } from "react";
import ProfitOverlay from "./components/ProfitOverlay";
import { detectPageType } from "./scraper/detectPageType";
import { parseProductPage } from "./scraper/parseProductPage";
import { setRemoteCss } from "./scraper/domSelectors";
import { acceptPublishedConfig } from "../lib/remoteConfig";
import { setActiveRemoteConfig } from "./activeConfig";
import { extensionContextAlive, sendMessage } from "../lib/messages";
import type { Settings } from "../types/settings";
import {
  clearOverlayDismissForTab,
  dismissOverlayForTab,
  isOverlayDismissedForTab,
} from "./overlaySession";
import css from "../index.css?inline";

const HOST_ID = "tiktok-seller-tool-root";

/** Store builds keep the panel closed. Only `npm run build:e2e` (VITE_E2E=1) opens it for Playwright. */
const SHADOW_MODE: ShadowRootMode = import.meta.env.VITE_E2E === "1" ? "open" : "closed";

let reactRoot: Root | null = null;
let hostEl: HTMLDivElement | null = null;
let lastSettings: Settings | null = null;
let authPanelForced = false;
/** Bumped on every close so a refresh that started earlier cannot reopen the panel. */
let renderGen = 0;

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
  const gen = ++renderGen;
  if (hostEl && !hostEl.isConnected) {
    reactRoot?.unmount();
    reactRoot = null;
    hostEl = null;
  }
  lastSettings = settings;
  const status = await sendMessage({ type: "AUTH_STATUS" });
  if (gen !== renderGen) return;
  const loggedIn = Boolean(status.ok && status.loggedIn);
  const reportedTier = status.ok ? status.tier : undefined;
  const accountTier = reportedTier === "pro" || reportedTier === "diamond" ? reportedTier : "free";
  const showForced = authPanelForced;
  const showNormal = settings.overlayEnabled && !isOverlayDismissedForTab();
  if (!showForced && !showNormal) {
    unmountOverlay();
    return;
  }

  // Same rule as the panel itself (ProfitOverlay starts from settings.overlayCollapsed for
  // everyone). Requiring loggedIn here put a signed-out seller's minimized tab where the
  // full panel goes, and ran the full panel's save-button nudge on it.
  const collapsed = settings.overlayCollapsed && !authPanelForced;
  await applyRemoteSelectors();
  if (gen !== renderGen) return;
  const product = parseProductPage();
  const dragStored = await sendMessage({ type: "GET_LOCAL", keys: ["overlayDrag"] });
  if (gen !== renderGen) return;
  const drag = (dragStored.ok ? dragStored.local?.overlayDrag : undefined) as
    | { x: number; y: number }
    | undefined;

  // A config refresh can still be awaiting here after the seller closed the panel.
  // Recreating the host would undo that close. Check again immediately before
  // the node is inserted: another content-script world does not share renderGen.
  if (!authPanelForced && isOverlayDismissedForTab()) {
    unmountOverlay();
    return;
  }

  if (!hostEl) {
    document.querySelectorAll(`#${HOST_ID}`).forEach((node) => node.remove());
    hostEl = document.createElement("div");
    hostEl.id = HOST_ID;
    positionHost(hostEl, settings, collapsed, drag);
    const shadow = hostEl.attachShadow({ mode: SHADOW_MODE });
    injectStyles(shadow);
    const mount = document.createElement("div");
    mount.style.pointerEvents = "auto";
    shadow.appendChild(mount);
    hostEl.style.pointerEvents = "none";
    if (!authPanelForced && isOverlayDismissedForTab()) {
      hostEl = null;
      reactRoot = null;
      return;
    }
    document.body.appendChild(hostEl);
    reactRoot = createRoot(mount);
  } else {
    positionHost(hostEl, settings, collapsed, drag);
    hostEl.style.pointerEvents = "none";
  }

  bindDrag(hostEl);
  if (!collapsed) {
    // The card has no size until React lays out. Nudge on that resize so a
    // Save/Submit button under the finished panel is cleared.
    nudgeOffSave(hostEl);
    const watched = hostEl;
    const observer = new ResizeObserver(() => {
      nudgeOffSave(watched);
      if (watched.getBoundingClientRect().height > 40) observer.disconnect();
    });
    observer.observe(watched);
  }

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
  renderGen += 1;
  reactRoot?.unmount();
  reactRoot = null;
  hostEl?.remove();
  hostEl = null;
}

/** Verified remote config: feature flags, plus CSS selectors that fix scraping without a store update. */
export async function applyRemoteSelectors(): Promise<void> {
  const res = await sendMessage({ type: "GET_LOCAL", keys: ["remoteConfigCache"] });
  const raw = res.ok ? res.local?.remoteConfigCache : null;
  const accepted = await acceptPublishedConfig(raw, null, Date.now());
  setActiveRemoteConfig(accepted);
  const map: Record<string, string> = {};
  for (const surface of ["account-health", "product-edit"] as const) {
    const fields = accepted?.selectors?.[surface]?.fields ?? {};
    for (const [field, spec] of Object.entries(fields)) {
      if (spec.css && !spec.css.trim().toLowerCase().startsWith("javascript:")) map[field] = spec.css;
    }
  }
  setRemoteCss(map);
}

export async function mountOverlayFromSettings() {
  let res = await sendMessage({ type: "GET_SETTINGS" });
  for (let attempt = 0; !res.ok && attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    res = await sendMessage({ type: "GET_SETTINGS" });
  }
  if (!res.ok || !res.settings) return;
  await renderOverlay(res.settings);
}

export async function toggleInPagePanel() {
  const root = document.documentElement;
  const closedAt = Number(root.dataset.mmClosedAt || 0);
  const host = document.querySelector(`#${HOST_ID}`);
  // Two content-script worlds can both receive this message. The second one
  // must not open a panel the first one just closed.
  if (host || Date.now() - closedAt < 200) {
    root.dataset.mmClosedAt = String(Date.now());
    const existing = hostEl?.isConnected ? hostEl : (host as HTMLDivElement | null);
    if (existing) hostEl = existing;
    authPanelForced = false;
    dismissOverlayForTab();
    unmountOverlay();
    document.querySelectorAll(`#${HOST_ID}`).forEach((node) => node.remove());
    return { closed: true };
  }
  authPanelForced = true;
  clearOverlayDismissForTab();
  await mountOverlayFromSettings();
  return { closed: false };
}

export async function showInPagePanel() {
  authPanelForced = true;
  clearOverlayDismissForTab();
  await mountOverlayFromSettings();
  return {
    forced: authPanelForced,
    dismissed: isOverlayDismissedForTab(),
    host: Boolean(document.getElementById(HOST_ID)),
  };
}

export function watchOverlaySettings() {
  chrome.runtime.onMessage.addListener((message: { type?: string; keys?: string[] }) => {
    if (!extensionContextAlive()) return;
    if (message?.type !== "STORAGE_PUSH") return;
    const keys = message.keys ?? [];
      if (keys.includes("authToken") || keys.includes("settings") || keys.includes("remoteConfigCache")) {
      void mountOverlayFromSettings();
    }
  });
}
