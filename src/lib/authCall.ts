import { errorTextFromJson } from "./apiErrors";

export type AuthResult =
  | { ok: true; token?: string }
  | { ok: false; error: string; status: number };

/** One POST from the service worker. The page never receives the token. */
export async function postAuth(
  path: "/auth/login" | "/auth/register" | "/auth/forgot-password",
  body: { email: string; password?: string },
  fetchImpl: typeof fetch,
  baseUrl: string,
): Promise<AuthResult> {
  const res = await fetchImpl(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: { access_token?: string } | null = null;
  try {
    json = text ? (JSON.parse(text) as { access_token?: string }) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    return { ok: false, error: errorTextFromJson(json, res.status), status: res.status };
  }
  if (path !== "/auth/forgot-password" && !json?.access_token) {
    return { ok: false, error: "Sign-in could not finish.", status: 500 };
  }
  return { ok: true, token: json?.access_token };
}
