export const OAUTH_DONE_PATH = "/auth/oauth/done";

const TICKET_RE = /^[A-Za-z0-9_-]+$/;
const LOOPBACK = new Set(["localhost", "127.0.0.1"]);

export function isSameApiOrigin(page: URL, apiBase: URL): boolean {
  if (page.origin === apiBase.origin) return true;
  return (
    LOOPBACK.has(page.hostname) &&
    LOOPBACK.has(apiBase.hostname) &&
    page.protocol === apiBase.protocol &&
    page.port === apiBase.port
  );
}

/** Read a one-time OAuth ticket from the API landing URL. Never treat other origins as valid. */
export function parseOAuthDoneUrl(raw: string, apiBase: string): string | null {
  let url: URL;
  let base: URL;
  try {
    url = new URL(raw);
    base = new URL(apiBase);
  } catch {
    return null;
  }
  if (!isSameApiOrigin(url, base)) return null;
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (path !== OAUTH_DONE_PATH) return null;
  if (url.searchParams.get("error")) return null;
  const ticket = url.searchParams.get("ticket") ?? "";
  if (ticket.length < 16 || ticket.length > 128) return null;
  if (!TICKET_RE.test(ticket)) return null;
  return ticket;
}
