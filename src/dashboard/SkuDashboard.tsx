import { useEffect, useMemo, useRef, useState } from "react";
import { FREE_SKU_LIMIT } from "../config";
import ExternalPriceCompare from "../content/components/ExternalPriceCompare";
import StatementImport from "./StatementImport";
import type { SkuRecord } from "../types/sku";
import type { Settings } from "../types/settings";
import { downloadCsv, reportFilename, toCsv } from "../lib/exportCsv";
import { diagnoseSku, portfolioStats } from "../lib/diagnose";
import {
  computeProfit,
  formatPct,
  formatSignedUsd,
  formatUsd,
  maxSafeCommissionPct,
} from "../lib/profit";
import { profitInputFor } from "../lib/skuEconomics";
import { sendMessage } from "../lib/messages";
import { savedCostCount } from "../lib/skuLimit";
import { HoverTip, type HelpTopic } from "../content/components/FieldHelp";
import { LockIcon } from "../ui/icons";
import ProLock from "../ui/ProLock";
import { Alert, Button, cx, inputClass, MarginPill, ProTag } from "../ui/primitives";
import { TONE, toneForDiagnosis, type Tone } from "../ui/tone";
import { useUpgrade } from "../ui/upgrade";

export type ProductFilter = "all" | "losing" | "below-target" | "healthy" | "missing-cost";

type SkuDashboardProps = {
  skus: SkuRecord[];
  isPro: boolean;
  settings: Settings;
  focusMissing?: boolean;
  editCost?: { skuId: string; token: number } | null;
  /** Jump to a filter from another screen (for example a profit board tile). */
  filterRequest?: { filter: ProductFilter; token: number } | null;
  onHelp?: (topic: HelpTopic) => void;
};

type SortKey = "margin" | "net" | "sold" | "title" | "leaks";

const FREE_STATUS: Record<Tone, string> = {
  profit: "Profitable",
  warning: "Thin margin",
  loss: "Losing money",
  neutral: "Add cost",
};

const STATEMENT_PREVIEW = (
  <div className="space-y-2 text-xs">
    <div className="flex justify-between"><span>Fee you were charged</span><b>7.2%</b></div>
    <div className="flex justify-between"><span>Estimate vs actual</span><b>+$0.42 / sale</b></div>
    <div className="h-8 rounded bg-slate-100" />
  </div>
);

function ProductRow({
  sku,
  settings,
  isPro,
  editing,
  onEdit,
  onSaveCost,
  onSample,
  onCompare,
  rowError,
  rowRef,
}: {
  sku: SkuRecord;
  settings: Settings;
  isPro: boolean;
  editing: boolean;
  onEdit: () => void;
  onSaveCost: (value: number) => void;
  onSample: () => void;
  onCompare: () => void;
  rowError?: string | null;
  rowRef?: React.Ref<HTMLLIElement>;
}) {
  const upgrade = useUpgrade();
  const [menu, setMenu] = useState(false);
  const input = profitInputFor(sku, settings);
  const profit = computeProfit(input);
  const diagnosis = diagnoseSku(sku, settings);
  const tone = toneForDiagnosis(diagnosis.tone);
  const t = TONE[tone];
  const missing = (sku.costSource ?? "default") === "default" && sku.cogsPerUnit === 0;
  const caps = isPro && !missing ? maxSafeCommissionPct(input, settings.targetMarginPct) : null;
  const estimate = sku.costSource === "settlement" ? computeProfit(profitInputFor(sku, settings, {}, false)).netPerUnit : null;
  const soFar = !missing && sku.unitsSold > 0 ? profit.netPerUnit * sku.unitsSold : null;

  return (
    <li ref={rowRef} className={cx("relative rounded-xl border border-slate-200 border-l-4 bg-white p-3", t.accent)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900" title={sku.title}>
            {sku.title}
          </p>
          <p className="text-xs tabular-nums text-slate-500">
            {sku.listPrice > 0 ? formatUsd(sku.listPrice) : "—"}
            {sku.listPriceOriginal ? ` (was ${formatUsd(sku.listPriceOriginal)})` : ""} ·{" "}
            {sku.unitsSold > 0 ? `${sku.unitsSold.toLocaleString()} sold` : "no sales yet"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {missing ? (
            <Button variant="secondary" size="sm" onClick={onEdit}>
              Add cost
            </Button>
          ) : (
            <>
              <p className={cx("text-lg font-extrabold leading-none tabular-nums", t.text)} aria-label={`You keep ${formatSignedUsd(profit.netPerUnit)} per sale`}>
                {formatSignedUsd(profit.netPerUnit)}
              </p>
              <p className="mt-1 flex justify-end">
                <MarginPill pct={profit.netMarginPct} tone={tone} />
              </p>
            </>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        {editing ? (
          <span className="inline-flex items-center gap-1">
            <span className="text-slate-600">Cost $</span>
            <input
              autoFocus
              aria-label="Purchase cost"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              className={cx(inputClass, "!w-24 !py-1")}
              defaultValue={sku.cogsPerUnit}
              onBlur={(e) => onSaveCost(Number(e.target.value) || 0)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </span>
        ) : (
          !missing && (
            <button
              type="button"
              className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700 hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              onClick={onEdit}
              title="Change what you paid for one unit"
            >
              Cost {formatUsd(sku.cogsPerUnit)} ✎
            </button>
          )
        )}
        {isPro ? (
          <span className={cx("rounded-full px-2 py-0.5 font-semibold", t.pill)}>{diagnosis.label}</span>
        ) : (
          <span className={cx("rounded-full px-2 py-0.5 font-semibold", t.pill)}>{FREE_STATUS[tone]}</span>
        )}
        {isPro && caps && caps.atTarget != null && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
            {caps.atTarget <= 0 ? "No room for commission" : `Max commission ${formatPct(caps.atTarget)}`}
          </span>
        )}
        {isPro && soFar != null && (
          <span className={cx("font-semibold tabular-nums", soFar >= 0 ? "text-emerald-700" : "text-red-700")}>
            {formatSignedUsd(soFar)} so far
          </span>
        )}
        {isPro && estimate != null && (
          <span className="text-slate-500">vs est. {formatSignedUsd(profit.netPerUnit - estimate)}</span>
        )}
        {!isPro && !missing && tone === "loss" && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700 hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            onClick={() => upgrade("row-fix")}
          >
            <LockIcon size={11} /> See the fix
          </button>
        )}
        <span className="relative ml-auto">
          <button
            type="button"
            className="rounded-md px-1.5 py-0.5 text-base leading-none text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            aria-label="Row menu"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((open) => !open)}
          >
            ⋯
          </button>
          {menu && (
            <div role="menu" className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white p-1 text-xs shadow-lg">
              <button
                role="menuitem"
                type="button"
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-slate-50"
                onClick={() => {
                  onCompare();
                  setMenu(false);
                }}
              >
                Compare prices {!isPro && <ProTag />}
              </button>
              <button
                role="menuitem"
                type="button"
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-slate-50"
                onClick={() => {
                  if (isPro) onSample();
                  else upgrade("row-sample");
                  setMenu(false);
                }}
              >
                +1 sample sent {!isPro && <ProTag />}
              </button>
            </div>
          )}
        </span>
      </div>
      {rowError && (
        <Alert tone="warning" className="mt-2">
          {rowError}{" "}
          <button type="button" className="font-semibold underline" onClick={() => upgrade("row-limit")}>
            See Pro
          </button>
        </Alert>
      )}
    </li>
  );
}

export default function SkuDashboard({ skus, isPro, settings, focusMissing, editCost, filterRequest, onHelp }: SkuDashboardProps) {
  const upgrade = useUpgrade();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("leaks");
  const [filter, setFilter] = useState<ProductFilter>("all");
  const [compareSku, setCompareSku] = useState<SkuRecord | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const editingRow = useRef<HTMLLIElement | null>(null);
  const stats = useMemo(() => portfolioStats(skus, settings), [skus, settings]);

  useEffect(() => {
    if (focusMissing) setFilter("missing-cost");
  }, [focusMissing]);

  useEffect(() => {
    if (filterRequest) setFilter(filterRequest.filter);
  }, [filterRequest]);

  useEffect(() => {
    if (!editCost) return;
    setQuery("");
    setFilter("all");
    setEditing(editCost.skuId);
  }, [editCost]);

  useEffect(() => {
    editingRow.current?.scrollIntoView?.({ block: "nearest" });
  }, [editing]);

  const rows = useMemo(
    () =>
      skus.map((sku) => {
        const profit = computeProfit(profitInputFor(sku, settings));
        const diagnosis = diagnoseSku(sku, settings);
        return { sku, profit, diagnosis };
      }),
    [skus, settings],
  );

  const counts = useMemo(() => {
    const c = { all: rows.length, losing: 0, "below-target": 0, healthy: 0, "missing-cost": 0 };
    for (const { diagnosis } of rows) {
      if (diagnosis.status === "missing-cost") c["missing-cost"] += 1;
      else if (diagnosis.tone === "red") c.losing += 1;
      else if (diagnosis.tone === "amber") c["below-target"] += 1;
      else c.healthy += 1;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const anySales = skus.some((sku) => sku.unitsSold > 0);
    const list = rows.filter(({ sku, diagnosis }) => {
      if (q && !sku.title.toLowerCase().includes(q) && !sku.skuId.toLowerCase().includes(q)) return false;
      if (filter === "losing") return diagnosis.status !== "missing-cost" && diagnosis.tone === "red";
      if (filter === "below-target") return diagnosis.tone === "amber";
      if (filter === "healthy") return diagnosis.tone === "green";
      if (filter === "missing-cost") return diagnosis.status === "missing-cost";
      return true;
    });
    list.sort((a, b) => {
      switch (sortKey) {
        case "net":
          return b.profit.netPerUnit - a.profit.netPerUnit;
        case "sold":
          return b.sku.unitsSold - a.sku.unitsSold;
        case "title":
          return a.sku.title.localeCompare(b.sku.title);
        case "leaks": {
          const score = (row: (typeof rows)[number]) =>
            row.diagnosis.status === "missing-cost" ? Number.POSITIVE_INFINITY : anySales ? row.profit.netPerUnit * row.sku.unitsSold : row.profit.netPerUnit;
          return score(a) - score(b);
        }
        default:
          return (a.profit.netMarginPct ?? 0) - (b.profit.netMarginPct ?? 0);
      }
    });
    return list;
  }, [rows, skus, query, sortKey, filter]);

  const costsSaved = savedCostCount(skus);
  const meter = stats.total === 0 ? 0 : Math.round((stats.realCosts / stats.total) * 100);
  const freeMeter = Math.min(100, Math.round((costsSaved / FREE_SKU_LIMIT) * 100));

  async function saveCogs(sku: SkuRecord, cogsPerUnit: number) {
    const next: SkuRecord = {
      ...sku,
      cogsPerUnit,
      costSource: sku.costSource === "settlement" ? "settlement" : "custom",
      updatedAt: new Date().toISOString(),
    };
    const profit = computeProfit(profitInputFor(next, settings));
    next.netProfit = profit.netProfit;
    next.netMarginPct = profit.netMarginPct ?? 0;
    const res = await sendMessage({ type: "SAVE_SKU", sku: next });
    setEditing(null);
    setRowErrors((prev) => {
      const copy = { ...prev };
      if (res.ok) delete copy[sku.skuId];
      else copy[sku.skuId] = res.error || "Couldn't save that cost.";
      return copy;
    });
  }

  async function addSample(sku: SkuRecord) {
    const next: SkuRecord = {
      ...sku,
      samplesSent: (sku.samplesSent ?? 0) + 1,
      sampleUnitCost: sku.sampleUnitCost ?? sku.cogsPerUnit + sku.shippingOut,
      updatedAt: new Date().toISOString(),
    };
    const profit = computeProfit(profitInputFor(next, settings));
    next.netProfit = profit.netProfit;
    next.netMarginPct = profit.netMarginPct ?? 0;
    await sendMessage({ type: "SAVE_SKU", sku: next });
  }

  function exportCsv() {
    const headers = ["Product", "SKU", "Price", "COGS", "Sold", "Net/unit", "Max comm %", "Status", "Estimate vs actual"];
    const out = skus.map((sku) => {
      const profit = computeProfit(profitInputFor(sku, settings));
      const estimate = computeProfit(profitInputFor(sku, settings, {}, false)).netPerUnit;
      const caps = maxSafeCommissionPct(profitInputFor(sku, settings), settings.targetMarginPct);
      const status = diagnoseSku(sku, settings).label;
      const cents = (value: number) => Math.round(value * 100) / 100;
      return [
        sku.title,
        sku.skuId,
        sku.listPrice,
        sku.cogsPerUnit,
        sku.unitsSold,
        cents(profit.netPerUnit),
        caps.atTarget == null ? "" : cents(caps.atTarget),
        status,
        sku.costSource === "settlement" ? cents(profit.netPerUnit - estimate) : "",
      ];
    });
    downloadCsv(reportFilename(), toCsv(headers, out));
  }

  if (skus.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
          <p className="text-sm font-semibold text-slate-800">No products yet</p>
          <p className="mt-1 text-xs text-slate-600">
            Open <b>Manage products</b> in Seller Center. Your listings import on their own.
          </p>
        </div>
        {isPro ? (
          <StatementImport skus={skus} settings={settings} onHelp={onHelp} />
        ) : null}
      </div>
    );
  }

  const FILTERS: Array<[ProductFilter, string, Tone]> = [
    ["all", "All", "neutral"],
    ["losing", "Losing", "loss"],
    ["below-target", "Thin", "warning"],
    ["healthy", "Healthy", "profit"],
    ["missing-cost", "No cost", "neutral"],
  ];

  return (
    <div className="space-y-3">
      {isPro ? (
        <button type="button" className="block w-full text-left" onClick={() => setFilter("missing-cost")} aria-label="Show products missing a cost">
          <div className="mb-1 flex justify-between text-xs text-slate-600">
            <span>
              <b className="text-slate-900">{stats.realCosts}</b> of {stats.total} products have a real cost
            </span>
            <span className="font-semibold tabular-nums">{meter}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${meter}%` }} />
          </div>
        </button>
      ) : (
        <div>
          <div className="mb-1 flex justify-between text-xs text-slate-600">
            <span>
              Free costs saved: <b className="text-slate-900">{Math.min(costsSaved, FREE_SKU_LIMIT)}/{FREE_SKU_LIMIT}</b>
              {costsSaved >= FREE_SKU_LIMIT && (
                <>
                  {" · "}
                  <button type="button" className="font-bold text-indigo-700 underline" onClick={() => upgrade("limit")}>
                    Unlock unlimited
                  </button>
                </>
              )}
            </span>
            <span className="font-semibold text-indigo-700">Pro: unlimited</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={cx("h-full rounded-full transition-all", costsSaved >= FREE_SKU_LIMIT ? "bg-indigo-600" : "bg-slate-400")} style={{ width: `${freeMeter}%` }} />
          </div>
        </div>
      )}

      {!isPro && stats.losing > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
          <p className="min-w-0 flex-1 text-xs text-red-900">
            <b>{stats.losing}</b> product{stats.losing === 1 ? " is" : "s are"} losing money. Pro shows the exact fix for each.
          </p>
          <Button variant="pro" size="sm" onClick={() => upgrade("losing-fix")}>
            See fixes
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter products">
        {FILTERS.map(([id, label, tone]) => {
          const active = filter === id;
          const count = counts[id];
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              className={cx(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500",
                active ? "bg-slate-900 text-white" : `${TONE[tone].pill} hover:opacity-80`,
              )}
              onClick={() => setFilter(id)}
            >
              {label}
              <span className={cx("tabular-nums", active ? "text-white/80" : "opacity-70")}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <input
          className={cx(inputClass, "!py-1.5 text-xs")}
          placeholder="Search by name or ID…"
          aria-label="Search products"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Sort products"
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
        >
          <option value="leaks">Biggest leaks first</option>
          <option value="margin">Lowest margin</option>
          <option value="net">Highest profit / sale</option>
          <option value="sold">Most sold</option>
          <option value="title">Name A–Z</option>
        </select>
      </div>

      <details className="group text-xs text-slate-500">
        <summary className="cursor-pointer list-none font-semibold text-slate-600 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">
          How to read this <span className="text-slate-400 group-open:hidden">▸</span>
          <span className="hidden text-slate-400 group-open:inline">▾</span>
        </summary>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="inline-flex items-center">
            Cost
            <HoverTip text="What you paid to buy one unit. Click the amount to change it. Net profit subtracts this from the buyer price." />
          </span>
          <span className="inline-flex items-center">
            You keep / sale
            <HoverTip text="Buyer price minus your cost, TikTok fees, shipping you pay, ads, and creator commission. One sale." />
          </span>
          <span className="inline-flex items-center">
            Max commission {!isPro && <ProTag className="ml-1" />}
            <HoverTip align="end" text="Highest creator commission that still hits your margin goal, after cost and TikTok fees." />
          </span>
          <span className="inline-flex items-center">
            Status {!isPro && <ProTag className="ml-1" />}
            <HoverTip align="end" text="Losing, thin, healthy, or still missing a cost, based on that net per sale." />
          </span>
        </p>
      </details>

      {compareSku && <ExternalPriceCompare title={compareSku.title} listPrice={compareSku.listPrice} isPro={isPro} />}

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-600">
          {filter === "all" ? "No products match that search." : "Nothing in this group. Nice."}
        </p>
      ) : (
        <ul className="max-h-[360px] space-y-2 overflow-y-auto pr-0.5" aria-label="Products">
          {filtered.map(({ sku }) => (
            <ProductRow
              key={sku.skuId}
              sku={sku}
              settings={settings}
              isPro={isPro}
              editing={editing === sku.skuId}
              rowRef={editing === sku.skuId ? editingRow : undefined}
              rowError={rowErrors[sku.skuId]}
              onEdit={() => setEditing(sku.skuId)}
              onSaveCost={(value) => void saveCogs(sku, value)}
              onSample={() => void addSample(sku)}
              onCompare={() => setCompareSku(sku)}
            />
          ))}
        </ul>
      )}

      {isPro ? (
        <>
          <StatementImport skus={skus} settings={settings} onHelp={onHelp} />
          <Button variant="secondary" size="sm" onClick={exportCsv}>
            Export CSV
          </Button>
        </>
      ) : (
        <ProLock
          placement="statement"
          title="Use your real TikTok fees"
          blurb="Import your statement to replace estimates with what TikTok actually charged you."
          preview={STATEMENT_PREVIEW}
        />
      )}
    </div>
  );
}
