type SoftNudgeProps = {
  onUpgrade: () => void;
  onDismiss: () => void;
  busy?: boolean;
};

export default function SoftNudge({ onUpgrade, onDismiss, busy }: SoftNudgeProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
      <p className="font-semibold text-slate-900">Getting value from the overlay?</p>
      <p className="mt-1 text-xs text-slate-500">
        Upgrade when you hit the Free SKU cap, or skip — no pressure.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy}
          className="flex-1 rounded-lg bg-slate-900 py-2 text-xs font-semibold text-white disabled:opacity-50"
          onClick={onUpgrade}
        >
          {busy ? "Opening…" : "See Pro"}
        </button>
        <button
          type="button"
          className="flex-1 rounded-lg border border-slate-200 py-2 text-xs font-medium text-slate-600"
          onClick={onDismiss}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
