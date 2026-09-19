import { useState } from "react";
import { runSelfTest, type SelfTestReport } from "../lib/runSelfTest";

export default function SelfTestPanel() {
  const [report, setReport] = useState<SelfTestReport | null>(null);

  function handleRun() {
    setReport(runSelfTest());
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Pre-release checks
      </p>
      <p className="mt-1 text-xs text-slate-600">
        Runs mock TikTok HTML through the scraper and profit math (no network).
      </p>
      <button
        type="button"
        className="mt-2 w-full rounded-lg border border-slate-300 py-2 text-sm font-medium hover:bg-slate-50"
        onClick={handleRun}
      >
        Run self-test
      </button>
      {report && (
        <div className="mt-2 space-y-1 text-xs">
          <p
            className={
              report.failed === 0 ? "text-green-700" : "text-amber-800"
            }
          >
            {report.passed}/{report.results.length} passed
          </p>
          <ul className="max-h-32 space-y-1 overflow-auto">
            {report.results.map((r) => (
              <li key={r.name} className="flex gap-1">
                <span>{r.pass ? "✓" : "✗"}</span>
                <span>
                  {r.name}
                  <span className="text-slate-400"> — {r.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
