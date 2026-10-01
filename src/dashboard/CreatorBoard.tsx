import { useEffect, useMemo, useState } from "react";
import {
  aggregateCreatorOrders,
  CREATOR_FIELD_LABELS,
  creatorResults,
  creatorSummary,
  suggestCreatorMapping,
  type CreatorMapping,
  type CreatorResult,
  type CreatorStore,
} from "../lib/creatorProfit";
import { formatPct, formatSignedUsd, formatUsd } from "../lib/profit";
import { ImportLimitError, readStatementTable } from "../lib/statementImport";
import { sendMessage } from "../lib/messages";
import { trackEvent } from "../lib/apiClient";
import type { Settings } from "../types/settings";
import type { SkuRecord } from "../types/sku";
import ProLock from "../ui/ProLock";
import { Button, cx } from "../ui/primitives";
import { TONE } from "../ui/tone";

const STORE_KEY = "creatorOrders";
const MAP_KEY = "creatorMapping";

const PREVIEW = (
  <ul className="space-y-1.5 text-xs">
    <li className="flex justify-between"><span>@glowwithjess</span><b className="text-red-700">-$184.20</b></li>
    <li className="flex justify-between"><span>@kitchenhacks</span><b className="text-amber-700">+$42.10</b></li>
    <li className="flex justify-between"><span>@deskgoals</span><b className="text-emerald-700">+$611.90</b></li>
  </ul>
);

const VERDICT_TONE = { losing: "loss", renegotiate: "warning", keep: "profit", "add-costs": "neutral" } as const;

type CreatorBoardProps = {
  skus: SkuRecord[];
  settings: Settings;
  isPro: boolean;
};

/** Which creators make you money, which ones cost you, and the commission that fixes it. */
export default function CreatorBoard({ skus, settings, isPro }: CreatorBoardProps) {
  const [store, setStore] = useState<CreatorStore | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [mapping, setMapping] = useState<CreatorMapping>({});
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void sendMessage({ type: "GET_LOCAL", keys: [STORE_KEY, MAP_KEY] }).then((res) => {
      if (!res.ok) return;
      const saved = res.local?.[STORE_KEY] as CreatorStore | undefined;
      if (saved && Array.isArray(saved.creators)) setStore(saved);
      const map = res.local?.[MAP_KEY] as CreatorMapping | undefined;
      if (map) setMapping(map);
    });
    trackEvent("creator.viewed", { pro: isPro });
  }, [isPro]);

  const results = useMemo(() => creatorResults(store, skus, settings), [store, skus, settings]);
  const summary = useMemo(() => creatorSummary(results), [results]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNote(null);
    try {
      const table = await readStatementTable(file);
      setHeaders(table.headers);
      setRows(table.rows);
      setMapping((prev) => ({ ...suggestCreatorMapping(table.headers), ...prev }));
    } catch (err) {
      setError(err instanceof ImportLimitError ? err.message : "Couldn't read that file. Use the affiliate orders CSV or Excel export.");
    }
  }

  async function apply() {
    if (!mapping.creator || !mapping.revenue) {
      setError("Match the creator and sale amount columns.");
      return;
    }
    if (!mapping.commission && !mapping.commissionRate) {
      setError("Match the commission paid or commission rate column.");
      return;
    }
    const next = aggregateCreatorOrders(rows, mapping, skus);
    if (next.creators.length === 0) {
      setError("No creator names found in that column.");
      return;
    }
    const res = await sendMessage({ type: "SET_LOCAL", values: { [STORE_KEY]: next, [MAP_KEY]: mapping } });
    if (!res.ok) {
      setError("Couldn't save the import. Try a smaller date range.");
      return;
    }
    setStore(next);
    setHeaders([]);
    setRows([]);
    setError(null);
    setNote(`Imported ${next.rows} orders from ${next.creators.length} creators. Stays on your computer.`);
    trackEvent("creator.imported", { creators: next.creators.length, rows: next.rows });
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-bold text-slate-900">Profit per creator</p>
        <p className="text-xs text-slate-600">
          Which creators make you money after your cost, TikTok fees and their commission. Your ad spend is left out.
        </p>
      </div>

      {results.length > 0 && (
        <div
          className={cx("rounded-xl border px-3 py-2", summary.losing > 0 ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50")}
          data-testid="creator-summary"
        >
          <p className={cx("text-sm font-extrabold", summary.losing > 0 ? "text-red-900" : "text-emerald-900")}>
            {summary.losing > 0
              ? `${summary.losing} of ${summary.creators} creators lose you money`
              : `All ${summary.creators} priced creators are profitable`}
          </p>
          <p className="text-xs text-slate-700">
            {summary.losing > 0 ? `${formatUsd(summary.lost)} lost on their sales. ` : ""}
            {formatUsd(summary.commission)} paid in commission.
          </p>
        </div>
      )}

      {results.length > 0 &&
        (isPro ? (
          <ul className="space-y-2" aria-label="Creators">
            {results.map((row) => (
              <CreatorRow key={row.creator} row={row} />
            ))}
          </ul>
        ) : (
          <ProLock
            placement="creators"
            title="See every creator's profit and fix"
            blurb="Pro shows each creator's profit, the commission that keeps them profitable, and who to scale or drop."
            preview={PREVIEW}
          />
        ))}

      <section className="rounded-xl border border-slate-200 bg-white p-3 text-xs" aria-label="Import creator orders">
        <p className="text-sm font-bold text-slate-900">{store ? "Update creator orders" : "Import creator orders"}</p>
        <p className="mt-0.5 text-slate-600">
          In Seller Center open <b>Affiliate → Orders</b> (or <b>Data → Affiliate</b>), export the orders, and choose the file here. It stays on your computer.
        </p>
        <input
          type="file"
          accept=".csv,.xlsx,.xls,text/csv"
          aria-label="Creator orders file"
          className="mt-2 block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-800"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        {headers.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="font-semibold text-slate-700">Match your columns</p>
            {CREATOR_FIELD_LABELS.map(([field, label]) => (
              <label key={field} className="flex items-center justify-between gap-2">
                <span className="text-slate-700">{label}</span>
                <select
                  aria-label={label}
                  className="max-w-[170px] rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                  value={mapping[field] ?? ""}
                  onChange={(e) => setMapping((prev) => ({ ...prev, [field]: e.target.value || undefined }))}
                >
                  <option value="">Skip</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <Button variant="primary" block onClick={() => void apply()}>
              Show creator profit
            </Button>
          </div>
        )}
        {note && <p className="mt-2 rounded-lg bg-emerald-50 px-2 py-1.5 font-semibold text-emerald-800">{note}</p>}
        {error && <p className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-red-800">{error}</p>}
      </section>
    </div>
  );
}

function CreatorRow({ row }: { row: CreatorResult }) {
  const tone = TONE[VERDICT_TONE[row.verdict]];
  return (
    <li className="rounded-xl border border-slate-200 bg-white px-3 py-2" data-creator={row.creator} data-verdict={row.verdict}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-sm font-bold text-slate-900">{row.creator}</p>
        <p className={cx("shrink-0 text-sm font-extrabold tabular-nums", tone.text)}>
          {row.net == null ? "—" : formatSignedUsd(row.net)}
        </p>
      </div>
      <p className="text-[11px] tabular-nums text-slate-600">
        {row.orders} order{row.orders === 1 ? "" : "s"} · {formatUsd(row.revenue)} sales · {formatPct(row.commissionPct)} commission
        {row.marginPct != null ? ` · ${formatPct(row.marginPct)} margin` : ""}
        {row.refunded > 0 ? ` · ${row.refunded} refunded` : ""}
      </p>
      <p className={cx("mt-1 text-xs font-semibold", tone.text)}>{row.label}</p>
      {row.unpricedRevenue > 0 && row.net != null && (
        <p className="text-[11px] text-slate-500">{formatUsd(row.unpricedRevenue)} of sales had no saved cost and is not counted.</p>
      )}
    </li>
  );
}
