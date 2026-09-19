const DISMISS_KEY = "tiktok-seller-tool-overlay-dismissed";

export function isOverlayDismissedForTab(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissOverlayForTab(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function clearOverlayDismissForTab(): void {
  try {
    sessionStorage.removeItem(DISMISS_KEY);
  } catch {
    /* ignore */
  }
}
