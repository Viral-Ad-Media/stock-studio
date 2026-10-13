"use client";
import { useState } from "react";

type Sector = { symbol: string; name: string; change1d: number; change5d: number; change1m: number; relative1m: number };
const periods = [{ key: "change1d", label: "1 session" }, { key: "change5d", label: "5 sessions" }, { key: "change1m", label: "1 month" }, { key: "relative1m", label: "vs SPY · 1 month" }] as const;

export default function SectorChart({ sectors, asOf }: { sectors: Sector[]; asOf: string | null }) {
  const [period, setPeriod] = useState<(typeof periods)[number]["key"]>("relative1m");
  const rows = sectors.filter(s => Number.isFinite(s[period])).sort((a,b) => b[period] - a[period]);
  const largest = Math.max(.1, ...rows.map(s => Math.abs(s[period])));
  const unit = period === "relative1m" ? " pts" : "%";
  return <figure className="chart-panel mt-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-100">Sector leadership map</h3><p className="mt-1 text-xs text-fg-subtle">Yahoo Finance daily bars · {asOf ?? "Date unavailable"} · session may be incomplete</p></div><span className="desk-badge">Daily bars</span></div>
    <div className="my-4 flex flex-wrap gap-2" role="group" aria-label="Sector chart period">{periods.map(p => <button key={p.key} type="button" aria-pressed={period === p.key} onClick={() => setPeriod(p.key)} className={`rounded-lg border px-3 py-2 text-xs ${period === p.key ? "border-emerald-400 bg-emerald-500/10 text-emerald-400" : "border-ink-600 text-slate-300 hover:bg-ink-800"}`}>{p.label}</button>)}</div>
    {!rows.length ? <p className="py-6 text-sm text-fg-subtle">Sector data is unavailable for this period.</p> : <ol className="space-y-2">{rows.map(s => <li key={s.symbol} className="grid grid-cols-[3rem_1fr_4.5rem] items-center gap-3 text-xs sm:grid-cols-[11rem_1fr_5rem]"><span title={s.name}><strong className="font-mono">{s.symbol}</strong><span className="ml-2 hidden text-fg-subtle sm:inline">{s.name}</span></span><div className="relative h-5 rounded bg-ink-800" aria-hidden="true"><span className="absolute inset-y-0 left-1/2 w-px bg-ink-500" /><span className={`absolute inset-y-1 rounded-sm ${s[period] < 0 ? "bg-red-400" : "bg-emerald-400"}`} style={{ left: s[period] < 0 ? `${50 - Math.abs(s[period])/largest*50}%` : "50%", width: `${Math.abs(s[period])/largest*50}%` }} /></div><span className={`text-right font-mono tabular-nums ${s[period] < 0 ? "text-red-400" : "text-emerald-400"}`}>{s[period] > 0 ? "+" : ""}{s[period].toFixed(1)}{unit}</span></li>)}</ol>}
    <figcaption className="mt-4 text-xs leading-relaxed text-fg-subtle">Left = negative · right = positive. Common scale across sectors; scale resets when the period changes. Relative returns are percentage-point differences from SPY. These are historical changes, not forecasts.</figcaption>
  </figure>;
}
