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
};
export const FILTER_LABELS: Record<keyof DiscoveryFilters, string> = {
  minDays: "Minimum days to expiry",
  maxDays: "Maximum days to expiry",
  minDelta: "Minimum absolute delta",
  maxDelta: "Maximum absolute delta",
  maxSpread: "Maximum spread / midpoint (%)",
  minVolume: "Minimum volume",
  minOi: "Minimum open interest",
  budget: "Maximum ask-based premium budget ($)",
  contracts: "Contracts for budget",
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
      const mid = o.ask != null && o.bid != null ? (o.ask + o.bid) / 2 : null;
      const spread =
        mid && o.ask != null && o.bid != null
          ? (100 * (o.ask - o.bid)) / mid
          : null;
      return (
        min(o.days, f.minDays) &&
        max(o.days, f.maxDays) &&
        min(o.delta == null ? null : Math.abs(o.delta), f.minDelta) &&
        max(o.delta == null ? null : Math.abs(o.delta), f.maxDelta) &&
        max(spread, f.maxSpread) &&
        min(o.volume, f.minVolume) &&
        min(o.openInterest, f.minOi) &&
        max(
          o.ask != null && o.ask > 0 ? o.ask * 100 * f.contracts! : null,
          f.budget,
        )
      );
    }),
  };
}
