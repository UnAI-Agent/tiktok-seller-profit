import { describe, expect, it } from "vitest";
import {
  CHECKOUT_POLL_ALARM,
  CHECKOUT_POLL_WINDOW_MS,
  createTierRefresher,
  TIER_REFRESH_MIN_MS,
} from "./tierRefresh";
import type { SubscriptionTier } from "../types/auth";

function harness(startTier: SubscriptionTier = "free") {
  const state = {
    now: 1_000_000,
    tier: startTier as SubscriptionTier,
    serverCalls: 0,
    serverTier: startTier as SubscriptionTier,
    session: {} as Record<string, unknown>,
    alarms: new Map<string, number>(),
  };
  const refresher = createTierRefresher({
    now: () => state.now,
    refreshFromServer: async () => {
      state.serverCalls += 1;
      state.tier = state.serverTier;
    },
    getCachedTier: async () => state.tier,
    session: {
      get: async (key) => (key in state.session ? { [key]: state.session[key] } : {}),
      set: async (values) => {
        Object.assign(state.session, values);
      },
      remove: async (key) => {
        delete state.session[key];
      },
    },
    alarms: {
      create: (name, info) => {
        state.alarms.set(name, info.periodInMinutes);
      },
      clear: (name) => state.alarms.delete(name),
    },
  });
  return { state, refresher };
}

describe("tier refresh budget @F-TIER-REFRESH", () => {
  it("routine checks call the server at most once a minute", async () => {
    const { state, refresher } = harness();
    for (let second = 0; second < 120; second += 2) {
      state.now = 1_000_000 + second * 1000;
      await refresher.refresh();
    }
    // Two minutes of a panel asking every 2 seconds: 60 asks, 2 server calls.
    expect(state.serverCalls).toBe(2);
  });

  it("a forced check always calls the server", async () => {
    const { state, refresher } = harness();
    await refresher.refresh();
    await refresher.refresh({ force: true });
    await refresher.refresh({ force: true });
    expect(state.serverCalls).toBe(3);
  });

  it("a sign-in resets the cap so the new account's plan is fetched at once", async () => {
    const { state, refresher } = harness();
    await refresher.refresh();
    expect(await refresher.refresh()).toBe(false);
    await refresher.reset();
    expect(await refresher.refresh()).toBe(true);
    expect(state.serverCalls).toBe(2);
  });

  it("remembers the last call across a worker restart through session storage", async () => {
    const first = harness();
    await first.refresher.refresh();
    const second = createTierRefresher({
      now: () => first.state.now + TIER_REFRESH_MIN_MS - 1,
      refreshFromServer: async () => {
        first.state.serverCalls += 1;
      },
      getCachedTier: async () => "free",
      session: {
        get: async (key) => ({ [key]: first.state.session[key] }),
        set: async () => undefined,
        remove: async () => undefined,
      },
      alarms: { create: () => undefined, clear: () => undefined },
    });
    expect(await second.refresh()).toBe(false);
    expect(first.state.serverCalls).toBe(1);
  });
});

describe("post-checkout poll @F-TIER-REFRESH", () => {
  it("starts a 30-second alarm and stops as soon as the plan is Pro", async () => {
    const { state, refresher } = harness();
    await refresher.startCheckoutPoll();
    expect(state.alarms.get(CHECKOUT_POLL_ALARM)).toBe(0.5);
    state.now += 30_000;
    expect(await refresher.checkoutPollTick()).toBe(true);
    expect(state.alarms.has(CHECKOUT_POLL_ALARM)).toBe(true);
    state.serverTier = "pro";
    state.now += 30_000;
    expect(await refresher.checkoutPollTick()).toBe(true);
    expect(state.tier).toBe("pro");
    expect(state.alarms.has(CHECKOUT_POLL_ALARM)).toBe(false);
    expect(state.serverCalls).toBe(2);
  });

  it("gives up after 15 minutes without calling the server", async () => {
    const { state, refresher } = harness();
    await refresher.startCheckoutPoll();
    state.now += CHECKOUT_POLL_WINDOW_MS + 1;
    expect(await refresher.checkoutPollTick()).toBe(false);
    expect(state.serverCalls).toBe(0);
    expect(state.alarms.has(CHECKOUT_POLL_ALARM)).toBe(false);
  });

  it("stops the checkout alarm when a plan refresh already sees Pro", async () => {
    const { state, refresher } = harness();
    await refresher.startCheckoutPoll();
    state.serverTier = "pro";
    expect(await refresher.refresh({ force: true })).toBe(true);
    expect(state.alarms.has(CHECKOUT_POLL_ALARM)).toBe(false);
    expect(state.session.checkoutPollUntil).toBeUndefined();
  });

  it("does nothing when the seller is already paid", async () => {
    const { state, refresher } = harness("pro");
    await refresher.startCheckoutPoll();
    expect(await refresher.checkoutPollTick()).toBe(false);
    expect(state.serverCalls).toBe(0);
  });

  it("a tick with no poll running clears a stray alarm", async () => {
    const { state, refresher } = harness();
    state.alarms.set(CHECKOUT_POLL_ALARM, 0.5);
    expect(await refresher.checkoutPollTick()).toBe(false);
    expect(state.alarms.has(CHECKOUT_POLL_ALARM)).toBe(false);
  });
});
