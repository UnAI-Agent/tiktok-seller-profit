const PING_TYPE = "TST_PING";

export async function ensureContentScript(tabId: number): Promise<void> {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: PING_TYPE });
    if (pong?.ok) return;
  } catch {
    /* inject below */
  }

  const manifest = chrome.runtime.getManifest();
  const files = manifest.content_scripts?.[0]?.js;
  if (!files?.length) {
    throw new Error("No content script in manifest");
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [...files],
  });

  await new Promise((r) => setTimeout(r, 400));
}

export async function requestSkuSyncOnTab(
  tabId: number,
): Promise<Record<string, unknown>> {
  await ensureContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, { type: "REQUEST_SKU_SYNC" }) as Promise<
    Record<string, unknown>
  >;
}

export { PING_TYPE };
