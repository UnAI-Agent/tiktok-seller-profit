export type HelpTopic = "costs" | "board" | "statement";

const COPY: Record<HelpTopic, { title: string; hover: string; lines: string[] }> = {
  costs: {
    title: "Your costs",
    hover: "What you pay for one unit. TikTok's fee is separate.",
    lines: [
      "COGS is the supplier price for one unit. Type it in the COGS box.",
      "Packaging is the box and label. Use 0 if the supplier price already includes it.",
      "Ads / unit is ad spend for one order. Use 0 if you are not running ads.",
      "Commission % is what you pay a creator. Settings holds the default until you change this box.",
    ],
  },
  board: {
    title: "Who is losing money",
    hover: "Losing, thin, healthy, or still missing a cost.",
    lines: [
      "Losing means the sale price does not cover your costs.",
      "Thin means you make money, but less than your target margin.",
      "Healthy means you are at or above that target.",
      "Missing cost means COGS is empty, so profit stays hidden.",
      "Add purchase cost opens the box where you enter what you paid.",
    ],
  },
  statement: {
    title: "Import a statement",
    hover: "Optional. Uses your real TikTok fees instead of the estimate.",
    lines: [
      "This file is your own settlement. It stays on this computer.",
      "In Seller Center, download the statement CSV.",
      "Open Products here and choose that file.",
      "Matching products then use your real fees, refunds, and units sold.",
      "Skip this until you have sales. The fee estimate is used until then.",
    ],
  },
};

export function helpHover(topic: HelpTopic): string {
  return COPY[topic].hover;
}

export function HoverTip({ text, align = "start" }: { text: string; align?: "start" | "end" }) {
  const side = align === "end" ? "right-0" : "left-0";
  return (
    <span className="group/tip relative inline-flex align-middle">
      <span
        tabIndex={0}
        role="img"
        className="ml-0.5 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-slate-400 bg-white text-[10px] font-bold leading-none text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        aria-label={text}
      >
        i
      </span>
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${side} top-full z-30 mt-1 hidden w-56 rounded-lg bg-slate-900 px-2.5 py-1.5 text-left text-xs font-normal normal-case leading-snug tracking-normal text-white shadow-lg group-hover/tip:block group-focus-within/tip:block`}
      >
        {text}
      </span>
    </span>
  );
}

export function InfoButton({
  topic,
  onOpen,
}: {
  topic: HelpTopic;
  onOpen: (topic: HelpTopic) => void;
}) {
  const copy = COPY[topic];
  return (
    <button
      type="button"
      aria-label={copy.title}
      title={copy.hover}
      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-400 text-[10px] font-bold leading-none text-slate-600 hover:bg-slate-100"
      onClick={() => onOpen(topic)}
    >
      i
    </button>
  );
}

export function HelpPanel({
  topic,
  onClose,
}: {
  topic: HelpTopic;
  onClose: () => void;
}) {
  const copy = COPY[topic];
  return (
    <div className="space-y-2 px-4 py-4 text-xs text-slate-700">
      <button type="button" className="text-xs font-semibold text-slate-600 hover:text-slate-900" onClick={onClose}>
        ← Back
      </button>
      <p className="text-sm font-bold text-slate-900">{copy.title}</p>
      <ul className="list-disc space-y-1.5 pl-4 leading-relaxed">
        {copy.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
