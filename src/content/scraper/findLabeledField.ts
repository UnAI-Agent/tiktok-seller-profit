export type FormControl = HTMLInputElement | HTMLTextAreaElement;

const LABEL_MAX_LEN = 48;

function isFormControl(el: Element | null): el is FormControl {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

function labelMatches(text: string, pattern: RegExp): boolean {
  const line = text.split("\n")[0]?.trim() ?? "";
  if (line.length > LABEL_MAX_LEN) return false;
  return pattern.test(line);
}

function controlInContainer(container: Element | null): FormControl | null {
  if (!container) return null;
  const candidates = container.querySelectorAll(
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea',
  );
  for (const el of candidates) {
    if (!isFormControl(el)) continue;
    if (el.disabled || el.type === "file") continue;
    return el;
  }
  return null;
}

/** TikTok Seller Center uses div labels more often than <label for="">. */
export function findControlByLabel(
  pattern: RegExp,
  doc: Document = document,
): FormControl | null {
  const labelLike = doc.querySelectorAll("label, span, p, div");

  for (const el of labelLike) {
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent?.trim() ?? "")
      .join(" ")
      .trim();

    const text = ownText || (el.textContent ?? "").trim();
    if (!labelMatches(text, pattern)) continue;

    if (el instanceof HTMLLabelElement && el.htmlFor) {
      const linked = doc.getElementById(el.htmlFor);
      if (isFormControl(linked)) return linked;
    }

    const fieldRoot =
      el.closest(
        '[class*="form"], [class*="field"], [class*="item"], [class*="cell"], [class*="row"]',
      ) ?? el.parentElement;

    const inRoot = controlInContainer(fieldRoot);
    if (inRoot) return inRoot;

    let sibling: Element | null = el.nextElementSibling;
    for (let i = 0; i < 3 && sibling; i += 1) {
      if (isFormControl(sibling)) return sibling;
      const nested = controlInContainer(sibling);
      if (nested) return nested;
      sibling = sibling.nextElementSibling;
    }
  }

  return null;
}

export function findByAriaLabel(
  pattern: RegExp,
  doc: Document = document,
): FormControl | null {
  const all = doc.querySelectorAll(
    "input[aria-label], textarea[aria-label], input[placeholder], textarea[placeholder]",
  );
  for (const el of all) {
    if (!isFormControl(el)) continue;
    const aria = el.getAttribute("aria-label") ?? "";
    const placeholder = el.getAttribute("placeholder") ?? "";
    if (pattern.test(aria) || pattern.test(placeholder)) return el;
  }
  return null;
}

export function readPageHeaderTitle(doc: Document = document): string | null {
  const header = doc.querySelector("header");
  if (!header) return null;

  const candidates = header.querySelectorAll("h1, h2, span, div");
  for (const el of candidates) {
    const text = el.textContent?.trim() ?? "";
    if (text.length < 8 || text.length > 200) continue;
    if (/save as draft|submit for review|product/i.test(text) && text.length < 20)
      continue;
    if (el.closest("button")) continue;
    return text;
  }
  return null;
}

export function findLargestProductNameTextarea(
  doc: Document = document,
): FormControl | null {
  let best: HTMLTextAreaElement | null = null;
  let bestLen = 0;
  for (const ta of doc.querySelectorAll("textarea")) {
    const len = ta.value.trim().length;
    if (len > bestLen) {
      bestLen = len;
      best = ta;
    }
  }
  return bestLen >= 8 ? best : null;
}
