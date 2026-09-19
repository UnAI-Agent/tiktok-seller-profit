import { API_BASE_URL, SERVICE_SLUG } from "../config";
import {
  ApiError,
  AUTH_EXPIRED_EVENT,
  CONNECTION_LOST,
  parseErrorBody,
  parseRetryAfterMs,
} from "./apiErrors";
import type { SkuRecord } from "../types/sku";

/** chrome.storage.local key — keep stable so existing sessions stay signed in. */
const TOKEN_KEY = "authToken";
const TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;

export type MeResponse = {
  email: string;
  is_pro: boolean;
  subscription_status: string;
  pro_price: number;
  pro_price_yearly?: number;
  usage_limit?: number;
};

export { ApiError, CONNECTION_LOST, AUTH_EXPIRED_EVENT };

export async function getStoredToken(): Promise<string | null> {
  const data = await chrome.storage.local.get(TOKEN_KEY);
  return (data[TOKEN_KEY] as string) || null;
}

export async function setStoredToken(token: string | null): Promise<void> {
  if (token) {
    await chrome.storage.local.set({ [TOKEN_KEY]: token });
  } else {
    await chrome.storage.local.remove(TOKEN_KEY);
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

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
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

export async function login(email: string, password: string): Promise<void> {
  const data = await apiFetch<{ access_token: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  await setStoredToken(data.access_token);
}

export async function register(email: string, password: string): Promise<void> {
  const data = await apiFetch<{ access_token: string }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  await setStoredToken(data.access_token);
}

/** Stub — backend never reveals whether the email exists. */
export async function requestPasswordReset(email: string): Promise<void> {
  await apiFetch("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function fetchMe(): Promise<MeResponse | null> {
  const token = await getStoredToken();
  if (!token) return null;
  return apiFetch<MeResponse>(
    `/auth/me?service=${encodeURIComponent(SERVICE_SLUG)}`,
  );
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
  return data.url;
}

export async function submitSupportTicket(input: {
  email: string;
  subject: string;
  message: string;
}): Promise<{ id: number }> {
  return apiFetch("/support/ticket", {
    method: "POST",
    body: JSON.stringify({
      service: SERVICE_SLUG,
      ...input,
    }),
  });
}

export async function syncSkusToCloud(
  skus: SkuRecord[],
): Promise<{ saved: number; skipped: number } | null> {
  const token = await getStoredToken();
  if (!token) return null;
  return apiFetch("/skus/sync", {
    method: "PUT",
    body: JSON.stringify({ service: SERVICE_SLUG, skus }),
  });
}

export async function logout(): Promise<void> {
  await setStoredToken(null);
  await chrome.storage.local.set({
    subscription: { tier: "free", stripeCustomerId: null, expiresAt: null },
  });
}

/** Fire-and-forget — for your telemetry dashboard via backend DB. */
export function trackEvent(
  event: string,
  properties: Record<string, string | number | boolean> = {},
): void {
  void apiFetch("/telemetry/event", {
    method: "POST",
    body: JSON.stringify({
      service: SERVICE_SLUG,
      event,
      properties,
    }),
  }).catch(() => {
    /* offline or API down — ignore */
  });
}
