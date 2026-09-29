import { exchangeOAuthTicket } from "./lib/apiClient";

const ticket = new URLSearchParams(location.search).get("ticket") ?? "";
const msg = document.getElementById("msg");

async function finish(): Promise<void> {
  if (ticket.length < 16) {
    if (msg) msg.textContent = "Sign-in expired. Try Google again from the extension.";
    return;
  }
  try {
    await exchangeOAuthTicket(ticket);
    await chrome.runtime.sendMessage({ type: "OAUTH_FINISHED" });
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id != null) await chrome.tabs.remove(tab.id);
  } catch (err) {
    if (msg) {
      msg.textContent =
        err instanceof Error ? err.message : "Sign-in could not finish. Try again.";
    }
  }
}

void finish();
