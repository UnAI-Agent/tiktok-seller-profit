import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  changePassword,
  createPortalUrl,
  deleteAccount,
  fetchMe,
  redeemPromo,
  requestPasswordReset,
  resendVerifyEmail,
  signOutEverywhere,
  updateProfile,
  verifyEmail,
  type MeResponse,
} from "../lib/apiClient";
import { ApiError } from "../lib/apiErrors";
import { emailInitials } from "../lib/emailInitials";
import { openTab } from "../lib/openTab";
import { checkPassword } from "../lib/passwordStrength";
import { tierFromProfile, refreshTier } from "../lib/subscription";
import { FREE_SKU_LIMIT } from "../config";
import PlanPicker from "../ui/PlanPicker";
import { PasswordInput, StrengthMeter } from "../ui/PasswordField";
import {
  CardIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  RefreshIcon,
  ShieldIcon,
  UserIcon,
  XIcon,
} from "../ui/icons";
import { Alert, Button, cx, Field, inputClass, PlanBadge } from "../ui/primitives";

type ProfilePanelProps = {
  onClose: () => void;
  onLogout: () => void;
  onAccountChanged?: () => void;
  /** Products with a saved cost, for the Free usage meter. */
  costsSaved?: number;
};

type Notice = { tone: "ok" | "loss"; text: string } | null;

function Card({ title, icon, children, aside }: { title: string; icon?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
          {icon}
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Fold({ title, children, tone = "neutral" }: { title: string; children: ReactNode; tone?: "neutral" | "danger" }) {
  return (
    <details className={cx("group rounded-xl border bg-white", tone === "danger" ? "border-red-200" : "border-slate-200")}>
      <summary
        className={cx(
          "flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500",
          tone === "danger" ? "text-red-700" : "text-slate-800",
        )}
      >
        {title}
        <ChevronDownIcon size={16} className="text-slate-400 transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-slate-100 p-4">{children}</div>
    </details>
  );
}

export default function ProfilePanel({ onClose, onLogout, onAccountChanged, costsSaved = 0 }: ProfilePanelProps) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [profileNote, setProfileNote] = useState<Notice>(null);
  const [planNote, setPlanNote] = useState<Notice>(null);
  const [pwNote, setPwNote] = useState<Notice>(null);
  const [promoNote, setPromoNote] = useState<Notice>(null);
  const [verifyNote, setVerifyNote] = useState<Notice>(null);
  const [dangerNote, setDangerNote] = useState<Notice>(null);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [code, setCode] = useState("");
  const [promo, setPromo] = useState("");
  const [deletePw, setDeletePw] = useState("");
  const [showUpgrade, setShowUpgrade] = useState(false);

  const load = useCallback(async () => {
    try {
      const profile = await fetchMe();
      setMe(profile);
      setName(profile?.display_name ?? "");
      setEmail(profile?.email ?? "");
    } catch {
      /* the screen stays usable offline; each action reports its own error */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tier = tierFromProfile(me) ?? "free";
  const isPro = tier !== "free";
  const verified = me?.email_verified !== false;
  const oauthOnly = Boolean(me?.has_oauth);
  const pw = checkPassword(newPw);
  const mismatch = confirmPw.length > 0 && confirmPw !== newPw;

  async function run(key: string, work: () => Promise<void>, onError: (text: string) => void) {
    setBusy(key);
    try {
      await work();
    } catch (err) {
      onError(err instanceof ApiError ? err.userMessage : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const saveProfile = () =>
    run(
      "profile",
      async () => {
        setProfileNote(null);
        const saved = await updateProfile({ display_name: name, email });
        setName(saved.display_name);
        setEmail(saved.email);
        const emailChanged = me && saved.email.toLowerCase() !== me.email.toLowerCase();
        setProfileNote({
          tone: "ok",
          text: emailChanged ? "Saved. Verify your new email address to start a trial." : "Profile saved.",
        });
        await load();
        onAccountChanged?.();
      },
      (text) => setProfileNote({ tone: "loss", text }),
    );

  const savePassword = () =>
    run(
      "password",
      async () => {
        setPwNote(null);
        await changePassword(currentPw, newPw);
        setCurrentPw("");
        setNewPw("");
        setConfirmPw("");
        setPwNote({ tone: "ok", text: "Password updated. Your other devices were signed out." });
      },
      (text) => setPwNote({ tone: "loss", text }),
    );

  const emailReset = () =>
    run(
      "reset",
      async () => {
        setPwNote(null);
        await requestPasswordReset(email);
        setPwNote({ tone: "ok", text: `If ${email} has an account, a reset link is on its way. It works for 30 minutes.` });
      },
      (text) => setPwNote({ tone: "loss", text }),
    );

  const doVerify = () =>
    run(
      "verify",
      async () => {
        setVerifyNote(null);
        await verifyEmail(code.trim());
        setCode("");
        setVerifyNote({ tone: "ok", text: "Email verified. You can start your trial." });
        await load();
        onAccountChanged?.();
      },
      (text) => setVerifyNote({ tone: "loss", text }),
    );

  const resend = () =>
    run(
      "resend",
      async () => {
        setVerifyNote(null);
        await resendVerifyEmail();
        setVerifyNote({ tone: "ok", text: "New code sent. It works for 15 minutes." });
      },
      (text) => setVerifyNote({ tone: "loss", text }),
    );

  const manageBilling = () =>
    run(
      "portal",
      async () => {
        setPlanNote(null);
        const url = await createPortalUrl();
        if (!(await openTab(url))) throw new ApiError("Couldn't open the billing page.", 0, "http");
      },
      (text) => setPlanNote({ tone: "loss", text }),
    );

  const refreshPlan = () =>
    run(
      "refresh",
      async () => {
        setPlanNote(null);
        await refreshTier();
        await load();
        onAccountChanged?.();
        setPlanNote({ tone: "ok", text: "Plan is up to date." });
      },
      (text) => setPlanNote({ tone: "loss", text }),
    );

  const applyPromo = () =>
    run(
      "promo",
      async () => {
        setPromoNote(null);
        const res = await redeemPromo(promo);
        setPromo("");
        setPromoNote({ tone: "ok", text: `Pro unlocked for ${res.pro_days} days.` });
        await refreshTier();
        await load();
        onAccountChanged?.();
      },
      (text) => setPromoNote({ tone: "loss", text }),
    );

  const signOutAll = () =>
    run(
      "signout-all",
      async () => {
        await signOutEverywhere();
        onLogout();
      },
      (text) => setPwNote({ tone: "loss", text }),
    );

  const confirmDelete = () =>
    run(
      "delete",
      async () => {
        setDangerNote(null);
        await deleteAccount(deletePw);
        onLogout();
      },
      (text) => setDangerNote({ tone: "loss", text }),
    );

  const renew = me?.current_period_end ? new Date(me.current_period_end) : null;
  const renewText = renew && !Number.isNaN(renew.getTime()) ? renew.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : null;
  const trialing = me?.plan_status === "trialing";
  const interval = me?.plan_interval === "year" ? "Yearly" : me?.plan_interval === "month" ? "Monthly" : null;

  return (
    <div className="space-y-3 bg-slate-50 px-4 py-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="-ml-1 flex items-center gap-0.5 rounded-md px-1 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        >
          <ChevronLeftIcon size={16} /> Back
        </button>
        <h2 className="flex-1 text-center text-sm font-bold text-slate-900">Account</h2>
        <span className="w-12" />
      </div>

      {/* identity */}
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-900 text-base font-bold text-white"
        >
          {me?.email ? emailInitials(me.email) : <UserIcon size={22} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-900">{me?.display_name || me?.email || (loaded ? "Signed in" : "Loading…")}</p>
          {me?.display_name && <p className="truncate text-xs text-slate-500">{me.email}</p>}
          <p className="mt-1 flex items-center gap-1.5">
            <PlanBadge tier={tier} />
            {me && (
              <span className={cx("inline-flex items-center gap-1 text-xs font-semibold", verified ? "text-emerald-700" : "text-amber-700")}>
                {verified ? <CheckIcon size={12} /> : <ShieldIcon size={12} />}
                {verified ? "Email verified" : "Email not verified"}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* verify email */}
      {me && !verified && (
        <Card title="Verify your email" icon={<ShieldIcon size={13} />}>
          <p className="mb-3 text-xs text-slate-600">
            Enter the 6-digit code we emailed you. Everything free works without it. It's needed to start a trial.
          </p>
          <div className="flex gap-2">
            <input
              className={cx(inputClass, "tracking-[0.3em] tabular-nums")}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              aria-label="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <Button variant="primary" busy={busy === "verify"} disabled={code.length < 6} onClick={() => void doVerify()}>
              Verify
            </Button>
          </div>
          <button
            type="button"
            className="mt-2 text-xs font-semibold text-slate-600 underline disabled:opacity-50"
            disabled={busy === "resend"}
            onClick={() => void resend()}
          >
            Send a new code
          </button>
          {verifyNote && <Alert tone={verifyNote.tone} className="mt-3">{verifyNote.text}</Alert>}
        </Card>
      )}

      {/* plan */}
      <Card
        title="Plan & billing"
        icon={<CardIcon size={13} />}
        aside={
          <button
            type="button"
            aria-label="Refresh plan"
            title="Refresh plan"
            disabled={busy === "refresh"}
            onClick={() => void refreshPlan()}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-50"
          >
            <RefreshIcon size={14} className={busy === "refresh" ? "animate-spin" : ""} />
          </button>
        }
      >
        {isPro ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 p-3 text-white">
              <p className="flex items-center gap-1.5 text-sm font-bold">
                <CheckIcon size={16} /> MarginMark {tier === "diamond" ? "Diamond" : "Pro"} {trialing ? "· free trial" : ""}
              </p>
              <p className="mt-0.5 text-xs text-indigo-100">
                {interval ? `${interval} plan` : "Active"}
                {renewText ? ` · ${me?.has_stripe ? (trialing ? "trial ends" : "renews") : "through"} ${renewText}` : ""}
                {me?.promo_expires_at && !me.has_stripe ? ` · promo through ${me.promo_expires_at.slice(0, 10)}` : ""}
              </p>
            </div>
            <ul className="space-y-1 text-xs text-slate-700">
              <li className="flex items-center gap-1.5"><CheckIcon size={13} className="text-emerald-600" /> Unlimited products with costs</li>
              <li className="flex items-center gap-1.5"><CheckIcon size={13} className="text-emerald-600" /> Commission, ad, and fix advice unlocked</li>
            </ul>
            {me?.has_stripe && (
              <Button variant="secondary" block busy={busy === "portal"} onClick={() => void manageBilling()}>
                Manage billing or cancel
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-xs text-slate-600">
                <span>Free costs saved</span>
                <b className="tabular-nums text-slate-900">{Math.min(costsSaved, FREE_SKU_LIMIT)} / {FREE_SKU_LIMIT}</b>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, (costsSaved / FREE_SKU_LIMIT) * 100)}%` }} />
              </div>
            </div>
            {showUpgrade ? (
              <PlanPicker
                me={me}
                showCompare={false}
                placement="account"
                headline="Go Pro"
                subline="Unlimited costs, the exact commission and ad limits, and fix advice for every losing product."
                onNeedVerify={() => window.scrollTo?.({ top: 0 })}
                onUnlocked={() => void load().then(() => onAccountChanged?.())}
              />
            ) : (
              <Button variant="pro" block onClick={() => setShowUpgrade(true)}>
                See Pro plans
              </Button>
            )}
          </div>
        )}
        {planNote && <Alert tone={planNote.tone} className="mt-3">{planNote.text}</Alert>}
      </Card>

      {/* profile */}
      <Card title="Profile" icon={<UserIcon size={13} />}>
        <div className="space-y-3">
          <Field label="Name">
            <input className={inputClass} value={name} maxLength={80} autoComplete="name" placeholder="Your name" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email" hint={oauthOnly ? `Signed in with ${me?.oauth_provider ?? "a social account"}.` : "Changing it means verifying the new address."}>
            <input className={inputClass} type="email" value={email} inputMode="email" autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button variant="primary" block busy={busy === "profile"} onClick={() => void saveProfile()}>
            Save profile
          </Button>
          {profileNote && <Alert tone={profileNote.tone}>{profileNote.text}</Alert>}
        </div>
      </Card>

      {/* security */}
      <Card title="Password & security" icon={<ShieldIcon size={13} />}>
        <div className="space-y-3">
          {oauthOnly && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              You sign in with {me?.oauth_provider ?? "a social account"}. You can add a password too. Leave “Current password” empty if you haven't set one.
            </p>
          )}
          <PasswordInput label="Current password" value={currentPw} onChange={setCurrentPw} autoComplete="current-password" />
          <PasswordInput label="New password" value={newPw} onChange={setNewPw} autoComplete="new-password" />
          {newPw.length > 0 && <StrengthMeter password={newPw} />}
          <PasswordInput label="Confirm new password" value={confirmPw} onChange={setConfirmPw} autoComplete="new-password" />
          {mismatch && <p className="-mt-1 text-xs text-red-700">The two passwords don't match.</p>}
          <Button
            variant="primary"
            block
            busy={busy === "password"}
            disabled={!pw.valid || newPw !== confirmPw}
            onClick={() => void savePassword()}
          >
            Update password
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <button type="button" className="font-semibold text-slate-600 underline disabled:opacity-50" disabled={busy === "reset" || !email.includes("@")} onClick={() => void emailReset()}>
              Forgot it? Email me a reset link
            </button>
            <button type="button" className="font-semibold text-slate-600 underline disabled:opacity-50" disabled={busy === "signout-all"} onClick={() => void signOutAll()}>
              Sign out everywhere
            </button>
          </div>
          {pwNote && <Alert tone={pwNote.tone}>{pwNote.text}</Alert>}
        </div>
      </Card>

      {/* promo */}
      <Fold title="Have a promo code?">
        <div className="flex gap-2">
          <input className={cx(inputClass, "uppercase")} placeholder="Promo code" aria-label="Promo code" autoComplete="off" value={promo} onChange={(e) => setPromo(e.target.value)} />
          <Button variant="secondary" busy={busy === "promo"} disabled={promo.trim().length < 4} onClick={() => void applyPromo()}>
            Apply
          </Button>
        </div>
        {promoNote && <Alert tone={promoNote.tone} className="mt-3">{promoNote.text}</Alert>}
      </Fold>

      <Button variant="secondary" block onClick={onLogout}>
        Sign out
      </Button>

      <Fold title="Delete account" tone="danger">
        <p className="mb-3 text-xs leading-relaxed text-slate-600">
          This permanently deletes your account and cancels any subscription. Costs saved in this browser are not affected.
          {oauthOnly ? " If you sign in with a social account, you can leave the password empty." : ""}
        </p>
        <PasswordInput label="Password" value={deletePw} onChange={setDeletePw} autoComplete="current-password" />
        <Button variant="danger" block className="mt-3" busy={busy === "delete"} onClick={() => void confirmDelete()}>
          <XIcon size={14} /> Delete my account
        </Button>
        {dangerNote && <Alert tone={dangerNote.tone} className="mt-3">{dangerNote.text}</Alert>}
      </Fold>
    </div>
  );
}
