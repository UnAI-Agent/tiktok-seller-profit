import { fetchMe } from "./apiClient";
import { isConnectionError } from "./apiErrors";
import type { StoredSubscription, SubscriptionTier } from "../types/auth";

export async function refreshSubscriptionCache(): Promise<SubscriptionTier> {
  try {
    const profile = await fetchMe();
    const tier: SubscriptionTier = profile?.is_pro ? "pro" : "free";
    await chrome.storage.local.set({
      subscription: {
        tier,
        stripeCustomerId: null,
        expiresAt: null,
      } satisfies StoredSubscription,
    });
    return tier;
  } catch (err) {
    if (isConnectionError(err)) return getCachedTier();
    throw err;
  }
}

export async function getCachedTier(): Promise<SubscriptionTier> {
  const data = await chrome.storage.local.get("subscription");
  const sub = data.subscription as StoredSubscription | undefined;
  return sub?.tier === "pro" ? "pro" : "free";
}
