import type { ReactNode } from "react";
import { Button, cx } from "./primitives";
import { LockIcon } from "./icons";
import { useUpgrade } from "./upgrade";

type ProLockProps = {
  title: string;
  blurb: string;
  /** Realistic-looking placeholder. It is blurred, aria-hidden, and never real data. */
  preview: ReactNode;
  placement: string;
  cta?: string;
  className?: string;
  /** Tighter layout for table rows and small tiles. */
  compact?: boolean;
};

/** A blurred teaser with one clear button. Free users see what exists, not the numbers. */
export default function ProLock({ title, blurb, preview, placement, cta = "Unlock with Pro", className, compact }: ProLockProps) {
  const upgrade = useUpgrade();
  return (
    <div
      className={cx("relative overflow-hidden rounded-xl border border-indigo-200 bg-white", className)}
      data-pro-lock={placement}
    >
      <div aria-hidden="true" className={cx("pointer-events-none select-none opacity-80 blur-[5px]", compact ? "p-2" : "p-3")}>
        {preview}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-white/60 px-3 text-center">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-white shadow">
          <LockIcon size={14} />
        </span>
        <p className="text-xs font-bold text-slate-900">{title}</p>
        {!compact && <p className="max-w-[260px] text-[11px] leading-snug text-slate-600">{blurb}</p>}
        <Button variant="pro" size="sm" onClick={() => upgrade(placement)}>
          {cta}
        </Button>
      </div>
    </div>
  );
}
