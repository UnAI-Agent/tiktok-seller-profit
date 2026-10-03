import type { MeResponse } from "./apiClient";

/** How long a second /auth/me for the same token can reuse the answer just fetched. */
const SHARE_MS = 5_000;

type Shared = { token: string; at: number; body: MeResponse };

let shared: Shared | null = null;
let flight: { token: string; promise: Promise<MeResponse>; at: number } | null = null;
let generation = 0;

export function clearSharedAuthMe(): void {
  shared = null;
  generation += 1;
}

export function sharedAuthMeEmail(token: string): string | null {
  if (!shared || shared.token !== token) return null;
  return shared.body.email || null;
}

/**
 * One in-flight /auth/me per token. A follow-up from the open panel reuses that
 * answer for a few seconds instead of starting another request.
 * `fresh` always hits the network (sign-in and the forced plan check).
 */
export async function shareAuthMe(
  token: string,
  load: () => Promise<MeResponse>,
  fresh = false,
  notBefore = 0,
): Promise<MeResponse> {
  // A new Seller Center document must not reuse a profile fetched for the previous one.
  // That hid a stopped API and a plan that had just changed.
  if (!fresh && shared && shared.token === token && shared.at >= notBefore && Date.now() - shared.at < SHARE_MS) return shared.body;
  if (!fresh && flight && flight.token === token && flight.at >= notBefore) return flight.promise;
  const gen = ++generation;
  const started = Date.now();
  const promise = load()
    .then((body) => {
      if (gen === generation) shared = { token, at: Date.now(), body };
      return body;
    })
    .finally(() => {
      if (flight?.promise === promise) flight = null;
    });
  flight = { token, promise, at: started };
  return promise;
}
