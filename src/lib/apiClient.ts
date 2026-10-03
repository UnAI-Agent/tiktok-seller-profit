import { API_BASE_URL, SERVICE_SLUG } from "../config";
import { clearSharedAuthMe, shareAuthMe } from "./authMeShare";
import {
  ApiError,
  AUTH_EXPIRED_EVENT,
  CONNECTION_LOST,
  parseErrorBody,
  parseRetryAfterMs,
} from "./apiErrors";
import { extensionContextAlive, sendMessage } from "./messages";

/** chrome.storage.local key — keep stable so existing sessions stay signed in. */
const TOKEN_KEY = "authToken";
const TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;

export type MeResponse = {
  email: string;
  display_name?: string;
  is_pro: boolean;
  subscription_status: string;
  promo_expires_at?: string | null;
  has_stripe?: boolean;
  tier?: "free" | "pro" | "diamond";
  pro_price: number;
  pro_price_yearly?: number;
  usage_limit?: number;
  email_verified?: boolean;
  /** Additive plan details (API 1.4+). Older APIs omit them. */
  trial_available?: boolean;
  plan_interval?: "month" | "year" | string | null;
  plan_status?: string | null;
  current_period_end?: string | null;
  has_oauth?: boolean;
  oauth_provider?: string | null;
};

export { ApiError, CONNECTION_LOST, AUTH_EXPIRED_EVENT };

export async function getStoredToken(): Promise<string | null> {
  if (!extensionContextAlive()) return null;
  try {
    const data = await chrome.storage.local.get(TOKEN_KEY);
    return (data[TOKEN_KEY] as string) || null;
  } catch {
    return null;
  }
}

export async function setStoredToken(token: string | null): Promise<void> {
  if (!extensionContextAlive()) return;
  try {
    if (token) {
      await chrome.storage.local.set({ [TOKEN_KEY]: token });
    } else {
      await chrome.storage.local.remove(TOKEN_KEY);
    }
    clearSharedAuthMe();
  } catch {
    /* context invalidated after reload */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function notifyAuthExpired(): void {
  try {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
  } catch {
    /* service worker has no window */
  }
}

async function parseFailedResponse(res: Response): Promise<never> {
  const text = await res.text();
  const message = parseErrorBody(text, res.status);
  if (res.status === 401) {
    await setStoredToken(null);
    notifyAuthExpired();
    throw new ApiError(message, 401, "unauthorized");
  }
  if (res.status === 402) {
    throw new ApiError(message, 402, "payment_required");
  }
  if (res.status === 429) {
    throw new ApiError(
      message,
      429,
      "rate_limited",
      parseRetryAfterMs(res.headers.get("Retry-After")),
    );
  }
  throw new ApiError(message, res.status, "http");
}

function shouldRetry(err: unknown, attempt: number): boolean {
  if (attempt >= MAX_RETRIES) return false;
  if (!(err instanceof ApiError)) return false;
  if (err.code === "timeout" || err.code === "network") return true;
  if (err.code === "rate_limited") return true;
  if (err.code === "http" && err.status >= 500) return true;
  return false;
}

/** When this document started. A profile fetched earlier belongs to the previous page. */
const documentStartedAt = Date.now();

/** Seller Center content scripts are the page origin, so the API rejects their preflight. */
function proxyApiFromPage(): boolean {
  try {
    return location.protocol !== "chrome-extension:";
  } catch {
    return false;
  }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  if (!proxyApiFromPage() && method !== "GET") clearSharedAuthMe();
  if (proxyApiFromPage() && (method === "GET" || method === "POST")) {
    const res = await sendMessage({
      type: "API_CALL",
      method,
      path,
      body: typeof options.body === "string" ? options.body : undefined,
      notBefore: documentStartedAt,
    });
    if (!res.ok) {
      const status = res.status ?? 0;
      if (status === 401) {
        await setStoredToken(null);
        notifyAuthExpired();
      }
      throw new ApiError(
        res.error,
        status,
        status === 401
          ? "unauthorized"
          : status === 402
            ? "payment_required"
            : status === 429
              ? "rate_limited"
              : "http",
      );
    }
    return res.json as T;
  }
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const token = await getStoredToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string> | undefined),
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
      if (!res.ok) await parseFailedResponse(res);
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (err instanceof DOMException && err.name === "AbortError") {
        lastError = new ApiError(CONNECTION_LOST, 0, "timeout");
      } else if (err instanceof TypeError) {
        lastError = new ApiError(CONNECTION_LOST, 0, "network");
      }
      if (!shouldRetry(lastError, attempt)) throw lastError;
      const backoff =
        lastError instanceof ApiError && lastError.retryAfterMs
          ? lastError.retryAfterMs
          : 400 * 2 ** attempt;
      await sleep(backoff);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export async function exchangeOAuthTicket(ticket: string): Promise<void> {
  // Dedicated fetch: a used-ticket 401 must not clear a JWT we just stored.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE_URL}/auth/oauth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(
        parseErrorBody(text, res.status),
        res.status,
        res.status === 401 ? "unauthorized" : "http",
      );
    }
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) {
      throw new ApiError("Sign-in could not finish.", 500, "http");
    }
    await setStoredToken(data.access_token);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(CONNECTION_LOST, 0, "timeout");
    }
    if (err instanceof TypeError) {
      throw new ApiError(CONNECTION_LOST, 0, "network");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function authFromPage(
  type: "AUTH_LOGIN" | "AUTH_REGISTER" | "AUTH_FORGOT",
  email: string,
  password?: string,
): Promise<void> {
  const res = await sendMessage(
    type === "AUTH_FORGOT" ? { type, email } : { type, email, password: password ?? "" },
  );
  if (!res.ok) {
    const status = res.status ?? 0;
    throw new ApiError(res.error, status, status === 401 ? "unauthorized" : "http");
  }
}

export async function login(email: string, password: string): Promise<void> {
  if (proxyApiFromPage()) {
    await authFromPage("AUTH_LOGIN", email, password);
    return;
  }
  const data = await apiFetch<{ access_token: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  await setStoredToken(data.access_token);
}

export async function register(
  email: string,
  password: string,
): Promise<{ emailVerificationSent: boolean }> {
  if (proxyApiFromPage()) {
    await authFromPage("AUTH_REGISTER", email, password);
    return { emailVerificationSent: false };
  }
  const data = await apiFetch<{ access_token: string; email_verification_sent?: boolean }>(
    "/auth/register",
    {
      method: "POST",
      body: JSON.stringify({ email, password }),
    },
  );
  await setStoredToken(data.access_token);
  return { emailVerificationSent: Boolean(data.email_verification_sent) };
}

const PROVIDER_CACHE = "authProvidersCache";

export async function fetchAuthProviders(): Promise<string[]> {
  try {
    const cached = await chrome.storage.local.get(PROVIDER_CACHE);
    const row = cached[PROVIDER_CACHE] as { at?: number; providers?: string[] } | undefined;
    if (row?.providers && typeof row.at === "number" && Date.now() - row.at < 3_600_000) {
      return row.providers;
    }
  } catch {
    /* read the network list */
  }
  const data = await apiFetch<{ providers?: string[] }>("/auth/providers");
  const providers = data.providers ?? [];
  try {
    await chrome.storage.local.set({ [PROVIDER_CACHE]: { at: Date.now(), providers } });
  } catch {
    /* the list still applies for this view */
  }
  return providers;
}

export async function verifyEmail(code: string): Promise<void> {
  await apiFetch("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function resendVerifyEmail(): Promise<void> {
  await apiFetch("/auth/verify-email/resend", { method: "POST" });
}

export function tokenExpiresWithin(token: string, withinSeconds: number, nowSec = Date.now() / 1000): boolean {
  const payload = token.split(".")[0];
  if (!payload) return false;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    if (typeof json.exp !== "number") return false;
    return json.exp - nowSec < withinSeconds;
  } catch {
    return false;
  }
}

export async function refreshAccessToken(): Promise<void> {
  const data = await apiFetch<{ access_token: string }>("/auth/refresh", { method: "POST" });
  if (data.access_token) await setStoredToken(data.access_token);
}

/** Stub — backend never reveals whether the email exists. */
export async function requestPasswordReset(email: string): Promise<void> {
  if (proxyApiFromPage()) {
    await authFromPage("AUTH_FORGOT", email);
    return;
  }
  await apiFetch("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/**
 * Current account, or null when signed out.
 *
 * On Seller Center pages the extension's storage is locked to trusted contexts,
 * so the page cannot read the token itself. The service worker adds it to the
 * proxied call. Checking the token here first made every overlay look signed
 * out, and the overlay then showed Free for Pro accounts.
 */
export async function fetchMe(options?: { fresh?: boolean; notBefore?: number }): Promise<MeResponse | null> {
  if (!proxyApiFromPage()) {
    const token = await getStoredToken();
    if (!token) return null;
    try {
      return await shareAuthMe(
        token,
        () => apiFetch<MeResponse>(`/auth/me?service=${encodeURIComponent(SERVICE_SLUG)}`),
        options?.fresh === true,
        options?.notBefore ?? 0,
      );
    } catch (err) {
      // No token → FastAPI answers 403 "Not authenticated"; a stale one → 401. Both mean signed out.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
      throw err;
    }
  }
  try {
    return await apiFetch<MeResponse>(`/auth/me?service=${encodeURIComponent(SERVICE_SLUG)}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
    throw err;
  }
}

export async function createCheckoutUrl(
  billingInterval: "monthly" | "yearly" = "monthly",
): Promise<string> {
  const data = await apiFetch<{ url: string }>("/billing/checkout", {
    method: "POST",
    body: JSON.stringify({
      service: SERVICE_SLUG,
      billing_interval: billingInterval,
    }),
  });
  if (!data.url) {
    throw new ApiError("Checkout unavailable. Try again.", 500, "http");
  }
  // The worker checks the plan every 30 seconds for 15 minutes, so the open
  // panel unlocks Pro even if the seller never returns to the success page.
  void sendMessage({ type: "CHECKOUT_STARTED" }).catch(() => undefined);
  return data.url;
}

export async function createPortalUrl(): Promise<string> {
  const data = await apiFetch<{ url: string }>("/billing/portal", {
    method: "POST",
  });
  if (!data.url) {
    throw new ApiError("Billing portal unavailable.", 500, "http");
  }
  return data.url;
}

export async function redeemPromo(code: string): Promise<{
  code: string;
  pro_days: number;
  promo_expires_at: string;
}> {
  return apiFetch("/billing/promo", {
    method: "POST",
    body: JSON.stringify({ service: SERVICE_SLUG, code }),
  });
}

export async function fetchRemoteConfig(): Promise<unknown> {
  try {
    return await apiFetch<unknown>(
      `/config/remote?service=${encodeURIComponent(SERVICE_SLUG)}`,
    );
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  if (proxyApiFromPage()) {
    const res = await sendMessage({ type: "LOGOUT" });
    if (!res.ok) throw new Error(res.error);
    return;
  }
  await setStoredToken(null);
  await chrome.storage.local.set({
    subscription: { tier: "free", stripeCustomerId: null, expiresAt: null },
  });
}

const eventQueue: Array<{ event: string; properties: Record<string, string | number | boolean> }> = [];
let eventTimer: ReturnType<typeof setTimeout> | undefined;

function extVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "";
  }
}

/** At most one flush every 10 seconds. Never sends titles, costs, URLs, or emails. */
export function trackEvent(
  event: string,
  properties: Record<string, string | number | boolean> = {},
): void {
  const safe: Record<string, string | number | boolean> = { extVersion: extVersion() };
  for (const [key, value] of Object.entries(properties)) {
    if (/email|url|href|title|cost|cogs|profit/i.test(key)) continue;
    safe[key] = value;
  }
  eventQueue.push({ event, properties: safe });
  if (eventTimer) return;
  eventTimer = setTimeout(() => {
    eventTimer = undefined;
    const batch = eventQueue.splice(0, eventQueue.length);
    for (const item of batch) {
      void apiFetch("/telemetry/event", {
        method: "POST",
        body: JSON.stringify({
          service: SERVICE_SLUG,
          event: item.event,
          properties: item.properties,
        }),
      }).catch(() => {
        /* offline or API down — ignore */
      });
    }
  }, 10_000);
}

export type SupportTicketKind = "problem" | "support" | "help" | "info" | "billing" | "feature";

export async function submitSupportTicket(input: {
  email: string;
  subject: string;
  message: string;
  kind?: SupportTicketKind;
}): Promise<{ emailed: boolean }> {
  return await apiFetch<{ emailed?: boolean }>("/support/ticket", {
    method: "POST",
    body: JSON.stringify({
      service: SERVICE_SLUG,
      email: input.email,
      subject: input.subject,
      message: input.message,
      kind: input.kind ?? "support",
    }),
  }).then((body) => ({ emailed: Boolean(body?.emailed) }));
}

export async function updateProfile(input: {
  display_name?: string;
  email?: string;
}): Promise<{ email: string; display_name: string }> {
  return apiFetch("/auth/profile", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const res = await apiFetch<{ access_token?: string }>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
  // Other devices are signed out by the server; keep this one signed in.
  if (res?.access_token) await setStoredToken(res.access_token);
}

export async function signOutEverywhere(): Promise<void> {
  await apiFetch("/auth/sign-out-everywhere", { method: "POST" });
  await logout();
}

export async function deleteAccount(password: string): Promise<void> {
  await apiFetch("/auth/delete-account", {
    method: "POST",
    body: JSON.stringify({ confirm: "DELETE", password }),
  });
  await logout();
}
