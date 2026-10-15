"use client";
import LineChart, { chartMoney } from "./LineChart";
import { journalPlot } from "@/lib/chart-data";
import { journalStats } from "@/lib/journal";

export default function JournalCharts({ stats }: { stats: ReturnType<typeof journalStats> }) {
  const largest = Math.max(1, ...stats.strategies.map(s => Math.abs(s.pnl)));
  return <div className="mt-5 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
    <LineChart title="Realized P&L curve" description="Cumulative closed-lot results after entered fees. Changes occur on closing dates; this is not account equity." points={journalPlot(stats.curve)} series={["Net P&L"]} xLabel="Closing date" xFormat={x => new Date(x).toISOString().slice(0,10)} stepped />
    <figure className="chart-panel"><h3 className="font-semibold text-slate-100">Strategy contribution</h3><p className="mt-1 text-xs text-fg-subtle">Realized P&L after fees · {stats.closed} closed lots</p>
      {!stats.strategies.length ? <p className="py-16 text-center text-sm text-fg-subtle">Your recorded strategies appear after a lot closes.</p> : <ul className="mt-5 max-h-80 space-y-4 overflow-auto">{stats.strategies.map(s => <li key={s.name}><div className="mb-1 flex justify-between gap-3 text-xs"><span className="min-w-0 break-words">{s.name} <span className="text-fg-subtle">· n={s.count}</span></span><strong className={`shrink-0 font-mono ${s.pnl < 0 ? "text-red-400" : "text-emerald-400"}`}>{chartMoney(s.pnl)}</strong></div><div className="relative h-3 rounded bg-ink-800" aria-hidden="true"><span className="absolute inset-y-0 left-1/2 w-px bg-ink-500" /><span className={`absolute inset-y-0 rounded ${s.pnl < 0 ? "bg-red-400" : "bg-emerald-400"}`} style={{ left: s.pnl < 0 ? `${50 - Math.abs(s.pnl)/largest*50}%` : "50%", width: `${Math.abs(s.pnl)/largest*50}%` }} /></div></li>)}</ul>}
      <figcaption className="mt-5 border-t border-ink-700 pt-3 text-xs text-fg-subtle">Left of center = loss · right = gain. Each bar uses the same dollar scale. {stats.wins} wins / {stats.losses} losses / {stats.breakeven} flat.</figcaption>
    </figure>
  </div>;
}
