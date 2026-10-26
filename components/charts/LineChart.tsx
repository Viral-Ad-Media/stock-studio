"use client";

import { useEffect, useId, useRef, useState } from "react";
import { axisTicks, compactMoney, niceTicks, plotDomain, type PlotPoint } from "@/lib/chart-data";

export const chartMoney = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const colors = ["rgb(var(--emerald-400))", "rgb(var(--sky-400))"];
export type ChartMarker = { x: number; label: string };

// The SVG is drawn at the container's real pixel width, so axis text stays
// readable on phones instead of shrinking with a fixed viewBox.
export default function LineChart({ title, description, points, series, xLabel, xFormat, valueFormat = chartMoney, stepped = false, initialX, markers = [], badge, emptyText = "Close a journal lot to start this chart. Open positions are excluded.", seriesStyle = [] }: {
  title: string; description: string; points: PlotPoint[]; series: string[];
  xLabel: string; xFormat?: (x: number) => string; valueFormat?: (value: number) => string; stepped?: boolean;
  initialX?: number; markers?: ChartMarker[]; badge?: string; emptyText?: string; seriesStyle?: ("line" | "area")[];
}) {
  const id = useId(), box = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null), [width, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, [points.length > 0]);
  const narrow = width < 480;
  const height = narrow ? 220 : 260, left = narrow ? 48 : 64, right = width - 12, top = 14, bottom = height - 40;
  const { xMin, xMax, yMin, yMax } = plotDomain(points);
  const px = (x: number) => left + (x - xMin) / (xMax - xMin) * (right - left);
  const py = (y: number) => bottom - (y - yMin) / (yMax - yMin) * (bottom - top);
  const nearest = (x: number) => points.reduce((best, p, n) => Math.abs(p.x - x) < Math.abs(points[best].x - x) ? n : best, 0);
  const fallback = points.length ? (initialX == null ? points.length - 1 : nearest(initialX)) : 0;
  const index = selected == null ? fallback : Math.min(selected, points.length - 1);
  const active = points[index];
  const tick = xFormat ?? ((x: number) => String(x));
  const xTicks = axisTicks(xMin, points.length ? points.at(-1)!.x : xMax, Math.max(2, Math.min(5, Math.floor((right - left) / 120))));
  function selectAt(clientX: number, target: SVGSVGElement) {
    const bounds = target.getBoundingClientRect();
    const x = xMin + ((clientX - bounds.left) / bounds.width * width - left) / (right - left) * (xMax - xMin);
    setSelected(nearest(x));
  }
  const path = (n: number) => points.map((p, k) => k === 0 ? `M${px(p.x)} ${py(p.values[n])}` : stepped ? `H${px(p.x)}V${py(p.values[n])}` : `L${px(p.x)} ${py(p.values[n])}`).join(" ");
  return <figure className="chart-panel" aria-labelledby={`${id}-title`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 id={`${id}-title`} className="font-semibold text-slate-100">{title}</h3><p className="mt-1 text-xs leading-relaxed text-fg-subtle">{description}</p></div><span className="desk-badge">{badge ?? (stepped ? "Recorded" : "Hypothetical")}</span></div>
    {!points.length ? <div className="mt-4 flex min-h-56 items-center justify-center rounded-lg border border-dashed border-ink-600 p-6 text-center text-sm text-fg-subtle">{emptyText}</div> : <>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs" aria-live="polite">{series.map((name, n) => <span key={name} className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: colors[n % colors.length] }} />{name} <strong className="font-mono tabular-nums text-slate-100">{valueFormat(active.values[n])}</strong></span>)}<span className="text-fg-subtle">{xFormat ? xFormat(active.x) : active.label}</span></div>
      <div ref={box} className="mt-2 w-full">
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} className="block touch-pan-y select-none rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400" role="group" aria-label={`${title}. Use left and right arrow keys to inspect points.`} tabIndex={0}
          onPointerMove={e => selectAt(e.clientX, e.currentTarget)} onPointerDown={e => selectAt(e.clientX, e.currentTarget)}
          onKeyDown={e => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); setSelected(e.key === "Home" ? 0 : e.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, index + (e.key === "ArrowLeft" ? -1 : 1)))); } }}>
          <title>{title}</title>
          {niceTicks(yMin, yMax, narrow ? 3 : 5).map(y => <g key={y}><line x1={left} x2={right} y1={py(y)} y2={py(y)} stroke="rgb(var(--ink-700))" /><text x={left - 8} y={py(y) + 4} textAnchor="end" className="chart-axis">{compactMoney(y)}</text></g>)}
          {seriesStyle.map((style, n) => style === "area" && <path key={`area-${n}`} d={`${path(n)} V${py(0)} H${px(points[0].x)} Z`} fill={colors[n % colors.length]} opacity=".14" />)}
          <line x1={left} x2={right} y1={py(0)} y2={py(0)} stroke="rgb(var(--fg-subtle))" strokeDasharray="4 4" opacity=".6" />
          {markers.filter(m => m.x >= xMin && m.x <= xMax).map(m => <line key={m.label} x1={px(m.x)} x2={px(m.x)} y1={top} y2={bottom} stroke="rgb(var(--amber-400))" strokeDasharray="2 3" opacity=".75" />)}
          {series.map((name, n) => n).sort((a, b) => Number(seriesStyle[b] === "area") - Number(seriesStyle[a] === "area")).map(n => <path key={series[n]} d={path(n)} fill="none" stroke={colors[n % colors.length]} strokeWidth={seriesStyle[n] === "area" ? 1.5 : 2.5} strokeLinejoin="round" />)}
          <line x1={px(active.x)} x2={px(active.x)} y1={top} y2={bottom} stroke="rgb(var(--fg-subtle))" strokeDasharray="3 4" />
          {series.map((name, n) => <circle key={name} cx={px(active.x)} cy={py(active.values[n])} r="4" fill={colors[n % colors.length]} stroke="rgb(var(--ink-900))" strokeWidth="2" />)}
          {xTicks.map((x, n) => <text key={n} x={px(x)} y={bottom + 18} textAnchor={n === 0 ? "start" : n === xTicks.length - 1 ? "end" : "middle"} className="chart-axis">{tick(x)}</text>)}
          <text x={(left + right) / 2} y={height - 4} textAnchor="middle" className="chart-axis">{xLabel}</text>
        </svg>
      </div>
      {markers.length > 0 && <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-subtle"><span className="inline-block h-3 border-l border-dashed border-amber-400" aria-hidden="true" />{markers.map(m => <span key={m.label}>{m.label} <span className="font-mono text-slate-300">{tick(m.x)}</span></span>)}</p>}
      <figcaption className="mt-1 text-xs text-fg-subtle">Hover, drag or tap the chart, or focus it and use the arrow keys. Dashed horizontal line = $0.</figcaption>
      <details className="mt-3 text-xs"><summary className="cursor-pointer text-slate-300">View chart data</summary><div className="mt-2 max-h-56 overflow-auto"><table className="w-full text-left tabular-nums"><caption className="sr-only">{title} exact values</caption><thead><tr><th scope="col" className="py-2">{xLabel}</th>{series.map(s => <th scope="col" key={s}>{s}</th>)}</tr></thead><tbody>{points.map((p,n) => <tr key={n} className="border-t border-ink-700"><th scope="row" className="py-2 font-normal">{p.label}</th>{p.values.map((v,k) => <td key={k}>{valueFormat(v)}</td>)}</tr>)}</tbody></table></div></details>
    </>}
  </figure>;
}
