import { spsColors, spsLevel } from "../../lib/sps";

type SpsBadgeProps = {
  score: number;
};

export default function SpsBadge({ score }: SpsBadgeProps) {
  const level = spsLevel(score);
  const { bg, text } = spsColors(level);

  return (
    <span
      className="inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold"
      style={{ backgroundColor: bg, color: text }}
    >
      SPS {Math.round(score)}
    </span>
  );
}
