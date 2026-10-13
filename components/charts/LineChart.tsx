"use client";

import { useId, useState } from "react";
import { plotDomain, type PlotPoint } from "@/lib/chart-data";

export const chartMoney = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const shortMoney = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
const colors = ["rgb(var(--emerald-400))", "rgb(var(--sky-400))"];

export default function LineChart({ title, description, points, series, xLabel, xFormat, valueFormat = chartMoney, stepped = false }: {
  title: string; description: string; points: PlotPoint[]; series: string[];
  xLabel: string; xFormat?: (x: number) => string; valueFormat?: (value: number) => string; stepped?: boolean;
}) {
  const id = useId(), [selected, setSelected] = useState<number | null>(null);
  const { xMin, xMax, yMin, yMax } = plotDomain(points);
  const left = 74, right = 686, top = 24, bottom = 222;
  const px = (x: number) => left + (x - xMin) / (xMax - xMin) * (right - left);
  const py = (y: number) => bottom - (y - yMin) / (yMax - yMin) * (bottom - top);
  const index = selected == null ? points.length - 1 : Math.min(selected, points.length - 1);
  const active = points[index];
  const tick = xFormat ?? ((x: number) => String(x));
  function selectAt(clientX: number, target: SVGSVGElement) {
    const bounds = target.getBoundingClientRect();
    const x = (clientX - bounds.left) / bounds.width * 720;
    let nearest = 0;
    points.forEach((p, n) => { if (Math.abs(px(p.x) - x) < Math.abs(px(points[nearest].x) - x)) nearest = n; });
    setSelected(nearest);
  }
  return <figure className="chart-panel" aria-labelledby={`${id}-title`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id={`${id}-title`} className="font-semibold text-slate-100">{title}</h3><p className="mt-1 text-xs leading-relaxed text-fg-subtle">{description}</p></div><span className="desk-badge">{stepped ? "Recorded" : "Hypothetical"}</span></div>
    {!points.length ? <div className="flex min-h-56 items-center justify-center rounded-lg border border-dashed border-ink-600 p-6 text-center text-sm text-fg-subtle">Close a journal lot to start this chart. Open positions are excluded.</div> : <>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs">{series.map((name, n) => <span key={name} className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: colors[n % colors.length] }} />{name} <strong className="font-mono tabular-nums">{valueFormat(active.values[n])}</strong></span>)}<span className="text-fg-subtle">{active.label}</span></div>
      <div className="mt-2 overflow-x-auto"><svg viewBox="0 0 720 268" className="w-full min-w-[520px]" role="group" aria-label={`${title}. Use left and right arrow keys to inspect points.`} tabIndex={0}
        onPointerMove={e => selectAt(e.clientX, e.currentTarget)} onPointerDown={e => selectAt(e.clientX, e.currentTarget)}
        onKeyDown={e => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); setSelected(e.key === "Home" ? 0 : e.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, index + (e.key === "ArrowLeft" ? -1 : 1)))); } }}>
        <title>{title}</title>
        {[0, .25, .5, .75, 1].map(t => { const y = yMin + (yMax - yMin) * t; return <g key={t}><line x1={left} x2={right} y1={py(y)} y2={py(y)} stroke="rgb(var(--ink-700))" /><text x={left - 10} y={py(y) + 4} textAnchor="end" className="chart-axis">{shortMoney(y)}</text></g>; })}
        <line x1={left} x2={right} y1={py(0)} y2={py(0)} stroke="rgb(var(--fg-subtle))" strokeDasharray="4 4" opacity=".6" />
        {series.map((name, n) => <path key={name} d={points.map((p, k) => `${k ? stepped ? "H" + px(p.x) + "V" : "L" : "M"}${stepped && k ? py(p.values[n]) : px(p.x) + " " + py(p.values[n])}`).join(" ")} fill="none" stroke={colors[n % colors.length]} strokeWidth="2.5" strokeLinejoin="round" />)}
        <line x1={px(active.x)} x2={px(active.x)} y1={top} y2={bottom} stroke="rgb(var(--fg-subtle))" strokeDasharray="3 4" />
        {series.map((name, n) => <circle key={name} cx={px(active.x)} cy={py(active.values[n])} r="4" fill={colors[n % colors.length]} stroke="rgb(var(--ink-900))" strokeWidth="2" />)}
        <text x={left} y="243" className="chart-axis">{tick(xMin)}</text><text x={right} y="243" textAnchor="end" className="chart-axis">{tick(points.at(-1)!.x)}</text>
        <text x={(left + right) / 2} y="263" textAnchor="middle" className="chart-axis">{xLabel}</text>
      </svg></div>
      <figcaption className="text-xs text-fg-subtle">Hover, touch, or focus the chart and use arrow keys to inspect. Scroll sideways on smaller screens. Dashed horizontal line = $0.</figcaption>
      <details className="mt-3 text-xs"><summary className="cursor-pointer text-slate-300">View chart data</summary><div className="mt-2 max-h-56 overflow-auto"><table className="w-full text-left tabular-nums"><caption className="sr-only">{title} exact values</caption><thead><tr><th scope="col" className="py-2">{xLabel}</th>{series.map(s => <th scope="col" key={s}>{s}</th>)}</tr></thead><tbody>{points.map((p,n) => <tr key={n} className="border-t border-ink-700"><th scope="row" className="py-2 font-normal">{p.label}</th>{p.values.map((v,k) => <td key={k}>{valueFormat(v)}</td>)}</tr>)}</tbody></table></div></details>
    </>}
  </figure>;
}
