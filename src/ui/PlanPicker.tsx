import { useEffect, useRef, useState } from "react";
import { PRO_PRICE_MONTHLY, PRO_PRICE_YEARLY, PRIVACY_URL, TERMS_URL } from "../config";
import { ApiError } from "../lib/apiErrors";
import { createCheckoutUrl, fetchMe, trackEvent, type MeResponse } from "../lib/apiClient";
import { renewalDisclosure, yearlySavingsPct, type BillingInterval } from "../lib/billingDisclosure";
import { flagEnabled } from "../content/activeConfig";
import { openTab } from "../lib/openTab";
import { isPaidTier, refreshTier, tierFromProfile } from "../lib/subscription";
import tiers from "../tiers.json";
import { CheckIcon, XIcon } from "./icons";
import { Alert, Button, cx, Spinner } from "./primitives";

const WAIT_POLL_MS = 4_000;
const WAIT_MAX_MS = 5 * 60_000;

/** Free vs Pro, in the words a seller uses. Every Pro line exists in the product. */
export const COMPARE_ROWS: Array<{ label: string; free: string | boolean; pro: string | boolean }> = [
  { label: "Profit per sale, green/red at a glance", free: true, pro: true },
  { label: "Products with your own costs", free: `${tiers.free.skuLimit}`, pro: "Unlimited" },
  { label: "Break-even price + loss warning", free: true, pro: true },
  { label: "Max safe creator commission", free: false, pro: true },
  { label: "Ad limits: max CPA + GMV Max ROAS", free: false, pro: true },
  { label: "Fix advice for every losing product", free: false, pro: true },
  { label: "Real fees from your statement", free: false, pro: true },
  { label: "What-if price simulator", free: false, pro: true },
  { label: "CSV export + price compare", free: false, pro: true },
];

function Cell({ value }: { value: string | boolean }) {
  if (value === true) return <CheckIcon size={14} className="mx-auto text-emerald-600" />;
  if (value === false) return <XIcon size={13} className="mx-auto text-slate-300" />;
  return <span className="text-xs font-semibold text-slate-800">{value}</span>;
}

type PlanPickerProps = {
  /** Called once the account reads Pro. */
  onUnlocked?: () => void;
  /** 403 from checkout means the email is not verified yet. */
  onNeedVerify?: () => void;
  headline?: string;
  subline?: string;
  placement?: string;
  showCompare?: boolean;
  me?: MeResponse | null;
};

export default function PlanPicker({
  onUnlocked,
  onNeedVerify,
  headline = "Find every leak. Fix it fast.",
  subline = "Pro shows the exact commission, ad, and price limits that keep each product profitable.",
  placement = "plan",
  showCompare = true,
  me: meProp,
}: PlanPickerProps) {
  const [me, setMe] = useState<MeResponse | null>(meProp ?? null);
  const [interval, setInterval_] = useState<BillingInterval>("yearly");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const startedAt = useRef(0);

  useEffect(() => {
    if (meProp !== undefined) {
      setMe(meProp);
      return;
    }
    let cancel = false;
    void fetchMe()
      .then((profile) => {
        if (!cancel) setMe(profile);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [meProp]);

  // After checkout opens in a new tab, watch for the webhook to flip the plan.
  useEffect(() => {
    if (!waiting) return;
    startedAt.current = Date.now();
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const tier = await refreshTier();
          if (isPaidTier(tier)) {
            window.clearInterval(timer);
            setWaiting(false);
            setUnlocked(true);
            trackEvent("upgrade.unlocked", { placement });
            onUnlocked?.();
          } else if (Date.now() - startedAt.current > WAIT_MAX_MS) {
            window.clearInterval(timer);
            setWaiting(false);
          }
        } catch {
          /* keep polling; offline is temporary */
        }
      })();
    }, WAIT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, onUnlocked, placement]);

  const trial = me?.trial_available !== false;
  const already = me ? tierFromProfile(me) !== "free" : false;

  async function checkout() {
    setBusy(true);
    setError(null);
    setNeedsVerify(false);
    trackEvent("upgrade.clicked", { placement, interval });
    try {
      const url = await createCheckoutUrl(interval);
      const opened = await openTab(url);
      if (!opened) throw new Error("checkout-tab");
      setWaiting(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setNeedsVerify(true);
      } else {
        setError(err instanceof ApiError ? err.userMessage : "Checkout didn't open. Nothing was charged. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (unlocked || already) {
    return (
      <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
        <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white">
          <CheckIcon size={18} />
        </span>
        <p className="text-sm font-bold text-emerald-900">{unlocked ? "Pro is unlocked" : "You're on Pro"}</p>
        <p className="text-xs text-emerald-800">
          Every lock in MarginMark is open. Manage or cancel any time from Account → Manage billing.
        </p>
      </div>
    );
  }

  const price = interval === "yearly" ? PRO_PRICE_YEARLY : PRO_PRICE_MONTHLY;
  const per = interval === "yearly" ? "/yr" : "/mo";
  const cta = trial ? `Start ${tiers.pro.trialDays}-day free trial` : "Upgrade to Pro";

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-bold leading-tight text-slate-900">{headline}</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">{subline}</p>
      </div>

      {showCompare && (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-1.5">What you get</th>
                <th className="w-12 px-1 py-1.5 text-center">Free</th>
                <th className="w-16 bg-indigo-50 px-1 py-1.5 text-center text-indigo-700">Pro</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.label} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 text-xs text-slate-700">{row.label}</td>
                  <td className="px-1 py-1.5 text-center"><Cell value={row.free} /></td>
                  <td className="bg-indigo-50/50 px-1 py-1.5 text-center"><Cell value={row.pro} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {flagEnabled("diamondEnabled", "free") && (
        <p className="text-xs font-semibold text-slate-700">Diamond · ${tiers.diamond.monthlyUsd}/mo</p>
      )}

      <div role="radiogroup" aria-label="Billing period" className="grid grid-cols-2 gap-2">
        {(["yearly", "monthly"] as const).map((id) => {
          const active = interval === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setInterval_(id)}
              className={cx(
                "relative rounded-xl border-2 px-3 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                active ? "border-indigo-600 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300",
              )}
            >
              {id === "yearly" && (
                <span className="absolute -top-2 right-2 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  Save {yearlySavingsPct()}%
                </span>
              )}
              <span className="block text-[11px] font-semibold text-slate-500">{id === "yearly" ? "Yearly" : "Monthly"}</span>
              <span className="block text-lg font-extrabold leading-tight tabular-nums text-slate-900">
                ${id === "yearly" ? PRO_PRICE_YEARLY : PRO_PRICE_MONTHLY}
                <span className="text-xs font-semibold text-slate-500">{id === "yearly" ? "/yr" : "/mo"}</span>
              </span>
              {id === "yearly" && (
                <span className="block text-[11px] text-slate-500">${(PRO_PRICE_YEARLY / 12).toFixed(2)}/mo</span>
              )}
            </button>
          );
        })}
      </div>

      <Button variant="pro" size="lg" block busy={busy} onClick={() => void checkout()}>
        {busy ? "Opening checkout…" : `${cta} · $${price}${per}`}
      </Button>
      <p className="text-[11px] leading-relaxed text-slate-500">
        {renewalDisclosure(interval, trial)}{" "}
        <a className="underline" href={TERMS_URL} target="_blank" rel="noreferrer">Terms</a>
        {" · "}
        <a className="underline" href={PRIVACY_URL} target="_blank" rel="noreferrer">Privacy</a>
      </p>

      {waiting && (
        <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
          <Spinner />
          <span>Finish checkout in the new tab. Pro unlocks here on its own.</span>
        </div>
      )}
      {needsVerify && (
        <Alert tone="warning">
          <p className="font-semibold">Verify your email to start your trial</p>
          <p className="mt-0.5">We sent a 6-digit code when you signed up. Enter it in Account, then come back.</p>
          {onNeedVerify && (
            <Button variant="secondary" size="sm" className="mt-2" onClick={onNeedVerify}>
              Open Account
            </Button>
          )}
        </Alert>
      )}
      {error && <Alert tone="loss">{error}</Alert>}
    </div>
  );
}
