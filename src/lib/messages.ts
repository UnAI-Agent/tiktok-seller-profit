import type { Settings } from "../types/settings";
import type { SkuRecord } from "../types/sku";
import type { SpsSnapshot } from "./sps";

export type RuntimeMessage =
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: Settings }
  | { type: "SAVE_SKU"; sku: SkuRecord }
  | { type: "GET_SKUS" }
  | { type: "GET_SPS" }
  | { type: "REFRESH_OVERLAY" }
  | { type: "SYNC_SKUS"; skus: SkuRecord[] }
  | { type: "SYNC_ACTIVE_TAB"; tabId: number }
  | { type: "OPEN_EXTERNAL_COMPARE"; searches: string[] };

export type RuntimeResponse =
  | {
      ok: true;
      settings?: Settings;
      skus?: SkuRecord[];
      sps?: SpsSnapshot;
      saved?: number;
      skipped?: number;
    }
  | { ok: false; error: string };

export function sendMessage<T extends RuntimeResponse>(
  message: RuntimeMessage,
): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}
