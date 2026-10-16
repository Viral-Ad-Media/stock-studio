import type { ChainOption } from "./leaps-chain";
export type DiscoveryFilters = {
  minDays: string;
  maxDays: string;
  minDelta: string;
  maxDelta: string;
  maxSpread: string;
  minVolume: string;
  minOi: string;
  budget: string;
  contracts: string;
  fees: string;
};
export const DEFAULT_FILTERS: DiscoveryFilters = {
  minDays: "365",
  maxDays: "1460",
  minDelta: "",
  maxDelta: "",
  maxSpread: "",
  minVolume: "",
  minOi: "",
  budget: "",
  contracts: "1",
  fees: "0",
};
export const FILTER_LABELS: Record<keyof DiscoveryFilters, string> = {
  minDays: "Minimum days to expiry",
  maxDays: "Maximum days to expiry",
  minDelta: "Minimum absolute delta",
  maxDelta: "Maximum absolute delta",
  maxSpread: "Maximum spread / midpoint (%)",
  minVolume: "Minimum volume",
  minOi: "Minimum open interest",
  budget: "Maximum ask-based cost including fees ($)",
  contracts: "Contracts for budget",
  fees: "Assumed total entry + exit fees ($)",
};
export function filterContracts(
  options: ChainOption[],
  filters: DiscoveryFilters,
) {
  const f = Object.fromEntries(
    Object.entries(filters).map(([k, v]) => [
      k,
      v.trim() === "" ? null : Number(v),
    ]),
  ) as Record<keyof DiscoveryFilters, number | null>;
  for (const k of Object.keys(filters) as (keyof DiscoveryFilters)[])
    if (f[k] != null && (!Number.isFinite(f[k]) || f[k]! < 0))
      return {
        error: `${FILTER_LABELS[k]} must be a nonnegative number.`,
        rows: [] as ChainOption[],
      };
  if (
    (f.contracts ?? 0) < 1 ||
    !Number.isInteger(f.contracts) ||
    f.contracts! > 10000
  )
    return {
      error: "Budget contracts must be a whole number from 1 to 10,000.",
      rows: [] as ChainOption[],
    };
  if (
    (f.minDelta != null && f.minDelta > 1) ||
    (f.maxDelta != null && f.maxDelta > 1)
  )
    return {
      error: "Absolute delta must be between 0 and 1.",
      rows: [] as ChainOption[],
    };
  if (
    (f.minDays != null && f.maxDays != null && f.minDays > f.maxDays) ||
    (f.minDelta != null && f.maxDelta != null && f.minDelta > f.maxDelta)
  )
    return {
      error: "Minimum must not exceed maximum.",
      rows: [] as ChainOption[],
    };
  const min = (v: number | null | undefined, b: number | null) =>
    b == null || (v != null && v >= b);
  const max = (v: number | null | undefined, b: number | null) =>
    b == null || (v != null && v <= b);
  return {
    error: "",
    rows: options.filter((o) => {
      const quote = contractMetrics(o, f.contracts!, f.fees ?? 0);
      return (
        min(o.days, f.minDays) &&
        max(o.days, f.maxDays) &&
        min(o.delta == null ? null : Math.abs(o.delta), f.minDelta) &&
        max(o.delta == null ? null : Math.abs(o.delta), f.maxDelta) &&
        max(quote.spreadPct, f.maxSpread) &&
        min(o.volume, f.minVolume) &&
        min(o.openInterest, f.minOi) &&
        max(quote.totalCost, f.budget)
      );
    }),
  };
}

const nonnegative = (n: number | null | undefined) =>
  n != null && Number.isFinite(n) && n >= 0 ? n : null;

// Quoted comparisons only: no midpoint fill or theoretical price is substituted.
export function contractMetrics(
  option: ChainOption,
  contracts: number,
  fees: number,
) {
  const bid = nonnegative(option.bid),
    ask = nonnegative(option.ask);
  const crossed = bid != null && ask != null && ask < bid;
  const spread = bid != null && ask != null && !crossed ? ask - bid : null;
  const mid = bid != null && ask != null && !crossed ? (bid + ask) / 2 : null;
  const validLot =
    Number.isInteger(contracts) &&
    contracts >= 1 &&
    contracts <= 10000 &&
    Number.isFinite(fees) &&
    fees >= 0;
  const quotedCost =
    validLot && ask != null && ask > 0 && !crossed
      ? ask * 100 * contracts
      : null;
  const premiumCost =
    quotedCost != null && Number.isFinite(quotedCost) ? quotedCost : null;
  const totalCost =
    premiumCost != null && Number.isFinite(premiumCost + fees)
      ? premiumCost + fees
      : null;
  const breakeven =
    totalCost == null
      ? null
      : option.strike +
        ((option.type === "call" ? 1 : -1) * totalCost) / (100 * contracts);
  return {
    spread,
    spreadPct:
      spread != null && mid != null && mid > 0 ? (spread / mid) * 100 : null,
    premiumCost,
    totalCost,
    breakeven,
  };
}

export const CONTRACT_SORTS = {
  expiration: "Expiration, then strike",
  cost: "Ask-based cost: low to high",
  spread: "Quoted spread %: low to high",
  delta: "Absolute delta: high to low",
  openInterest: "Open interest: high to low",
} as const;
export type ContractSort = keyof typeof CONTRACT_SORTS;

export function sortContracts(
  options: ChainOption[],
  sort: ContractSort,
  contracts: number,
  fees: number,
) {
  const value = (o: ChainOption) => {
    const m = contractMetrics(o, contracts, fees);
    if (sort === "cost") return m.totalCost;
    if (sort === "spread") return m.spreadPct;
    if (sort === "delta")
      return o.delta != null &&
        Number.isFinite(o.delta) &&
        Math.abs(o.delta) <= 1
        ? Math.abs(o.delta)
        : null;
    return nonnegative(o.openInterest);
  };
  return [...options].sort((a, b) => {
    if (sort !== "expiration") {
      const x = value(a),
        y = value(b);
      if (x == null && y != null) return 1;
      if (x != null && y == null) return -1;
      if (x != null && y != null && x !== y)
        return (sort === "delta" || sort === "openInterest" ? -1 : 1) * (x - y);
    }
    return (
      a.expiration.localeCompare(b.expiration) ||
      a.strike - b.strike ||
      a.symbol.localeCompare(b.symbol)
    );
  });
}
