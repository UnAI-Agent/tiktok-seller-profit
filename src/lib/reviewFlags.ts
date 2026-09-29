export type ReviewFlag = "sizing" | "broke" | "shipping" | "smell" | "fake" | "refund";

const RULES: Array<{ flag: ReviewFlag; pattern: RegExp }> = [
  { flag: "sizing", pattern: /\b(siz(e|ing)|too small|too large|tight|fit)\b/i },
  { flag: "broke", pattern: /\b(broke|broken|defect(?:ive)?)\b/i },
  { flag: "shipping", pattern: /\b(late|shipping|delivery)\b/i },
  { flag: "smell", pattern: /\b(smell|odor|scent)\b/i },
  { flag: "fake", pattern: /\b(fake|counterfeit)\b/i },
  { flag: "refund", pattern: /\b(refund|return)\b/i },
];

export function reviewFlags(
  reviews: Array<{ text: string; stars: number }>,
): Array<{ flag: ReviewFlag; count: number }> {
  const counts = new Map<ReviewFlag, number>();
  for (const review of reviews) {
    if (review.stars > 2) continue;
    const seen = new Set<ReviewFlag>();
    for (const rule of RULES) {
      if (rule.pattern.test(review.text)) seen.add(rule.flag);
    }
    for (const flag of seen) counts.set(flag, (counts.get(flag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([flag, count]) => ({ flag, count }))
    .sort((a, b) => b.count - a.count || a.flag.localeCompare(b.flag))
    .slice(0, 2);
}
