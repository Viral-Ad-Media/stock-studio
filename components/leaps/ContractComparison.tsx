"use client";

import type { ChainOption } from "@/lib/leaps-chain";
import { contractMetrics } from "@/lib/leaps-discovery";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
const known = (
  n: number | null | undefined,
  format: (n: number) => string = String,
) => (n == null || !Number.isFinite(n) ? "Unavailable" : format(n));

export default function ContractComparison({
  options,
  contracts,
  fees,
  visibleSymbols,
  onRemove,
  onClear,
  onUse,
}: {
  options: ChainOption[];
  contracts: number;
  fees: number;
  visibleSymbols: Set<string>;
  onRemove: (symbol: string) => void;
  onClear: () => void;
  onUse: (option: ChainOption) => void;
}) {
  if (!options.length)
    return (
      <p className="mt-4 rounded-lg border border-dashed border-ink-600 p-4 text-sm text-fg-subtle">
        Select up to three contracts in the results to compare expirations,
        liquidity and ask-based costs side by side.
      </p>
    );
  const metrics = options.map((o) => contractMetrics(o, contracts, fees));
  const validLot = metrics.some((m) => m.totalCost != null);
  const rows: { label: string; values: string[] }[] = [
    { label: "Days to expiration", values: options.map((o) => String(o.days)) },
    {
      label: "Bid / ask per share",
      values: options.map(
        (o) => `${known(o.bid, money)} / ${known(o.ask, money)}`,
      ),
    },
    {
      label: "Quoted spread",
      values: metrics.map((m) => known(m.spread, money)),
    },
    {
      label: "Spread / midpoint",
      values: metrics.map((m) => known(m.spreadPct, (n) => `${n.toFixed(2)}%`)),
    },
    {
      label: "Provider delta",
      values: options.map((o) => known(o.delta, (n) => n.toFixed(3))),
    },
    {
      label: "Implied volatility",
      values: options.map((o) => known(o.iv, (n) => `${n.toFixed(1)}%`)),
    },
    {
      label: "Volume / open interest",
      values: options.map(
        (o) => `${known(o.volume)} / ${known(o.openInterest)}`,
      ),
    },
    {
      label: "Ask-based premium for lot",
      values: metrics.map((m) => known(m.premiumCost, money)),
    },
    {
      label: "Assumed total fees",
      values: options.map(() =>
        Number.isFinite(fees) && fees >= 0 ? money(fees) : "Enter valid fees",
      ),
    },
    {
      label: "Ask-based cost including fees",
      values: metrics.map((m) => known(m.totalCost, money)),
    },
    {
      label: "Expiration breakeven including fees",
      values: metrics.map((m) =>
        known(m.breakeven, (n) =>
          n < 0 ? `${money(n)} (unattainable)` : money(n),
        ),
      ),
    },
  ];
  return (
    <section
      aria-labelledby="contract-comparison-heading"
      className="mt-5 rounded-xl border border-ink-600 bg-ink-950/40 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="desk-eyebrow">Your shortlist · {options.length}/3</p>
          <h3
            id="contract-comparison-heading"
            className="font-semibold text-slate-100"
          >
            Compare selected contracts
          </h3>
        </div>
        <button
          type="button"
          className="btn-secondary px-3 py-2 text-xs"
          onClick={onClear}
        >
          Clear comparison
        </button>
      </div>
      <p className="my-3 text-xs leading-relaxed text-fg-subtle">
        One delayed chain snapshot. Costs use{" "}
        {Number.isInteger(contracts) && contracts > 0
          ? contracts
          : "your entered number of"}{" "}
        standard 100-share contracts and your assumed total fees. Expiration
        breakeven uses the quoted ask; it is not an early-exit breakeven or a
        fill. Selection stays visible when filters change and clears when a
        chain is reloaded.
      </p>
      {!validLot && (
        <p role="status" className="mb-3 text-xs text-amber-300">
          Costs need a positive ask, a valid whole contract count and
          nonnegative fees. Missing or crossed quotes are not replaced.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[540px] text-left text-sm tabular-nums">
          <caption className="sr-only">
            Selected delayed contracts and quoted liquidity; no recommendation
            ranking
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="w-48 py-3 pr-4 font-medium text-fg-subtle"
              >
                Contract details
              </th>
              {options.map((o) => (
                <th
                  key={o.symbol}
                  scope="col"
                  className="min-w-48 px-3 py-3 align-top"
                >
                  <span className="block font-mono">
                    {money(o.strike)} {o.type}
                  </span>
                  <span className="block text-xs font-normal text-fg-subtle">
                    {o.expiration}
                  </span>
                  <span className="mt-1 block break-all text-[10px] font-normal text-fg-subtle">
                    {o.symbol}
                  </span>
                  {!visibleSymbols.has(o.symbol) && (
                    <span className="mt-1 block text-xs font-normal text-amber-300">
                      Outside current filters / option type
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${o.symbol} from comparison`}
                    className="mt-2 text-xs font-normal text-emerald-400 underline"
                    onClick={() => onRemove(o.symbol)}
                  >
                    Remove
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-ink-700">
                <th
                  scope="row"
                  className="py-3 pr-4 text-xs font-medium text-fg-subtle"
                >
                  {row.label}
                </th>
                {row.values.map((v, n) => (
                  <td
                    key={options[n].symbol}
                    className="px-3 py-3 font-mono text-xs"
                  >
                    {v}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-ink-700">
              <th
                scope="row"
                className="py-3 pr-4 text-xs font-medium text-fg-subtle"
              >
                Explore assumptions
              </th>
              {options.map((o) => (
                <td key={o.symbol} className="px-3 py-3">
                  <button
                    type="button"
                    className="btn-secondary px-3 py-2 text-xs"
                    onClick={() => onUse(o)}
                    aria-label={`Model ${o.symbol}`}
                  >
                    Model this contract
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-fg-subtle">
        These are comparisons, not recommended contracts. Quotes can be stale or
        unavailable. A zero bid does not establish sell-side liquidity. Moving a
        contract to the model records no trade.
      </p>
    </section>
  );
}
