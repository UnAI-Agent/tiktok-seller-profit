export const CONNECTION_LOST = "Connection lost. Check your internet.";
export const AUTH_EXPIRED_EVENT = "tst-auth-expired";

export type ApiErrorCode =
  | "unauthorized"
  | "payment_required"
  | "timeout"
  | "network"
  | "rate_limited"
  | "http";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    status: number,
    code: ApiErrorCode,
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }

  get userMessage(): string {
    if (this.code === "network" || this.code === "timeout") return CONNECTION_LOST;
    if (this.code === "unauthorized") return "Session expired. Please log in again.";
    if (this.code === "payment_required") return "This feature requires Pro.";
    if (this.code === "rate_limited") return "Too many requests. Please wait a moment.";
    return this.message || "Something went wrong. Try again.";
  }
}

export function isConnectionError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.code === "network" || err.code === "timeout")
  );
}

/** FastAPI `{detail}` or `{error}` — never dump raw HTML/stack traces to the UI. */
export function parseErrorBody(text: string, status: number): string {
  const trimmed = text.trim();
  if (!trimmed) {
    if (status === 401) return "Invalid email or password.";
    if (status === 404) return "Account not found.";
    return "Request failed.";
  }
  try {
    const json = JSON.parse(trimmed) as {
      detail?: unknown;
      error?: unknown;
      message?: unknown;
    };
    const detail = json.detail ?? json.error ?? json.message;
    if (typeof detail === "string" && detail.length < 280) return detail;
    if (Array.isArray(detail)) {
      const first = detail[0] as { msg?: string } | string | undefined;
      if (typeof first === "string") return first;
      if (first && typeof first.msg === "string") return first.msg;
    }
  } catch {
    /* not JSON */
  }
  if (status === 401) return "Invalid email or password.";
  if (status === 400 && /already registered/i.test(trimmed)) {
    return "That email is already registered. Log in instead.";
  }
  return "Request failed. Try again.";
}

export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return undefined;
}
