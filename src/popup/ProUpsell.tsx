import PlanPicker from "../ui/PlanPicker";
import { LockIcon } from "../ui/icons";
import { useUpgrade } from "../ui/upgrade";
import { Button } from "../ui/primitives";

type ProUpsellProps = {
  isPro?: boolean;
  /** Small inline card that opens the plan screen. */
  compact?: boolean;
  featureLabel?: string;
  /** Render the full plan picker in place instead of a link to it. */
  inline?: boolean;
  onUnlocked?: () => void;
  onNeedVerify?: () => void;
};

/**
 * One upsell per screen. `compact` (default) is a slim strip that opens the plan
 * screen; `inline` shows the full plan picker.
 */
export default function ProUpsell({
  isPro,
  compact = true,
  featureLabel = "Max safe commission and ad targets",
  inline = false,
  onUnlocked,
  onNeedVerify,
}: ProUpsellProps) {
  const upgrade = useUpgrade();
  if (isPro) return null;
  if (inline) {
    return <PlanPicker onUnlocked={onUnlocked} onNeedVerify={onNeedVerify} headline={featureLabel} />;
  }
  return (
    <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
        <LockIcon size={14} />
      </span>
      <p className="min-w-0 flex-1 text-xs font-semibold leading-snug text-indigo-950">{featureLabel}</p>
      <Button variant="pro" size="sm" onClick={() => upgrade(compact ? "strip" : "strip-full")}>
        See Pro
      </Button>
    </div>
  );
}
