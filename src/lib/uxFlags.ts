const WELCOME = "welcomeSeen";
const OPENS = "popupOpenCount";
const NUDGE = "nudgeDismissed";

export const NUDGE_AFTER_OPENS = 5;

/** Demo creator tab. Off unless the dev build sets VITE_SHOW_CREATOR_DEMO=1. */
export const SHOW_CREATOR_DEMO = import.meta.env.VITE_SHOW_CREATOR_DEMO === "1";

export async function loadUxFlags(): Promise<{
  welcomeSeen: boolean;
  popupOpenCount: number;
  nudgeDismissed: boolean;
}> {
  const data = await chrome.storage.local.get([WELCOME, OPENS, NUDGE]);
  return {
    welcomeSeen: Boolean(data[WELCOME]),
    popupOpenCount: Number(data[OPENS] || 0),
    nudgeDismissed: Boolean(data[NUDGE]),
  };
}

export async function markWelcomeSeen(): Promise<void> {
  await chrome.storage.local.set({ [WELCOME]: true });
}

export async function bumpPopupOpenCount(): Promise<number> {
  const data = await chrome.storage.local.get(OPENS);
  const next = Number(data[OPENS] || 0) + 1;
  await chrome.storage.local.set({ [OPENS]: next });
  return next;
}

export async function dismissNudge(): Promise<void> {
  await chrome.storage.local.set({ [NUDGE]: true });
}
