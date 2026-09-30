import { fetchMe, getStoredToken, refreshAccessToken, tokenExpiresWithin } from "./apiClient";
import { isConnectionError } from "./apiErrors";
import { sendMessage } from "./messages";
import type { StoredSubscription, SubscriptionTier } from "../types/auth";

export function tierFromProfile(profile: {
  tier?: string | null;
  is_pro?: boolean;
} | null): SubscriptionTier | null {
  if (!profile) return null;
  if (profile.tier === "pro" || profile.tier === "diamond") return profile.tier;
  // The API's is_pro flag is the same decision as tier. Older APIs (or a row
  // without a tier) still send is_pro, so never show Upgrade to a Pro account.
  if (profile.is_pro === true) return "pro";
  return "free";
}

export function isPaidTier(tier: SubscriptionTier | null | undefined): boolean {
  return tier === "pro" || tier === "diamond";
}

export async function refreshSubscriptionCache(): Promise<SubscriptionTier> {
  const cached = await getCachedTier();
  try {
    const token = await getStoredToken();
    if (token && tokenExpiresWithin(token, 7 * 86400)) {
      await refreshAccessToken();
    }
    const tier = tierFromProfile(await fetchMe());
    if (!tier) return cached;
    const values: Record<string, unknown> = {
      subscription: {
        tier,
        stripeCustomerId: null,
        expiresAt: null,
      } satisfies StoredSubscription,
    };
    // Free → Pro: the overlay shows a one-time "Pro unlocked" banner.
    if (!isPaidTier(cached) && isPaidTier(tier)) values.proJustUnlocked = true;
    await chrome.storage.local.set(values);
    return tier;
  } catch (err) {
    if (isConnectionError(err)) return cached;
    throw err;
  }
}

export async function getCachedTier(): Promise<SubscriptionTier> {
  const data = await chrome.storage.local.get("subscription");
  const sub = data.subscription as StoredSubscription | undefined;
  if (sub?.tier === "pro" || sub?.tier === "diamond") return sub.tier;
  return "free";
}

function paidOrFree(tier: unknown): SubscriptionTier {
  return tier === "pro" || tier === "diamond" ? tier : "free";
}

/**
 * The cached plan, from any context. Seller Center pages cannot read extension
 * storage, so they ask the service worker. No network call.
 */
export async function readTier(): Promise<SubscriptionTier | null> {
  const res = await sendMessage({ type: "GET_TIER" });
  // A failed message (extension reload) is not a Free answer. Callers ignore null.
  return res.ok ? paidOrFree(res.tier) : null;
}

/** Ask the service worker to re-check the plan with the API now, then return it. */
export async function refreshTier(): Promise<SubscriptionTier> {
  const res = await sendMessage({ type: "AUTH_STATUS" });
  return res.ok ? paidOrFree(res.tier) : "free";
}
