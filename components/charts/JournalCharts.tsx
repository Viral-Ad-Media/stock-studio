"use client";
import LineChart from "./LineChart";
import DivergingBars from "./DivergingBars";
import { journalPlot } from "@/lib/chart-data";
import { journalStats } from "@/lib/journal";

export default function JournalCharts({ stats }: { stats: ReturnType<typeof journalStats> }) {
  const strategies = [...stats.strategies].sort((a, b) => b.pnl - a.pnl);
  return <div className="mt-5 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
    <LineChart title="Realized P&L curve" description="Cumulative closed-lot results after entered fees, and how far each day sits below the best realized total so far. Changes occur on closing dates; this is not account equity." points={journalPlot(stats.curve)} series={["Net P&L", "Below peak"]} seriesStyle={["line", "area"]} xLabel="Closing date" xFormat={x => new Date(x).toISOString().slice(0, 10)} stepped />
    <figure className="chart-panel"><h3 className="font-semibold text-slate-100">Strategy contribution</h3><p className="mt-1 mb-5 text-xs text-fg-subtle">Realized P&L after fees · {stats.closed} closed lots</p>
      <DivergingBars rows={strategies.map(s => ({ name: s.name, value: s.pnl, detail: `${s.count} ${s.count === 1 ? "lot" : "lots"}` }))} empty="Your recorded strategies appear after a lot closes." />
      <figcaption className="mt-5 border-t border-ink-700 pt-3 text-xs text-fg-subtle">Left of center = loss · right = gain, all on one dollar scale. {stats.wins} wins / {stats.losses} losses / {stats.breakeven} flat.</figcaption>
    </figure>
  </div>;
}
