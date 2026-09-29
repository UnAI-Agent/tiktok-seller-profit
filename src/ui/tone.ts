/**
 * One place for the money colors. Green = you make money, red = you lose it,
 * amber = thin, slate = unknown. Indigo is reserved for Pro so it never reads
 * as profit or loss. Every pair below is WCAG AA on its own background.
 */
export type Tone = "profit" | "warning" | "loss" | "neutral";

export const TONE = {
  profit: {
    text: "text-emerald-700",
    textStrong: "text-emerald-800",
    bg: "bg-emerald-50",
    bgSolid: "bg-emerald-600",
    border: "border-emerald-200",
    ring: "ring-emerald-200",
    dot: "bg-emerald-500",
    accent: "border-l-emerald-500",
    bar: "bg-emerald-500",
    hero: "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-emerald-50",
    pill: "bg-emerald-100 text-emerald-800",
  },
  warning: {
    text: "text-amber-700",
    textStrong: "text-amber-900",
    bg: "bg-amber-50",
    bgSolid: "bg-amber-500",
    border: "border-amber-200",
    ring: "ring-amber-200",
    dot: "bg-amber-500",
    accent: "border-l-amber-500",
    bar: "bg-amber-400",
    hero: "border-amber-200 bg-gradient-to-br from-amber-50 via-white to-amber-50",
    pill: "bg-amber-100 text-amber-900",
  },
  loss: {
    text: "text-red-700",
    textStrong: "text-red-800",
    bg: "bg-red-50",
    bgSolid: "bg-red-600",
    border: "border-red-200",
    ring: "ring-red-200",
    dot: "bg-red-500",
    accent: "border-l-red-500",
    bar: "bg-red-500",
    hero: "border-red-200 bg-gradient-to-br from-red-50 via-white to-red-50",
    pill: "bg-red-100 text-red-800",
  },
  neutral: {
    text: "text-slate-600",
    textStrong: "text-slate-800",
    bg: "bg-slate-50",
    bgSolid: "bg-slate-500",
    border: "border-slate-200",
    ring: "ring-slate-200",
    dot: "bg-slate-400",
    accent: "border-l-slate-400",
    bar: "bg-slate-300",
    hero: "border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-50",
    pill: "bg-slate-100 text-slate-700",
  },
} as const;

/** Sign of a per-sale profit → tone. Zero is "loss" (break-even is not a win). */
export function toneForNet(net: number, known = true): Tone {
  if (!known) return "neutral";
  return net > 0.004 ? "profit" : "loss";
}

/** Diagnosis colors from diagnose.ts map onto the same palette. */
export function toneForDiagnosis(tone: "grey" | "red" | "amber" | "green"): Tone {
  return tone === "green" ? "profit" : tone === "red" ? "loss" : tone === "amber" ? "warning" : "neutral";
}
