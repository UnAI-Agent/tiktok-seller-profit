export type TrendEventName = "product_checked" | "product_added" | "product_removed";

export type TrendEvent = {
  event: TrendEventName;
  productId: string;
  weekToken: string;
  day: string;
  snapshot: {
    price: number;
    soldCountApprox: number;
    rating: number;
    reviewCount: number;
    categoryPath?: string;
  };
};

export function isoWeek(date: Date): string {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function weekToken(installSecret: Uint8Array, date: Date): Promise<string> {
  const bytes = new Uint8Array(installSecret.length + isoWeek(date).length);
  bytes.set(installSecret, 0);
  bytes.set(new TextEncoder().encode(isoWeek(date)), installSecret.length);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

export function enqueueTrend(
  queue: TrendEvent[],
  event: TrendEvent,
): TrendEvent[] {
  const key = `${event.productId}:${event.event}:${event.day}`;
  const without = queue.filter((row) => `${row.productId}:${row.event}:${row.day}` !== key);
  return [...without, event].slice(-50);
}

export function trendRequestInit(body: string): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  };
}
