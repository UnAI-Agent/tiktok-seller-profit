import { parseSpsScore } from "../lib/sps";
import { SELECTORS, withRemote } from "./scraper/domSelectors";

const LABEL_RE = /^(shop performance score|sps)\b/i;
/** How far above the label the score may sit (label span → title row → card). */
const MAX_DEPTH = 4;
/** Never climb to page-wide containers: their text includes other cards and inline scripts. */
const STOP_TAGS = new Set(["BODY", "HTML", "MAIN"]);
/** Seller Center shows this instead of a score until a shop has 30 orders in 90 days. */
const NO_SCORE = /not enough|no score|no data|unavailable|n\/a|--/i;
const WINDOW = 40;

/** Visible text: innerText skips <script>/<style>; test DOMs without layout fall back to textContent. */
function visibleText(node: Element): string {
  const inner = (node as HTMLElement).innerText;
  const raw = typeof inner === "string" && inner.trim() ? inner : node.textContent ?? "";
  return raw.replace(/\s+/g, " ");
}

/**
 * Reads the Shop Performance Score from the seller's own Seller Center page
 * (Account Health, or the Home widget). Order:
 *   1. a signed remote selector, then the bundled selectors
 *   2. an element labelled "Shop Performance Score" and the first 0–5 number
 *      right after that label in the nearest ancestor that has one
 * Returns null when nothing on the page looks like the score.
 */
export function readSpsFromDocument(doc: Document = document): number | null {
  for (const selector of withRemote("spsScore", SELECTORS.spsScore)) {
    let el: Element | null = null;
    try {
      el = doc.querySelector(selector);
    } catch {
      continue;
    }
    const value = el ? parseSpsScore(el.textContent ?? "") : null;
    if (value != null) return value;
  }

  const candidates = doc.querySelectorAll("span, div, p, h1, h2, h3, h4, label, dt, th");
  for (const el of candidates) {
    const own = Array.from(el.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!own || own.length > 40 || !LABEL_RE.test(own)) continue;
    // Walk up until an ancestor holds a score right after the label. Class names
    // change often in Seller Center, so structure is used instead of them.
    let node: Element | null = el.parentElement;
    for (let depth = 0; node && depth < MAX_DEPTH; depth += 1, node = node.parentElement) {
      if (STOP_TAGS.has(node.tagName)) break;
      const text = visibleText(node);
      const at = text.toLowerCase().indexOf(own.toLowerCase());
      if (at < 0) continue;
      const after = text.slice(at + own.length, at + own.length + WINDOW);
      if (NO_SCORE.test(after)) return null;
      const value = parseSpsScore(after);
      if (value != null) return value;
    }
  }
  return null;
}
