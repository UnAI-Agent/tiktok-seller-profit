import { CheckIcon, XIcon } from "../../ui/icons";
import { Button, cx } from "../../ui/primitives";

type FirstRunChecklistProps = {
  productCount: number;
  costsSaved: number;
  onAddCosts: () => void;
  onSeeLosers: () => void;
  onDismiss: () => void;
};

const GOAL = 3;

/** Three steps to a first real answer: who is losing money. Dismissible, shown until step 3. */
export default function FirstRunChecklist({ productCount, costsSaved, onAddCosts, onSeeLosers, onDismiss }: FirstRunChecklistProps) {
  const imported = productCount > 0;
  const costsDone = costsSaved >= GOAL;
  const done = [imported, costsDone, costsDone].filter(Boolean).length;

  const step = (n: number, ok: boolean, title: string, action?: ReactAction) => (
    <li className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={cx(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          ok ? "bg-emerald-600 text-white" : "border-2 border-slate-300 text-slate-500",
        )}
      >
        {ok ? <CheckIcon size={13} /> : n}
      </span>
      <span className={cx("min-w-0 flex-1 text-sm", ok ? "text-slate-500 line-through" : "font-semibold text-slate-900")}>{title}</span>
      {!ok && action && (
        <Button variant="secondary" size="sm" onClick={action.run}>
          {action.label}
        </Button>
      )}
    </li>
  );

  return (
    <section className="mx-4 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-3" aria-label="Getting started">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">Your first profit check · {done}/3</p>
        <button
          type="button"
          aria-label="Dismiss getting started"
          className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          onClick={onDismiss}
        >
          <XIcon size={14} />
        </button>
      </div>
      <ul className="space-y-2">
        {step(1, imported, "Products imported")}
        {step(2, costsDone, `Add costs to ${GOAL} products (${Math.min(costsSaved, GOAL)}/${GOAL})`, { label: "Add costs", run: onAddCosts })}
        {step(3, costsDone && costsSaved > 0, "See who's losing money", imported && costsSaved > 0 ? { label: "Show me", run: onSeeLosers } : undefined)}
      </ul>
    </section>
  );
}

type ReactAction = { label: string; run: () => void };
