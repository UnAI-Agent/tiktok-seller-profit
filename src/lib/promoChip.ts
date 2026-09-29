import { formatUsd } from "./profit";

export function promoGuardLine(price: number, netPerUnit: number, breakEven: number): string | null {
  if (netPerUnit >= 0) return null;
  return `At ${formatUsd(price)} you lose ${formatUsd(Math.abs(netPerUnit))} per sale. Break-even is ${formatUsd(breakEven)}.`;
}
