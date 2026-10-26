import { chartMoney } from "./LineChart";

export type BarRow = { name: string; value: number; detail?: string };

// Horizontal gain/loss bars on one shared dollar scale, centered on $0.
export default function DivergingBars({ rows, empty }: { rows: BarRow[]; empty: string }) {
  if (!rows.length) return <p className="py-10 text-center text-sm text-fg-subtle">{empty}</p>;
  const largest = Math.max(1, ...rows.map(r => Math.abs(r.value)));
  return <ul className="space-y-4">{rows.map(r => {
    const width = Math.abs(r.value) / largest * 50;
    return <li key={r.name}>
      <div className="mb-1 flex justify-between gap-3 text-xs"><span className="min-w-0 break-words text-slate-200">{r.name}{r.detail && <span className="text-fg-subtle"> · {r.detail}</span>}</span><strong className={`shrink-0 font-mono tabular-nums ${r.value < 0 ? "text-red-400" : r.value > 0 ? "text-emerald-400" : "text-fg-subtle"}`}>{chartMoney(r.value)}</strong></div>
      <div className="relative h-3 rounded bg-ink-800" aria-hidden="true"><span className="absolute inset-y-0 left-1/2 w-px bg-ink-500" />{width > 0 && <span className={`absolute inset-y-0 rounded ${r.value < 0 ? "bg-red-400" : "bg-emerald-400"}`} style={{ left: r.value < 0 ? `${50 - width}%` : "50%", width: `${Math.max(width, .75)}%` }} />}</div>
    </li>;
  })}</ul>;
}
