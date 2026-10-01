import { isPaidTier } from "./subscription";
import type { SubscriptionTier } from "../types/auth";

/**
 * When the extension asks the server for the seller's plan.
 *
 * Open panels read the cached plan every 2 seconds (GET_TIER, no network).
 * This module decides when that cache is refreshed from /auth/me:
 *   - at most once a minute for routine checks (panel mount, tab focus, worker wake)
 *   - immediately when forced (sign-in, checkout success page, a seller's
 *     "refresh plan" click)
 *   - every 30 seconds for 15 minutes after checkout opens, stopping at Pro
 */
export const TIER_REFRESH_MIN_MS = 60_000;
export const CHECKOUT_POLL_ALARM = "checkoutPoll";
export const CHECKOUT_POLL_WINDOW_MS = 15 * 60_000;
export const CHECKOUT_POLL_PERIOD_MIN = 0.5;

export type TierRefreshDeps = {
  now: () => number;
  /** Calls /auth/me and writes the cached plan. */
  refreshFromServer: () => Promise<unknown>;
  getCachedTier: () => Promise<SubscriptionTier>;
  session: {
    get: (key: string) => Promise<Record<string, unknown>>;
    set: (values: Record<string, unknown>) => Promise<void>;
    remove: (key: string) => Promise<void>;
  };
  alarms: {
    create: (name: string, info: { periodInMinutes: number }) => Promise<void> | void;
    clear: (name: string) => Promise<unknown> | unknown;
  };
};

export function createTierRefresher(deps: TierRefreshDeps) {
  let lastRefreshAt = 0;

  async function refresh(options: { force?: boolean } = {}): Promise<boolean> {
    const now = deps.now();
    if (!options.force) {
      if (!lastRefreshAt) {
        const saved = await deps.session.get("tierRefreshedAt").catch(() => ({}) as Record<string, unknown>);
        const at = saved.tierRefreshedAt;
        if (typeof at === "number") lastRefreshAt = at;
      }
      if (now - lastRefreshAt < TIER_REFRESH_MIN_MS) return false;
    }
    lastRefreshAt = now;
    await deps.session.set({ tierRefreshedAt: now }).catch(() => undefined);
    try {
      await deps.refreshFromServer();
    } catch {
      /* keep the last cached tier when the API is unreachable */
    }
    // The open panel can learn about Pro before the 30s checkout alarm fires.
    // Stop that alarm in the same refresh, or the success banner shows while the poll is still scheduled.
    if (isPaidTier(await deps.getCachedTier())) await stopCheckoutPoll();
    return true;
  }

  async function stopCheckoutPoll(): Promise<void> {
    await deps.alarms.clear(CHECKOUT_POLL_ALARM);
    await deps.session.remove("checkoutPollUntil").catch(() => undefined);
  }

  async function startCheckoutPoll(): Promise<void> {
    await deps.session.set({ checkoutPollUntil: deps.now() + CHECKOUT_POLL_WINDOW_MS }).catch(() => undefined);
    await deps.alarms.create(CHECKOUT_POLL_ALARM, { periodInMinutes: CHECKOUT_POLL_PERIOD_MIN });
  }

  /** One alarm tick. Returns true when it called the server. */
  async function checkoutPollTick(): Promise<boolean> {
    const data = await deps.session.get("checkoutPollUntil").catch(() => ({}) as Record<string, unknown>);
    const until = data.checkoutPollUntil;
    if (typeof until !== "number" || deps.now() > until || isPaidTier(await deps.getCachedTier())) {
      await stopCheckoutPoll();
      return false;
    }
    await refresh({ force: true });
    if (isPaidTier(await deps.getCachedTier())) await stopCheckoutPoll();
    return true;
  }

  /** A new sign-in (or sign-out) must never wait out the one-minute cap. */
  async function reset(): Promise<void> {
    lastRefreshAt = 0;
    await deps.session.remove("tierRefreshedAt").catch(() => undefined);
  }

  return { refresh, reset, startCheckoutPoll, checkoutPollTick };
}
