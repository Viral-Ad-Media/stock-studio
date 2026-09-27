import type { Effort } from "./anthropic";

// Web searches allowed per report, by format. Each search is $0.01 plus the
// tokens of what it returns, and every later step re-reads those results, so
// this is the main lever on research cost.
const SEARCH_BUDGET: Record<string, number> = {
  quick_take: 5,
  script: 5,
  watchlist_entry: 6,
  carousel: 8,
  newsletter: 8,
  earnings_update: 8,
  full: 10,
  comparison: 10,
  movers_digest: 12, // ten movers, one quick check each
  memo: 15,
};
const DEFAULT_SEARCH_BUDGET = 10;

export function searchBudget(format: string): number {
  return SEARCH_BUDGET[format] ?? DEFAULT_SEARCH_BUDGET;
}

// Short formats run at a lower effort (less thinking, fewer output tokens).
// ENGINE_SHORT_FORMAT_EFFORT=high restores the model default if their
// quality drops; everything else always runs at the default ("high").
const SHORT_FORMATS = new Set(["quick_take", "script", "watchlist_entry"]);

export function effortFor(format: string): Effort | undefined {
  if (!SHORT_FORMATS.has(format)) return undefined;
  const e = process.env.ENGINE_SHORT_FORMAT_EFFORT ?? "medium";
  return e === "low" || e === "medium" || e === "high" ? e : "medium";
}
