import { useEffect, useState } from "react";
import { PRIVACY_URL, TERMS_URL } from "../config";
import {
  createCheckoutUrl,
  fetchMe,
  login,
  logout,
  register,
  requestPasswordReset,
  resendVerifyEmail,
  trackEvent,
  verifyEmail,
  type MeResponse,
} from "../lib/apiClient";
import { ApiError } from "../lib/apiErrors";
import { renewalDisclosure } from "../lib/billingDisclosure";
import { checkPassword } from "../lib/passwordStrength";
import { refreshTier } from "../lib/subscription";
import { PasswordInput, StrengthMeter } from "../ui/PasswordField";
import { Alert, Button, cx, Field, inputClass, PlanBadge } from "../ui/primitives";
import LegalFooter from "./LegalFooter";
import SocialAuthButtons from "./SocialAuthButtons";

type LoginScreenProps = {
  onAuthChange?: () => void;
  defaultMode?: "login" | "signup";
};

function loginEmailFromIdentifier(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value.includes("@") || /\s/.test(value)) return null;
  return value;
}

function AuthDivider({ label }: { label: string }) {
  return (
    <div className="my-4 flex items-center gap-3">
      <div className="h-px flex-1 bg-slate-200" />
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

function authErrorMessage(err: unknown, mode: "login" | "signup"): string {
  if (err instanceof ApiError) {
    if (err.code === "network" || err.code === "timeout") return err.userMessage;
    if (err.status === 401) return "Wrong password, or no account with that email.";
    if (err.status === 400 && /already registered/i.test(err.message)) {
      return "That email already has an account. Log in instead.";
    }
    if (err.status === 429) return "Too many tries. Wait a minute and try again.";
    return err.message;
  }
  return mode === "login"
    ? "Couldn't sign in. Check your email, password, and connection."
    : "Couldn't create the account. Check the password rules and try again.";
}

export default function LoginScreen({ onAuthChange, defaultMode = "login" }: LoginScreenProps) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [mode, setMode] = useState<"login" | "signup" | "forgot">(defaultMode === "signup" ? "signup" : "login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<"error" | "ok">("error");
  const [social, setSocial] = useState(true);

  async function refreshMe() {
    try {
      const profile = await fetchMe();
      setMe(profile);
      if (profile) {
        await refreshTier();
        onAuthChange?.();
      }
    } catch {
      setMsg("Can't reach MarginMark. Check your internet.");
      setMsgTone("error");
    }
  }

  useEffect(() => {
    setMode(defaultMode);
  }, [defaultMode]);

  useEffect(() => {
    void refreshMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleEmailAuth() {
    setMsg(null);
    const loginEmail = loginEmailFromIdentifier(identifier);
    if (!loginEmail) {
      setMsgTone("error");
      setMsg("Enter a valid email address.");
      return;
    }
    if (mode === "signup" ? !checkPassword(password).valid : password.length < 8) {
      setMsgTone("error");
      setMsg(
        mode === "signup"
          ? "Use 8+ characters with at least 3 of: uppercase, lowercase, number, symbol."
          : "Enter your password (8+ characters).",
      );
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") await register(loginEmail, password);
      else await login(loginEmail, password);
      trackEvent(mode === "signup" ? "auth.register" : "auth.login");
      setMsgTone("ok");
      setMsg(
        mode === "signup"
          ? "Account created. We emailed you a 6-digit code. Enter it in Account to unlock the free trial."
          : "You're signed in.",
      );
      await refreshMe();
    } catch (err) {
      setMsgTone("error");
      setMsg(authErrorMessage(err, mode === "signup" ? "signup" : "login"));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    setBusy(true);
    setMsg(null);
    try {
      await verifyEmail(code.trim());
      await refreshMe();
      setMsgTone("ok");
      setMsg("Email verified.");
    } catch (err) {
      setMsgTone("error");
      setMsg(err instanceof ApiError ? err.userMessage : "That code doesn't match.");
    } finally {
      setBusy(false);
    }
  }

  async function handleForgot() {
    setMsg(null);
    const loginEmail = loginEmailFromIdentifier(identifier);
    if (!loginEmail) {
      setMsgTone("error");
      setMsg("Enter the email for your account.");
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset(loginEmail);
      setMsgTone("ok");
      setMsg("If that account exists, a reset link is on its way. It works for 30 minutes.");
    } catch (err) {
      setMsgTone("error");
      setMsg(err instanceof ApiError ? err.userMessage : "Couldn't send the reset email. Try again.");
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
      setMsg(err instanceof ApiError ? err.userMessage : "Checkout failed. Nothing was charged. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const note = msg && (
    <Alert tone={msgTone === "ok" ? "ok" : "loss"} className="mt-3">
      {msg}
    </Alert>
  );

  if (me) {
    return (
      <div className="flex flex-1 flex-col space-y-3 text-sm">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Signed in as</p>
          <p className="mt-1 truncate font-bold text-slate-900">{me.email}</p>
          <p className="mt-2">
            <PlanBadge tier={me.tier === "diamond" ? "diamond" : me.is_pro || me.tier === "pro" ? "pro" : "free"} />
          </p>
        </div>
        {me.email_verified === false && (
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <p className="text-slate-700">Enter the 6-digit code we emailed you. Free features work before you verify.</p>
            <input
              className={cx(inputClass, "mt-2 tracking-[0.3em]")}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-label="6-digit code"
            />
            <Button variant="primary" block className="mt-2" busy={busy} onClick={() => void handleVerify()}>
              Verify email
            </Button>
            <button
              type="button"
              className="mt-2 w-full text-xs font-semibold text-slate-600 underline"
              disabled={busy}
              onClick={() =>
                void resendVerifyEmail()
                  .then(() => {
                    setMsgTone("ok");
                    setMsg("New code sent.");
                  })
                  .catch((err) => {
                    setMsgTone("error");
                    setMsg(err instanceof ApiError ? err.userMessage : "Couldn't resend yet.");
                  })
              }
            >
              Resend code
            </button>
          </div>
        )}
        {!me.is_pro && me.tier !== "pro" && me.tier !== "diamond" && (
          <>
            <div className="flex gap-2">
              <Button variant="pro" className="flex-1" disabled={busy} onClick={() => void handleUpgrade("monthly")}>
                {busy ? "Opening…" : `Pro $${me.pro_price}/mo`}
              </Button>
              <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => void handleUpgrade("yearly")}>
                ${me.pro_price_yearly ?? 120}/yr
              </Button>
            </div>
            <p className="text-xs text-slate-600">
              {renewalDisclosure("monthly", me.trial_available !== false)}{" "}
              <a className="underline" href={TERMS_URL} target="_blank" rel="noreferrer">Terms</a>
            </p>
          </>
        )}
        <Button
          variant="ghost"
          onClick={() =>
            void logout().then(() => {
              setMe(null);
              onAuthChange?.();
            })
          }
        >
          Sign out
        </Button>
        {note}
      </div>
    );
  }

  if (mode === "forgot") {
    return (
      <form
        className="flex flex-1 flex-col rounded-xl border border-slate-200 bg-white p-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void handleForgot();
        }}
      >
        <h2 className="text-base font-bold text-slate-900">Reset your password</h2>
        <p className="mt-1 text-xs text-slate-600">Enter your account email. We'll send a link that works for 30 minutes.</p>
        <div className="mt-4">
          <Field label="Email">
            <input
              className={inputClass}
              type="email"
              placeholder="you@yourshop.com"
              autoComplete="username"
              inputMode="email"
              autoFocus
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </Field>
        </div>
        <Button type="submit" variant="primary" size="lg" block className="mt-4" busy={busy}>
          {busy ? "Sending…" : "Send reset link"}
        </Button>
        <button
          type="button"
          className="mt-3 text-xs font-semibold text-slate-600 hover:text-slate-900"
          onClick={() => {
            setMode("login");
            setMsg(null);
          }}
        >
          ← Back to log in
        </button>
        {note}
      </form>
    );
  }

  const signup = mode === "signup";
  return (
    <form
      className="flex flex-1 flex-col rounded-xl border border-slate-200 bg-white p-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void handleEmailAuth();
      }}
    >
      <div role="tablist" aria-label="Log in or sign up" className="mb-4 flex rounded-lg bg-slate-100 p-1 text-sm font-semibold">
        {(["login", "signup"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            className={cx(
              "flex-1 rounded-md py-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500",
              mode === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
            )}
            onClick={() => {
              setMode(id);
              setMsg(null);
            }}
          >
            {id === "login" ? "Log in" : "Create account"}
          </button>
        ))}
      </div>

      <SocialAuthButtons
        mode={mode}
        disabled={busy}
        onAvailability={setSocial}
        onNotice={(m) => {
          setMsgTone("ok");
          setMsg(m);
        }}
      />
      {social && <AuthDivider label={signup ? "or sign up with email" : "or use email"} />}

      <div className={cx("space-y-3", !social && "mt-0")}>
        <Field label="Email">
          <input
            className={inputClass}
            type="email"
            placeholder="you@yourshop.com"
            autoComplete="username"
            inputMode="email"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
        </Field>
        <PasswordInput
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete={signup ? "new-password" : "current-password"}
          placeholder={signup ? "Create a password" : "Your password"}
        />
        {signup && password.length > 0 && <StrengthMeter password={password} />}
        <Button type="submit" variant="primary" size="lg" block busy={busy}>
          {busy ? (signup ? "Creating account…" : "Signing in…") : signup ? "Create free account" : "Log in"}
        </Button>
        {!signup && (
          <button
            type="button"
            className="block w-full text-center text-xs font-semibold text-slate-600 hover:text-slate-900"
            onClick={() => {
              setMode("forgot");
              setMsg(null);
            }}
          >
            Forgot password?
          </button>
        )}
        {signup && (
          <p className="text-center text-xs text-slate-500">
            By creating an account you agree to the{" "}
            <a className="underline" href={TERMS_URL} target="_blank" rel="noreferrer">Terms</a> and{" "}
            <a className="underline" href={PRIVACY_URL} target="_blank" rel="noreferrer">Privacy Policy</a>.
          </p>
        )}
      </div>
      {note}
      <div className="mt-4">
        <LegalFooter />
      </div>
    </form>
  );
}
