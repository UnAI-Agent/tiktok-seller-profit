import { useEffect, useState } from "react";
import { fetchMe, type MeResponse } from "../lib/apiClient";
import { tierFromProfile } from "../lib/subscription";
import { ChevronRightIcon } from "../ui/icons";
import { PlanBadge } from "../ui/primitives";

type AccountPanelProps = {
  onChanged?: () => void;
  /** Opens the full Account screen. */
  onOpenAccount?: () => void;
};

/** Compact plan row for Settings. Everything else lives on the Account screen. */
export default function AccountPanel({ onOpenAccount }: AccountPanelProps) {
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    let cancel = false;
    void fetchMe()
      .then((profile) => {
        if (!cancel) setMe(profile);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  const tier = tierFromProfile(me) ?? "free";
  return (
    <button
      type="button"
      onClick={onOpenAccount}
      disabled={!onOpenAccount}
      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-default"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{me?.email ?? "Your account"}</span>
        <span className="mt-1 flex items-center gap-2 text-xs text-slate-500">
          <PlanBadge tier={tier} />
          {tier === "free" ? "Upgrade, billing, password" : "Billing, password, profile"}
        </span>
      </span>
      {onOpenAccount && <ChevronRightIcon size={18} className="text-slate-400" />}
    </button>
  );
}
