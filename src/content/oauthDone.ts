import { API_BASE_URL } from "../config";
import { parseOAuthDoneUrl } from "../lib/oauthCallback";

function ticketFromPage(): string | null {
  const fromUrl = parseOAuthDoneUrl(location.href, API_BASE_URL);
  if (fromUrl) return fromUrl;
  const raw = document.getElementById("tst-oauth-ticket")?.getAttribute("data-ticket");
  if (!raw) return null;
  return parseOAuthDoneUrl(
    `${location.origin}/auth/oauth/done?ticket=${raw}`,
    API_BASE_URL,
  );
}

function claim(attempt = 0): void {
  const ticket = ticketFromPage();
  if (!ticket) {
    if (attempt < 20) window.setTimeout(() => claim(attempt + 1), 200);
    return;
  }
  void chrome.runtime.sendMessage({ type: "CLAIM_OAUTH_TICKET", ticket });
}

claim();
