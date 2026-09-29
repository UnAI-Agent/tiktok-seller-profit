import { findByAriaLabel, findControlByLabel } from "./scraper/findLabeledField";

const CHIP_ID = "marginguard-price-guard";
const PRICE_LABEL = /^(retail|sale|list|unit)?\s*price\*?$|^price\s*\(/i;

export function syncPriceGuardChip(
  message: string | null,
  tone: "red" | "amber" | null,
): void {
  document.getElementById(CHIP_ID)?.remove();
  if (!message || !tone) return;
  const input =
    findControlByLabel(PRICE_LABEL) ??
    findByAriaLabel(/price/i) ??
    findControlByLabel(/^your\s*price/i);
  if (!input?.parentElement) return;
  const host = document.createElement("div");
  host.id = CHIP_ID;
  const shadow = host.attachShadow({ mode: "closed" });
  const chip = document.createElement("div");
  chip.textContent = message;
  chip.setAttribute("role", "status");
  chip.style.pointerEvents = "none";
  chip.style.marginTop = "4px";
  chip.style.font = "12px/1.3 system-ui, sans-serif";
  chip.style.color = tone === "red" ? "#b91c1c" : "#b45309";
  shadow.appendChild(chip);
  input.insertAdjacentElement("afterend", host);
}

export function clearPriceGuardChip(): void {
  document.getElementById(CHIP_ID)?.remove();
}
