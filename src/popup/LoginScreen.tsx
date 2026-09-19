import { useEffect, useState } from "react";
import {
  createCheckoutUrl,
  fetchMe,
  login,
  logout,
  register,
  requestPasswordReset,
  trackEvent,
  type MeResponse,
} from "../lib/apiClient";
import { ApiError } from "../lib/apiErrors";
import { refreshSubscriptionCache } from "../lib/subscription";
import SocialAuthButtons from "./SocialAuthButtons";

type LoginScreenProps = {
  onAuthChange?: () => void;
  defaultMode?: "login" | "signup";
};

/** Backend login email — user enters email or phone in one field. */
function loginEmailFromIdentifier(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.includes("@")) return value.toLowerCase();
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 10) return `+${digits}@phone.tiktok-seller-tool`;
  return null;
}

function AuthDivider({ label }: { label: string }) {
  return (
    <div className="my-5 flex items-center gap-3">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
    </div>
  );
}

function authErrorMessage(err: unknown, mode: "login" | "signup"): string {
  if (err instanceof ApiError) {
    if (err.code === "network" || err.code === "timeout") return err.userMessage;
    if (err.status === 401) return "Wrong password or email not found.";
    if (err.status === 400 && /already registered/i.test(err.message)) {
      return "That email is already registered. Log in instead.";
    }
    return err.message;
  }
  return mode === "login"
    ? "Could not sign in. Check credentials and your connection."
    : "Could not create account. Check the password rules and try again.";
}

export default function LoginScreen({
  onAuthChange,
  defaultMode = "login",
}: LoginScreenProps) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [mode, setMode] = useState<"login" | "signup" | "forgot">(
    defaultMode === "signup" ? "signup" : "login",
  );
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<"error" | "ok">("error");

  async function refreshMe() {
    try {
      const profile = await fetchMe();
      setMe(profile);
      if (profile) {
        await refreshSubscriptionCache();
        onAuthChange?.();
      }
    } catch {
      setMsg("Connection lost. Check your internet.");
      setMsgTone("error");
    }
  }

  useEffect(() => {
    setMode(defaultMode);
  }, [defaultMode]);

  useEffect(() => {
    void refreshMe();
  }, []);

  async function handleEmailAuth() {
    setBusy(true);
    setMsg(null);
    const loginEmail = loginEmailFromIdentifier(identifier);
    if (!loginEmail) {
      setMsgTone("error");
      setMsg("Enter a valid email or phone (10+ digits).");
      setBusy(false);
      return;
    }
    if (password.length < 8) {
      setMsgTone("error");
      setMsg("Password must be at least 8 characters.");
      setBusy(false);
      return;
    }
    try {
      if (mode === "signup") await register(loginEmail, password);
      else await login(loginEmail, password);
      await refreshMe();
      trackEvent(mode === "signup" ? "auth.register" : "auth.login");
      setMsgTone("ok");
      setMsg("You're signed in.");
    } catch (err) {
      setMsgTone("error");
      setMsg(authErrorMessage(err, mode === "signup" ? "signup" : "login"));
    } finally {
      setBusy(false);
    }
  }

  async function handleForgot() {
    setBusy(true);
    setMsg(null);
    const loginEmail = loginEmailFromIdentifier(identifier);
    if (!loginEmail) {
      setMsgTone("error");
      setMsg("Enter the email for your account.");
      setBusy(false);
      return;
    }
    try {
      await requestPasswordReset(loginEmail);
      setMsgTone("ok");
      setMsg("If that account exists, reset instructions were sent.");
    } catch (err) {
      setMsgTone("error");
      setMsg(err instanceof ApiError ? err.userMessage : "Could not send reset email.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpgrade(interval: "monthly" | "yearly") {
    setBusy(true);
    setMsg(null);
    try {
      const url = await createCheckoutUrl(interval);
      await chrome.tabs.create({ url });
    } catch (err) {
      setMsgTone("error");
      setMsg(
        err instanceof ApiError
          ? err.userMessage
          : "Checkout failed. Try again — nothing was charged.",
      );
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-slate-200/80 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-tiktok/40 focus:bg-white focus:ring-2 focus:ring-tiktok/15";

  const busyLabel =
    mode === "forgot"
      ? "Sending…"
      : mode === "signup"
        ? "Creating account…"
        : "Signing in…";

  if (me) {
    return (
      <div className="flex flex-1 flex-col space-y-4 text-sm">
        <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Signed in as
          </p>
          <p className="mt-1 truncate font-semibold text-slate-900">{me.email}</p>
          <p className="mt-2 inline-flex rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-semibold text-white">
            {me.is_pro ? "Pro" : "Free"}
          </p>
        </div>
        {!me.is_pro && (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              className="flex-1 rounded-xl bg-tiktok py-2.5 text-xs font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-50"
              onClick={() => void handleUpgrade("monthly")}
            >
              {busy ? "Opening checkout…" : `Pro $${me.pro_price}/mo`}
            </button>
            <button
              type="button"
              disabled={busy}
              className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              onClick={() => void handleUpgrade("yearly")}
            >
              ${me.pro_price_yearly ?? 99}/yr
            </button>
          </div>
        )}
        <button
          type="button"
          className="text-xs font-medium text-slate-500 hover:text-slate-800"
          onClick={() =>
            void logout().then(() => {
              setMe(null);
              onAuthChange?.();
            })
          }
        >
          Sign out
        </button>
        {msg && (
          <p
            className={`rounded-lg px-3 py-2 text-xs ${
              msgTone === "ok"
                ? "bg-emerald-50 text-emerald-800"
                : "bg-rose-50 text-rose-800"
            }`}
          >
            {msg}
          </p>
        )}
      </div>
    );
  }

  if (mode === "forgot") {
    return (
      <div className="flex flex-1 flex-col overflow-auto rounded-2xl border border-slate-200/60 bg-gradient-to-b from-white via-white to-slate-50/90 p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Reset password</h2>
        <p className="mt-1 text-xs text-slate-500">
          We’ll email a reset link if this account exists. Email delivery is
          not wired yet — this step is a placeholder.
        </p>
        <input
          className={`${inputClass} mt-4`}
          placeholder="Email"
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
        />
        <button
          type="button"
          disabled={busy}
          className="mt-3 w-full rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 py-3 text-sm font-semibold text-white shadow-md disabled:opacity-50"
          onClick={() => void handleForgot()}
        >
          {busy ? busyLabel : "Send reset link"}
        </button>
        <button
          type="button"
          className="mt-3 text-xs font-medium text-slate-500 hover:text-slate-800"
          onClick={() => {
            setMode("login");
            setMsg(null);
          }}
        >
          Back to log in
        </button>
        {msg && (
          <p
            className={`mt-4 rounded-xl px-3 py-2 text-xs ${
              msgTone === "ok"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            {msg}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto rounded-2xl border border-slate-200/60 bg-gradient-to-b from-white via-white to-slate-50/90 p-4 shadow-sm">
      <div className="mb-4 flex rounded-xl bg-slate-100/90 p-1 text-xs font-semibold">
        <button
          type="button"
          className={`flex-1 rounded-lg py-2.5 transition ${
            mode === "login"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
          onClick={() => setMode("login")}
        >
          Log in
        </button>
        <button
          type="button"
          className={`flex-1 rounded-lg py-2.5 transition ${
            mode === "signup"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
          onClick={() => setMode("signup")}
        >
          Sign up
        </button>
      </div>

      <SocialAuthButtons
        mode={mode}
        disabled={busy}
        onNotice={(m) => {
          setMsgTone("ok");
          setMsg(m);
        }}
      />

      <AuthDivider
        label={mode === "login" ? "or email / phone" : "or sign up with email / phone"}
      />

      <div className="space-y-2.5">
        <input
          className={inputClass}
          placeholder="Email or phone"
          autoComplete="username"
          inputMode="email"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
        />
        <input
          type="password"
          className={inputClass}
          placeholder="Password (8+ characters)"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {mode === "signup" && (
          <p className="text-[10px] text-slate-500">
            Use 8+ characters with at least 3 of: uppercase, lowercase, number,
            special character.
          </p>
        )}
        <button
          type="button"
          disabled={busy}
          className="mt-1 w-full rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 py-3 text-sm font-semibold text-white shadow-md transition hover:from-slate-800 hover:to-slate-700 disabled:opacity-50"
          onClick={() => void handleEmailAuth()}
        >
          {busy ? busyLabel : mode === "login" ? "Log in" : "Create account"}
        </button>
        {mode === "login" && (
          <button
            type="button"
            className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-800"
            onClick={() => {
              setMode("forgot");
              setMsg(null);
            }}
          >
            Forgot password?
          </button>
        )}
      </div>

      {msg && (
        <p
          className={`mt-4 rounded-xl px-3 py-2 text-xs leading-relaxed ${
            msgTone === "ok"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {msg}
        </p>
      )}
    </div>
  );
}
