export type SubscriptionTier = "free" | "pro" | "diamond";

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
