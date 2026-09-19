type AuthSplashProps = {
  onLogIn: () => void;
  onSignUp: () => void;
};

const STEPS = [
  {
    n: "1",
    title: "Live overlay",
    body: "See fees, COGS, shipping, and net margin on Seller Center.",
  },
  {
    n: "2",
    title: "SKU dashboard",
    body: "Auto-sync listings, then sort and filter by margin.",
  },
  {
    n: "3",
    title: "Free or Pro",
    body: "10 SKUs free. Pro unlocks unlimited SKUs, creators, and price compare.",
  },
] as const;

export default function AuthSplash({ onLogIn, onSignUp }: AuthSplashProps) {
  return (
    <div className="flex flex-1 flex-col px-1 py-4">
      <div className="mb-4 flex flex-col items-center text-center">
        <div className="relative mb-4">
          <div className="absolute -inset-3 rounded-full bg-gradient-to-br from-tiktok/20 to-rose-200/40 blur-md" />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-tiktok text-lg font-bold text-white shadow-lg">
            TT
          </div>
        </div>
        <h2 className="text-lg font-semibold text-slate-900">
          TikTok Seller Tool
        </h2>
        <p className="mt-1 max-w-[280px] text-sm text-slate-600">
          Real-time profit for TikTok Shop — no need to open Settings first.
        </p>
      </div>

      <ol className="space-y-2.5">
        {STEPS.map((step) => (
          <li
            key={step.n}
            className="flex gap-3 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 text-left shadow-sm"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
              {step.n}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{step.title}</p>
              <p className="text-xs leading-relaxed text-slate-500">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 space-y-2.5">
        <button
          type="button"
          className="w-full rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 py-3 text-sm font-semibold text-white shadow-md hover:from-slate-800 hover:to-slate-700"
          onClick={onSignUp}
        >
          Create account
        </button>
        <button
          type="button"
          className="w-full rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
          onClick={onLogIn}
        >
          Log in
        </button>
      </div>
    </div>
  );
}
