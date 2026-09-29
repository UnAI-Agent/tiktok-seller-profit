import { useEffect, useMemo, useState } from "react";
import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL } from "../config";
import { fetchMe, submitSupportTicket, type SupportTicketKind } from "../lib/apiClient";
import { ApiError, CONNECTION_LOST } from "../lib/apiErrors";
import { BugIcon, CardIcon, CheckIcon, ChatIcon, ChevronDownIcon, ChevronLeftIcon, LightbulbIcon, MailIcon } from "../ui/icons";
import { Alert, Button, cx, Field, inputClass } from "../ui/primitives";
import type { ReactNode } from "react";

const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

export type SupportContext = {
  version: string;
  pageType: string;
  priceRead: boolean;
  plan?: string;
};

type Kind = { id: SupportTicketKind | "billing" | "feature"; label: string; blurb: string; icon: ReactNode; subject: string; placeholder: string };

const KINDS: Kind[] = [
  {
    id: "problem",
    label: "Report a bug",
    blurb: "Something's off",
    icon: <BugIcon size={18} />,
    subject: "Bug report",
    placeholder: "What did you expect, and what happened instead?\n\nSteps: 1) I opened… 2) I clicked…",
  },
  {
    id: "support",
    label: "Ask a question",
    blurb: "How it works",
    icon: <ChatIcon size={18} />,
    subject: "Question",
    placeholder: "What would you like to know?",
  },
  {
    id: "billing",
    label: "Billing help",
    blurb: "Plan, trial, refund",
    icon: <CardIcon size={18} />,
    subject: "Billing question",
    placeholder: "Tell us what happened with your plan or charge. Never include a full card number.",
  },
  {
    id: "feature",
    label: "Suggest a feature",
    blurb: "Share an idea",
    icon: <LightbulbIcon size={18} />,
    subject: "Feature request",
    placeholder: "What would you like MarginMark to do? What problem would it solve for your shop?",
  },
];

const FAQ: Array<[string, ReactNode]> = [
  [
    "Why does it say “Add your product cost”?",
    "Profit needs what you paid for one unit. Type it once and MarginMark remembers it for that product.",
  ],
  [
    "The numbers look off. What should I check?",
    "Open Settings and confirm the TikTok fee, refund rate, and default shipping. Pro can import your statement to use the fees TikTok actually charged.",
  ],
  [
    "How do I cancel or change my plan?",
    "Account → Manage billing opens the secure billing portal. Cancel any time. Pro stays on until the period you already paid for ends.",
  ],
  [
    "Is my data private?",
    "Your costs and profit stay in this browser. They are never sent to MarginMark's servers. Only your account details and support messages are.",
  ],
];

type SupportCenterProps = {
  onClose: () => void;
  context: SupportContext;
  defaultEmail?: string;
  defaultKind?: Kind["id"];
};

export default function SupportCenter({ onClose, context, defaultEmail = "", defaultKind = "problem" }: SupportCenterProps) {
  const [kindId, setKindId] = useState<Kind["id"]>(defaultKind);
  const kind = KINDS.find((k) => k.id === kindId) ?? KINDS[0];
  const [email, setEmail] = useState(defaultEmail);
  const [subject, setSubject] = useState(kind.subject);
  const [subjectTouched, setSubjectTouched] = useState(false);
  const [message, setMessage] = useState("");
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    if (defaultEmail) return;
    let cancel = false;
    void fetchMe()
      .then((me) => {
        if (!cancel && me?.email) setEmail((current) => current || me.email);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [defaultEmail]);

  useEffect(() => {
    if (!subjectTouched) setSubject(kind.subject);
  }, [kind, subjectTouched]);

  const details = useMemo(
    () =>
      [
        "",
        "---",
        "Details you chose to share (never your costs or profit):",
        `Extension version: ${context.version || "unknown"}`,
        `Page: ${context.pageType}`,
        `Price read: ${context.priceRead ? "yes" : "no"}`,
        context.plan ? `Plan: ${context.plan}` : "",
      ]
        .filter((line, index) => line !== "" || index === 0)
        .join("\n"),
    [context],
  );

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const messageOk = message.trim().length >= 10;
  const limit = 3500;

  async function send() {
    setError(null);
    if (!emailOk) return setError("Enter the email where we can reply.");
    if (!subject.trim()) return setError("Add a short subject.");
    if (!messageOk) return setError("Tell us a little more (at least a sentence).");
    setBusy(true);
    try {
      await submitSupportTicket({
        email: email.trim(),
        subject: subject.trim(),
        message: `${message.trim()}${attach && kindId === "problem" ? details : ""}`.slice(0, 4000),
        kind: kindId as SupportTicketKind,
      });
      setSentTo(email.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : CONNECTION_LOST);
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <div className="space-y-4 px-4 py-6 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <CheckIcon size={26} />
        </span>
        <div>
          <h2 className="text-base font-bold text-slate-900">Message received</h2>
          <p className="mt-1 text-sm text-slate-600">
            We'll reply to <b className="text-slate-900">{sentTo}</b>. Check spam if you don't see us.
          </p>
        </div>
        <Button variant="primary" block onClick={onClose}>
          Back to MarginMark
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="-ml-1 flex items-center gap-0.5 rounded-md px-1 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        >
          <ChevronLeftIcon size={16} /> Back
        </button>
        <h2 className="flex-1 text-center text-sm font-bold text-slate-900">Help &amp; support</h2>
        <span className="w-12" />
      </div>

      <div role="radiogroup" aria-label="What do you need?" className="grid grid-cols-2 gap-2">
        {KINDS.map((k) => {
          const active = k.id === kindId;
          return (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setKindId(k.id)}
              className={cx(
                "flex items-center gap-2 rounded-xl border-2 px-2.5 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500",
                active ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-300",
              )}
            >
              <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600")}>
                {k.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold text-slate-900">{k.label}</span>
                <span className="block truncate text-xs text-slate-500">{k.blurb}</span>
              </span>
            </button>
          );
        })}
      </div>

      <form
        className="space-y-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Field label="Your email" hint="We reply here.">
          <input
            className={inputClass}
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourshop.com"
          />
        </Field>
        <Field label="Subject">
          <input
            className={inputClass}
            maxLength={120}
            value={subject}
            onChange={(e) => {
              setSubjectTouched(true);
              setSubject(e.target.value);
            }}
          />
        </Field>
        <Field label="Message">
          <textarea
            className={cx(inputClass, "min-h-[110px] resize-y leading-relaxed")}
            maxLength={limit}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={kind.placeholder}
          />
          <span className="mt-0.5 block text-right text-xs font-normal text-slate-400 tabular-nums">
            {message.length}/{limit}
          </span>
        </Field>
        {kindId === "problem" && (
          <label className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <input type="checkbox" className="mt-0.5" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
            <span>
              Include page details (version {context.version || "unknown"}, page type, whether the price was read). Never your costs or profit.
            </span>
          </label>
        )}
        {error && <Alert tone="loss">{error}</Alert>}
        <Button type="submit" variant="primary" size="lg" block busy={busy}>
          {busy ? "Sending…" : "Send message"}
        </Button>
      </form>

      <section aria-label="Quick answers" className="space-y-1.5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Quick answers</h3>
        {FAQ.map(([q, a]) => (
          <details key={q} className="group rounded-lg border border-slate-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">
              {q}
              <ChevronDownIcon size={14} className="shrink-0 text-slate-400 transition group-open:rotate-180" />
            </summary>
            <p className="border-t border-slate-100 px-3 py-2 text-xs leading-relaxed text-slate-600">{a}</p>
          </details>
        ))}
      </section>

      <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <a className="inline-flex items-center gap-1 font-semibold underline" href={SUPPORT_MAILTO}>
          <MailIcon size={12} /> {SUPPORT_EMAIL}
        </a>
        <a className="underline" href={PRIVACY_URL} target="_blank" rel="noreferrer">Privacy</a>
        <a className="underline" href={TERMS_URL} target="_blank" rel="noreferrer">Terms</a>
      </p>
    </div>
  );
}
