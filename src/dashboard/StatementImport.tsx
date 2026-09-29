import { useEffect, useState } from "react";
import { InfoButton, type HelpTopic } from "../content/components/FieldHelp";
import type { Settings } from "../types/settings";
import type { SkuRecord } from "../types/sku";
import { computeProfit } from "../lib/profit";
import { profitInputFor } from "../lib/skuEconomics";
import { sendMessage } from "../lib/messages";
import {
  aggregateStatement,
  applySettlementRow,
  periodLabelFromRows,
  readStatementTable,
  rowsMatchedToProducts,
  STATEMENT_ID_MISMATCH,
  suggestMapping,
  type StatementField,
  type StatementMapping,
} from "../lib/statementImport";

const FIELDS: Array<[StatementField, string]> = [
  ["sku", "SKU / product id"],
  ["orderAmount", "Order amount"],
  ["referralFee", "Referral fee"],
  ["affiliateFee", "Affiliate commission"],
  ["shipping", "Shipping"],
  ["refund", "Refund"],
  ["date", "Date"],
];

const MAP_KEY = "statementMapping";

type StatementImportProps = {
  skus: SkuRecord[];
  settings: Settings;
  onHelp?: (topic: HelpTopic) => void;
};

export default function StatementImport({ skus, settings, onHelp }: StatementImportProps) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [mapping, setMapping] = useState<StatementMapping>({});
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Seller Center pages cannot read extension storage, so ask the service worker.
  useEffect(() => {
    void sendMessage({ type: "GET_LOCAL", keys: [MAP_KEY] })
      .then((res) => {
        const saved = res.ok ? (res.local?.[MAP_KEY] as StatementMapping | undefined) : undefined;
        if (saved) setMapping(saved);
      })
      .catch(() => undefined);
  }, []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const table = await readStatementTable(file);
      const suggested = { ...suggestMapping(table.headers), ...mapping };
      setHeaders(table.headers);
      setRows(table.rows);
      setMapping(suggested);
      setNote(null);
    } catch {
      setError("Couldn't read that file. Use a CSV or Excel export.");
    }
  }

  async function apply() {
    if (!mapping.sku || !mapping.orderAmount) {
      setError("Map the SKU and order amount columns.");
      return;
    }
    const linked = rowsMatchedToProducts(rows, mapping, skus);
    const nonempty = rows.some((row) => String(row[mapping.sku ?? ""] ?? "").trim());
    if (linked.matched === 0 && nonempty) {
      setNote(null);
      setError(STATEMENT_ID_MISMATCH);
      return;
    }
    const settlements = aggregateStatement(linked.rows, mapping);
    const period = periodLabelFromRows(rows, mapping);
    const byId = new Map(skus.map((s) => [s.skuId, s]));
    let updated = 0;
    for (const row of settlements) {
      const existing = byId.get(row.skuId);
      if (!existing) continue;
      const next: SkuRecord = {
        ...applySettlementRow(existing, row, period),
        updatedAt: new Date().toISOString(),
      };
      const profit = computeProfit(profitInputFor(next, settings));
      next.netProfit = profit.netProfit;
      next.netMarginPct = profit.netMarginPct ?? 0;
      const res = await sendMessage({ type: "SAVE_SKU", sku: next });
      if (res.ok) updated += 1;
    }
    await sendMessage({ type: "SET_LOCAL", values: { [MAP_KEY]: mapping } });
    if (updated === 0) {
      setNote(null);
      setError(STATEMENT_ID_MISMATCH);
      return;
    }
    setNote(`Updated ${updated} products. Stays on your computer.`);
    setError(null);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 text-xs" aria-label="Import statement">
      <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
        Use your real TikTok fees
        {onHelp && <InfoButton topic="statement" onOpen={onHelp} />}
      </p>
      <p className="mt-0.5 text-slate-600">Choose your statement file (CSV or Excel). It stays on your computer. Nothing is uploaded.</p>
      <input
        type="file"
        accept=".csv,.xlsx,.xls,text/csv"
        aria-label="Statement file"
        className="mt-2 block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-800"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {headers.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="font-semibold text-slate-700">Match your columns</p>
          {FIELDS.map(([field, label]) => (
            <label key={field} className="flex items-center justify-between gap-2">
              <span className="text-slate-700">{label}</span>
              <select
                className="max-w-[170px] rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                value={mapping[field] ?? ""}
                onChange={(e) =>
                  setMapping((prev) => ({ ...prev, [field]: e.target.value || undefined }))
                }
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
          <button
            type="button"
            className="mt-1 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            onClick={() => void apply()}
          >
            Apply to products
          </button>
        </div>
      )}
      {note && <p className="mt-2 rounded-lg bg-emerald-50 px-2 py-1.5 font-semibold text-emerald-800">{note}</p>}
      {error && <p className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-red-800">{error}</p>}
    </section>
  );
}
