export type SpsLevel = "excellent" | "good" | "warning" | "critical";

export type SpsSnapshot = {
  score: number;
  source: "native" | "proxy";
  lateShipmentRatePct: number;
  cancellationRatePct: number;
  avgRating: number;
  updatedAt: string;
};

export function clampScore(score: number): number {
  return Math.min(100, Math.max(0, score));
}

export function computeProxySps(
  lateShipmentRatePct: number,
  cancellationRatePct: number,
  avgRating: number,
): number {
  return clampScore(
    100 -
      lateShipmentRatePct * 2 -
      cancellationRatePct * 3 -
      Math.max(0, 4.0 - avgRating) * 10,
  );
}

export function spsLevel(score: number): SpsLevel {
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 60) return "warning";
  return "critical";
}

export function spsColors(level: SpsLevel): { bg: string; text: string } {
  switch (level) {
    case "excellent":
      return { bg: "#16A34A", text: "#ffffff" };
    case "good":
      return { bg: "#2563EB", text: "#ffffff" };
    case "warning":
      return { bg: "#CA8A04", text: "#ffffff" };
    case "critical":
      return { bg: "#DC2626", text: "#ffffff" };
  }
}
