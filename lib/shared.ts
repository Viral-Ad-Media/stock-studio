// Types and constants shared with client components — must stay free of Node/DB imports.

export type CaseStudy = {
  id: number;
  ticker: string;
  company: string | null;
  variant: string;
  status: "queued" | "building" | "ready" | "error";
  notes: string | null;
  as_of_date: string | null;
  content_md: string | null;
  // JSONB column — the Postgres driver returns it already parsed.
  sources_json: { title: string; url: string }[] | null;
  corrections_md: string | null;
  error: string | null;
  parent_id: number | null;
  // Research-quality grade (lib/grades.ts StudyGrade) and a one-line summary.
  grade_json: unknown | null;
  summary_line: string | null;
  created_at: string;
  updated_at: string;
};

export type Job = {
  id: number;
  type: "build_case_study" | "earnings_update" | "watchlist_entry" | "movers_digest";
  payload: Record<string, unknown>;
  status: "pending" | "running" | "done" | "error";
  result: string | null;
  created_at: string;
  updated_at: string;
};

export type WatchlistRow = {
  id: number;
  ticker: string;
  company: string | null;
  status_tag: "watching" | "building_conviction" | "pass";
  thesis: string | null;
  // JSONB column — the Postgres driver returns it already parsed.
  triggers_json: string[] | null;
  snapshot: string | null;
  as_of_date: string | null;
  case_study_id: number | null;
  thesis_status: "intact" | "weakening" | "broken" | "unknown";
  thesis_status_note: string | null;
  created_at: string;
  updated_at: string;
};

export const VARIANTS: { value: string; label: string; hint: string }[] = [
  { value: "full", label: "Full 4-card study", hint: "Growth, profitability, valuation, moat + bear case" },
  { value: "quick_take", label: "Quick take", hint: "1-2 sentence verdict + one condensed card" },
  { value: "carousel", label: "Social carousel", hint: "Tight copy sized for IG/TikTok/LinkedIn slides" },
  { value: "memo", label: "Deep research memo", hint: "Source table, bear/base/bull, valuation sensitivity" },
  { value: "newsletter", label: "Newsletter section", hint: "Paragraphs, subheads, narrative arc" },
  { value: "script", label: "Video script", hint: "Voiceover lines + on-screen text per card" },
  { value: "comparison", label: "Comparison", hint: "Two or more tickers, side by side" },
  { value: "one_candle", label: "One-candle setup check", hint: "Opening 5-min range → FVG → retest → engulfing checklist (intraday, educational)" },
  { value: "davinci_model", label: "Da Vinci liquidity model check", hint: "Engineered-liquidity sweep → reaction → retest → entry, as taught in a specific trader interview (educational)" },
  { value: "earnings_update", label: "Earnings reaction", hint: "Post-earnings delta vs. the prior study" },
  { value: "movers_digest", label: "Market movers digest", hint: "Today's top gainers & losers with a short story on each" },
];

// Variants that aren't per-ticker studies and shouldn't appear in the New-study form.
export const HIDDEN_FORM_VARIANTS = ["earnings_update", "movers_digest"];

// Max length of a study's user notes — enforced by lib/validate.ts, shown by /new.
export const MAX_NOTES = 8_000;

// Credits charged per queued report (1 credit ≈ $1). Single source of truth for
// both what's charged (lib/billing.ts) and what's shown (/pricing, /new).
export const CREDIT_COSTS: Record<string, number> = {
  quick_take: 2,
  full: 5,
  carousel: 5,
  newsletter: 5,
  script: 5,
  memo: 8,
  comparison: 3,
  watchlist_entry: 3,
  earnings_update: 3,
  movers_digest: 3,
  one_candle: 2,
  davinci_model: 2,
};
const DEFAULT_CREDIT_COST = 5;

export function creditCost(variant: string): number {
  return CREDIT_COSTS[variant] ?? DEFAULT_CREDIT_COST;
}

// "Sep 24, 2026". postgres.js returns timestamptz as Date objects, so never
// String(date).slice(...) them (that renders "Thu Sep 24" with no year).
export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  building: "Building",
  ready: "Ready",
  error: "Failed",
};

// Reads a JSON { error } from a failed API response, with a fallback.
export async function apiError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return (body && typeof body.error === "string" && body.error) || fallback;
}
