export type QuotaState = { day: string; count: number };

export function localDay(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function consumeProductCheck(
  state: QuotaState | null,
  now: Date,
  limit: number | null,
): { allowed: boolean; next: QuotaState } {
  const day = localDay(now);
  const count = state && state.day === day ? state.count : 0;
  if (limit == null) return { allowed: true, next: { day, count } };
  if (count >= limit) return { allowed: false, next: { day, count } };
  return { allowed: true, next: { day, count: count + 1 } };
}
