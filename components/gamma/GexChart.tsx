"use client";

import { useState } from "react";
import type { GexStrike } from "@/lib/gex";

// Diverging polarity: one hue per sign around a zero baseline. Validated
// (dataviz validate_palette.js, dark surface #0f1420): sky-600 / orange-600.
const POS = "#0284c7";
const NEG = "#ea580c";

function money(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : `$${Math.round(a / 1e3)}K`;
  return `${n < 0 ? "−" : "+"}${s}`;
}

// `bucketed`: each row merges several strikes (lib/gex.ts bucketStrikes), so
// its label is a midpoint, not a listed strike.
type Props = { strikes: GexStrike[]; spot: number; zeroGamma: number | null; symbol: string; bucketed?: boolean };

export default function GexChart({ strikes, spot, zeroGamma, symbol, bucketed = false }: Props) {
  const [active, setActive] = useState<number | null>(null);
  // Highest strike on top, like a price axis.
  const rows = [...strikes].sort((a, b) => b.strike - a.strike);
  const max = Math.max(...rows.map((r) => Math.abs(r.net)), 1);
  const cur = active != null ? rows[active] : null;

  // Index of the first row at or below a price (markers sit above that row).
  const markerIndex = (price: number) => {
    const i = rows.findIndex((r) => r.strike <= price);
    return i === -1 ? rows.length : i;
  };
  const spotAt = markerIndex(spot);
  const zeroAt = zeroGamma != null ? markerIndex(zeroGamma) : -1;

  return (
    <figure className="card p-4">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-100">Net gamma by strike · {symbol}</span>
        <span className="flex flex-wrap items-center gap-3 text-xs text-slate-300" aria-hidden>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: POS }} /> Positive (calls dominate)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: NEG }} /> Negative (puts dominate)
          </span>
        </span>
      </figcaption>

      <p className="mb-2 min-h-[1.25rem] text-xs text-slate-300" aria-live="polite">
        {cur
          ? `${bucketed ? `Strikes around $${cur.strike}` : `$${cur.strike} strike`}: net ${money(cur.net)} per 1% move (calls ${money(cur.call)}, puts ${money(cur.put)})`
          : "Hover or focus a bar for its values."}
      </p>

      <div role="list" aria-label={`Net gamma exposure by strike for ${symbol}`} className="relative" onMouseLeave={() => setActive(null)}>
        {rows.map((r, i) => {
          const w = (Math.abs(r.net) / max) * 50;
          return (
            <div key={r.strike}>
              {i === spotAt && <Marker label={`Price $${spot.toFixed(2)}`} tone="text-slate-100 border-slate-300" />}
              {i === zeroAt && zeroAt !== spotAt && <Marker label={`Zero gamma ≈ $${zeroGamma!.toFixed(2)}`} tone="text-fg-subtle border-dashed border-ink-500" />}
              <div
                role="listitem"
                tabIndex={0}
                aria-label={`$${r.strike}: net ${money(r.net)}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className={`grid grid-cols-[4.5rem_1fr] items-center gap-2 rounded py-[3px] outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                  active === i ? "bg-ink-800" : ""
                }`}
              >
                <span className="text-right text-[11px] tabular-nums text-fg-subtle">{r.strike}</span>
                <span className="relative block h-3">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-ink-600" aria-hidden />
                  <span
                    aria-hidden
                    className="absolute inset-y-0"
                    style={{
                      background: r.net >= 0 ? POS : NEG,
                      width: `${w}%`,
                      left: r.net >= 0 ? "50%" : `${50 - w}%`,
                      borderRadius: r.net >= 0 ? "0 4px 4px 0" : "4px 0 0 4px",
                    }}
                  />
                </span>
              </div>
            </div>
          );
        })}
        {spotAt === rows.length && <Marker label={`Price $${spot.toFixed(2)}`} tone="text-slate-100 border-slate-300" />}
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-fg-subtle">Show as a table</summary>
        <div className="mt-2 max-h-80 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-fg-subtle">
                <th scope="col" className="py-1 pr-2 font-medium">Strike</th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">Calls</th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">Puts</th>
                <th scope="col" className="py-1 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="tabular-nums text-slate-300">
              {rows.map((r) => (
                <tr key={r.strike} className="border-t border-ink-800">
                  <th scope="row" className="py-1 pr-2 text-left font-normal">{r.strike}</th>
                  <td className="py-1 pr-2 text-right">{money(r.call)}</td>
                  <td className="py-1 pr-2 text-right">{money(r.put)}</td>
                  <td className="py-1 text-right">{money(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function Marker({ label, tone }: { label: string; tone: string }) {
  return (
    <div className={`my-0.5 flex items-center gap-2 border-t pt-0.5 text-[11px] ${tone}`} role="presentation">
      <span className="pl-1">{label}</span>
    </div>
  );
}
