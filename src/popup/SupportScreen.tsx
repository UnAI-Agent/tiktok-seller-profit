import { useEffect, useState } from "react";
import { SUPPORT_EMAIL } from "../config";
import { fetchMe, submitSupportTicket, trackEvent } from "../lib/apiClient";
import { isConnectionError } from "../lib/apiErrors";

const fieldClass =
  "rounded-xl border border-slate-200/80 bg-slate-50/80 px-3.5 py-2.5 text-sm font-normal text-slate-900 outline-none transition focus:border-tiktok/40 focus:bg-white focus:ring-2 focus:ring-tiktok/15";

export default function SupportScreen() {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void fetchMe()
      .then((me) => {
        if (me?.email) setEmail(me.email);
      })
      .catch(() => {
        /* keep the form usable offline */
      });
  }, []);

  async function handleSubmit() {
    setBusy(true);
    setMsg(null);
    const contactEmail = email.trim();
    const body = phone.trim()
      ? `${message.trim()}\n\nPhone: ${phone.trim()}`
      : message.trim();

    if (!contactEmail || !subject.trim() || !message.trim()) {
      setMsg("Email, subject, and message are required.");
      setBusy(false);
      return;
    }

    try {
      const res = await submitSupportTicket({
        email: contactEmail,
        subject: subject.trim(),
        message: body,
      });
      trackEvent("support.ticket_submitted", { ticket_id: res.id });
      setMsg(`Ticket #${res.id} submitted. We'll reply by email.`);
      setSubject("");
      setMessage("");
    } catch (err) {
      if (isConnectionError(err)) {
        setMsg("Connection lost. Check your internet.");
        setBusy(false);
        return;
      }
      window.open(
        `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      );
      setMsg("API unreachable — opened your email app instead.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col space-y-3 overflow-auto rounded-2xl border border-slate-200/60 bg-gradient-to-b from-white to-slate-50/90 p-4 text-sm shadow-sm">
      <p className="text-sm leading-relaxed text-slate-600">
        Describe a bug, billing question, or scraper issue. Include your TikTok
        shop region if relevant.
      </p>
      <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-700">
        Email
        <input
          className={fieldClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@shop.com"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-700">
        Phone (optional)
        <input
          className={fieldClass}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1 …"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-700">
        Subject
        <input
          className={fieldClass}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Overlay not syncing SKUs"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-700">
        Message
        <textarea
          className={`min-h-[120px] ${fieldClass}`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What happened? Steps to reproduce?"
        />
      </label>
      <button
        type="button"
        disabled={busy}
        className="rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 py-3 text-sm font-semibold text-white shadow-md transition hover:from-slate-800 hover:to-slate-700 disabled:opacity-50"
        onClick={() => void handleSubmit()}
      >
        {busy ? "Sending…" : "Submit ticket"}
      </button>
      {msg && (
        <p className="rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 text-xs text-slate-600">
          {msg}
        </p>
      )}
    </div>
  );
}
