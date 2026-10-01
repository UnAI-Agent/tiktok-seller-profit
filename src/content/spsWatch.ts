import { trackEvent } from "../lib/apiClient";
import { extensionContextAlive, sendMessage } from "../lib/messages";
import { spsLevel } from "../lib/sps";
import { applyRemoteSelectors } from "./mountOverlay";
import { readSpsFromDocument } from "./spsCapture";

const WATCH_MS = 20_000;
let stopCurrent: (() => void) | null = null;

/**
 * Seller Center renders the Shop Performance Score after the page loads, so
 * watch the DOM for up to 20 seconds per page and save the first score found.
 * Pages without a score cost one querySelector pass per DOM change burst.
 */
export function watchSpsOnPage(): void {
  stopCurrent?.();
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const attempt = () => {
    if (done || !extensionContextAlive()) return;
    const score = readSpsFromDocument(document);
    if (score == null) return;
    done = true;
    stop();
    void sendMessage({ type: "SAVE_SPS", score }).then((res) => {
      if (res.ok) trackEvent("sps.captured", { level: spsLevel(score) });
    });
  };

  const observer = new MutationObserver(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(attempt, 400);
  });
  const deadline = setTimeout(() => stop(), WATCH_MS);

  function stop() {
    observer.disconnect();
    clearTimeout(deadline);
    if (timer) clearTimeout(timer);
    if (stopCurrent === stop) stopCurrent = null;
  }

  stopCurrent = stop;
  void applyRemoteSelectors().finally(() => {
    attempt();
    if (!done && document.body) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}
