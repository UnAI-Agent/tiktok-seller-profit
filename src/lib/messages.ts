import type { Settings } from "../types/settings";
import type { SkuRecord } from "../types/sku";
import type { SpsSnapshot } from "./sps";
import { isValidSku } from "./skuValidate";

export type RuntimeMessage =
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: Settings }
  | { type: "SAVE_SKU"; sku: SkuRecord }
  | { type: "GET_SKUS" }
  | { type: "GET_SPS" }
  | { type: "SAVE_SPS"; score: number }
  | { type: "REFRESH_OVERLAY" }
  | { type: "REFRESH_REMOTE_CONFIG" }
  | { type: "SYNC_SKUS"; skus: SkuRecord[] }
  | { type: "REMOVE_SKUS"; skuIds: string[] }
  | { type: "SYNC_ACTIVE_TAB"; tabId: number }
  | { type: "OPEN_EXTERNAL_COMPARE"; searches: string[] }
  | { type: "OPEN_TAB"; url: string }
  | { type: "CLAIM_OAUTH_TICKET"; ticket: string }
  | { type: "OAUTH_FINISHED" }
  | { type: "SCAN_OAUTH" }
  | { type: "LOGOUT" }
  | { type: "START_OAUTH"; url: string }
  | { type: "API_CALL"; method: "GET" | "POST"; path: string; body?: string }
  | { type: "AUTH_LOGIN" | "AUTH_REGISTER"; email: string; password: string }
  | { type: "AUTH_FORGOT"; email: string }
  | { type: "AUTH_STATUS"; force?: boolean }
  | { type: "CHECKOUT_STARTED" }
  | { type: "GET_TIER" }
  | { type: "GET_LOCAL"; keys: string[] }
  | { type: "SET_LOCAL"; values: Record<string, unknown> }
  | { type: "REMOVE_LOCAL"; keys: string[] };

export type RuntimeResponse =
  | {
      ok: true;
      settings?: Settings;
      skus?: SkuRecord[];
      sps?: SpsSnapshot;
      saved?: number;
      skipped?: number;
      status?: number;
      json?: unknown;
      loggedIn?: boolean;
      tier?: string;
      local?: Record<string, unknown>;
    }
  | { ok: false; error: string; status?: number };

const LOCAL_KEYS = new Set([
  "onboardingDone",
  "proJustUnlocked",
  "overlayDrag",
  "subscription",
  "statementMapping",
  "firstRun",
  "remoteConfigCache",
  "creatorOrders",
  "creatorMapping",
  "weeklySnapshots",
  "recapSeenWeek",
]);

export function allowedLocalKeys(keys: unknown): keys is string[] {
  return Array.isArray(keys) && keys.length <= 8 && keys.every((key) => LOCAL_KEYS.has(key));
}

const SIMPLE_MESSAGES = new Set([
  "CHECKOUT_STARTED",
  "GET_TIER",
  "GET_SETTINGS",
  "GET_SKUS",
  "GET_SPS",
  "REFRESH_OVERLAY",
  "REFRESH_REMOTE_CONFIG",
  "OAUTH_FINISHED",
  "SCAN_OAUTH",
  "LOGOUT",
]);

const API_CALLS: Record<string, string[]> = {
  GET: ["/auth/me", "/auth/providers", "/config/remote"],
  POST: [
    "/billing/checkout",
    "/billing/portal",
    "/billing/promo",
    "/telemetry/event",
    "/auth/delete-account",
    "/auth/profile",
    "/auth/change-password",
    "/auth/verify-email",
    "/auth/verify-email/resend",
    "/auth/refresh",
    "/auth/sign-out-everywhere",
    "/support/ticket",
  ],
};

/** Content scripts cannot call the API directly. Only these paths may be proxied. */
export function allowedApiCall(method: string, path: string): boolean {
  if (!path.startsWith("/") || path.includes("..") || path.includes("\\")) return false;
  let url: URL;
  try {
    url = new URL(path, "https://api.local");
  } catch {
    return false;
  }
  if (url.origin !== "https://api.local") return false;
  return (API_CALLS[method] ?? []).includes(url.pathname);
}

function validEmail(value: unknown): value is string {
  return boundedString(value, 254) && value.includes("@") && !/\s/.test(value);
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (typeof message.type !== "string") return false;
  if (SIMPLE_MESSAGES.has(message.type)) return true;
  switch (message.type) {
    case "AUTH_STATUS":
      return message.force === undefined || typeof message.force === "boolean";
    case "SAVE_SPS":
      return typeof message.score === "number" && Number.isFinite(message.score) && message.score >= 0 && message.score <= 5;
    case "SAVE_SETTINGS": {
      if (!message.settings || typeof message.settings !== "object") return false;
      return Object.values(message.settings).every(
        (item) => typeof item !== "number" || (Number.isFinite(item) && Math.abs(item) <= 100_000),
      );
    }
    case "SAVE_SKU":
      return isValidSku(message.sku);
    case "SYNC_SKUS":
      return (
        Array.isArray(message.skus) &&
        message.skus.length <= 50_000 &&
        message.skus.every(isValidSku)
      );
    case "REMOVE_SKUS":
      return (
        Array.isArray(message.skuIds) &&
        message.skuIds.length <= 50_000 &&
        message.skuIds.every((id) => boundedString(id, 128))
      );
    case "SYNC_ACTIVE_TAB":
      return Number.isInteger(message.tabId) && Number(message.tabId) >= 0;
    case "OPEN_EXTERNAL_COMPARE":
      return (
        Array.isArray(message.searches) &&
        message.searches.length <= 10 &&
        message.searches.every((url) => boundedString(url, 2_000))
      );
    case "OPEN_TAB":
    case "START_OAUTH":
      return boundedString(message.url, 2_000);
    case "CLAIM_OAUTH_TICKET":
      return (
        boundedString(message.ticket, 128) &&
        /^[A-Za-z0-9_-]{20,128}$/.test(message.ticket)
      );
    case "API_CALL":
      return (
        (message.method === "GET" || message.method === "POST") &&
        boundedString(message.path, 200) &&
        allowedApiCall(message.method, message.path) &&
        (message.body === undefined || boundedString(message.body, 8_000))
      );
    case "AUTH_LOGIN":
    case "AUTH_REGISTER":
      return validEmail(message.email) && boundedString(message.password, 128);
    case "AUTH_FORGOT":
      return validEmail(message.email);
    case "GET_LOCAL":
    case "REMOVE_LOCAL":
      return allowedLocalKeys(message.keys);
    case "SET_LOCAL":
      return (
        !!message.values &&
        typeof message.values === "object" &&
        allowedLocalKeys(Object.keys(message.values))
      );
    default:
      return false;
  }
}

export function extensionContextAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

export function sendMessage<T extends RuntimeResponse>(
  message: RuntimeMessage,
): Promise<T> {
  const stale = { ok: false, error: "Extension reloaded. Refresh this tab." } as T;
  if (!extensionContextAlive()) return Promise.resolve(stale);
  try {
    return (chrome.runtime.sendMessage(message) as Promise<T>).catch((err: unknown) => {
      const text = err instanceof Error ? err.message : String(err);
      if (
        text.includes("Extension context invalidated") ||
        text.includes("message port closed")
      ) {
        return stale;
      }
      throw err;
    });
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (text.includes("Extension context invalidated")) return Promise.resolve(stale);
    throw err;
  }
}
