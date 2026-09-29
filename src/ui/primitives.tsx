import type { ButtonHTMLAttributes, ReactNode } from "react";
import { formatSignedUsd, formatUsd } from "../lib/profit";
import { CheckIcon, LockIcon } from "./icons";
import { TONE, toneForNet, type Tone } from "./tone";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------- Button ---------- */

type ButtonVariant = "primary" | "pro" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-slate-900 text-white hover:bg-slate-800 focus-visible:ring-slate-900",
  pro: "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm hover:from-indigo-500 hover:to-violet-500 focus-visible:ring-indigo-600",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:ring-slate-500",
  ghost: "text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-500",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600",
};
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-3.5 py-2 text-sm",
  lg: "px-4 py-2.5 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  block,
  busy,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx("inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent", className)}
    />
  );
}

/* ---------- Surfaces ---------- */

export function Card({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return <div className={cx("rounded-xl border bg-white", TONE[tone].border, className)}>{children}</div>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{children}</h3>
      {aside}
    </div>
  );
}

export function Alert({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone | "ok";
  children: ReactNode;
  className?: string;
}) {
  const t = tone === "ok" ? "profit" : tone;
  return (
    <div
      role={t === "loss" ? "alert" : "status"}
      className={cx("rounded-lg border px-3 py-2 text-xs leading-relaxed", TONE[t].bg, TONE[t].border, TONE[t].textStrong, className)}
    >
      {children}
    </div>
  );
}

export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4", TONE[tone].pill, className)}>
      {children}
    </span>
  );
}

/* ---------- Plan badges ---------- */

export function PlanBadge({ tier }: { tier: "free" | "pro" | "diamond" }) {
  if (tier === "free") {
    return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold tracking-wide text-slate-600">FREE</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">
      <CheckIcon size={11} />
      {tier === "diamond" ? "DIAMOND" : "PRO"}
    </span>
  );
}

/** Small lock chip for a Pro-only column, label or tile. */
export function ProTag({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-0.5 rounded bg-indigo-50 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-700", className)}>
      <LockIcon size={9} />
      Pro
    </span>
  );
}

/* ---------- Money ---------- */

/** Colored signed dollars. Sign and arrow carry the meaning too, not only color. */
export function Money({
  value,
  known = true,
  signed = true,
  className,
}: {
  value: number;
  known?: boolean;
  signed?: boolean;
  className?: string;
}) {
  if (!known) return <span className={cx("text-slate-400", className)}>—</span>;
  const tone = toneForNet(value);
  return (
    <span className={cx("tabular-nums font-semibold", TONE[tone].text, className)}>
      {signed ? formatSignedUsd(value) : formatUsd(value)}
    </span>
  );
}

export function MarginPill({ pct, tone }: { pct: number | null; tone: Tone }) {
  if (pct == null || !Number.isFinite(pct)) return null;
  return (
    <span className={cx("inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums", TONE[tone].pill)}>
      {pct.toFixed(1)}%
    </span>
  );
}

/* ---------- Form bits ---------- */

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-50";

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-700">
      <span className="mb-1 block">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs font-normal text-red-700">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs font-normal text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}
