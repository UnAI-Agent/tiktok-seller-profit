export type SubscriptionTier = "free" | "pro";

export type StoredSubscription = {
  tier: SubscriptionTier;
  stripeCustomerId: string | null;
  expiresAt: string | null;
};

export type AuthSession = {
  email: string;
  isPro: boolean;
  usageLimit: number;
};
