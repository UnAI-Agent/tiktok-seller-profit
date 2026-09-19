import { parseMoney } from "./parseProductPage";

/** Pull unit/sales counts from row text or labels (best-effort). */
export function extractUnitsSoldFromText(text: string): number {
  const normalized = text.replace(/\s+/g, " ");
  const patterns = [
    /\bunits?\s*sold[:\s]+([\d,]+)/i,
    /\bsold[:\s]+([\d,]+)/i,
    /\b([\d,]+)\s+units?\s+sold\b/i,
    /\b([\d,]+)\s+sold\b/i,
    /\bsales[:\s]+([\d,]+)/i,
    /\btotal\s*sales[:\s]+([\d,]+)/i,
  ];
  for (const re of patterns) {
    const m = normalized.match(re);
    if (m?.[1]) {
      const n = Math.floor(parseMoney(m[1]));
      if (n > 0) return n;
    }
  }
  return 0;
}
