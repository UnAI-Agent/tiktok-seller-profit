import { spsColors, spsLevel } from "../../lib/sps";

type SpsBadgeProps = {
  score: number | null;
  source?: "native" | "proxy";
  updatedLabel?: string;
};

/** Hidden until a real account-health score is scraped. */
export default function SpsBadge({ score, source, updatedLabel }: SpsBadgeProps) {
  if (score == null || source !== "native") return null;
  const level = spsLevel(score);
  const { bg, text } = spsColors(level);
  return (
    <span
      className="inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold"
      style={{ backgroundColor: bg, color: text }}
    >
      SPS {Math.round(score)}
      {updatedLabel ? ` · updated ${updatedLabel}` : ""}
    </span>
  );
}
