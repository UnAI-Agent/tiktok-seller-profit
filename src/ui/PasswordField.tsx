import { useState } from "react";
import { checkPassword } from "../lib/passwordStrength";
import { CheckIcon, EyeIcon, EyeOffIcon } from "./icons";
import { cx, Field, inputClass } from "./primitives";

export function PasswordInput({
  value,
  onChange,
  autoComplete,
  placeholder,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  autoComplete: string;
  placeholder?: string;
  label: string;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label}>
      <span className="relative block">
        <input
          className={cx(inputClass, "pr-10")}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          onClick={() => setShow((v) => !v)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        >
          {show ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
        </button>
      </span>
    </Field>
  );
}

const METER = ["bg-slate-200", "bg-red-500", "bg-amber-500", "bg-emerald-400", "bg-emerald-600"];

export function StrengthMeter({ password }: { password: string }) {
  const check = checkPassword(password);
  const rule = (ok: boolean, text: string) => (
    <li className={cx("flex items-center gap-1.5", ok ? "text-emerald-700" : "text-slate-500")}>
      {ok ? <CheckIcon size={12} /> : <span className="inline-block h-3 w-3 rounded-full border border-slate-300" aria-hidden="true" />}
      {text}
    </li>
  );
  return (
    <div className="space-y-1.5" aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cx("h-1.5 flex-1 rounded-full", check.score >= i ? METER[check.score] : "bg-slate-200")} />
        ))}
      </div>
      <div className="flex items-start justify-between gap-2 text-xs">
        <ul className="space-y-0.5">
          {rule(check.longEnough, "At least 8 characters")}
          {rule(check.classes >= 3, "3 of: A–Z, a–z, 0–9, symbol")}
        </ul>
        {check.label && <span className="font-semibold text-slate-700">{check.label}</span>}
      </div>
    </div>
  );
}
