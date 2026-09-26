// Research-quality grades for case studies (adapted from QuantEdgeResearch's
// composite letter grade). The engine scores the four study cards from the
// study it just wrote; the overall letter is computed here, deterministically,
// so the model never "picks a grade". It grades the *business as the study
// describes it* — never a buy/sell rating. Client-safe: no Node/DB imports.

export const GRADE_COMPONENTS = [
  { key: "growth", label: "Growth", hint: "Revenue/earnings trajectory, verified quarter over quarter" },
  { key: "profitability", label: "Profitability", hint: "Margins, cash generation, balance-sheet strength" },
  { key: "valuation", label: "Valuation", hint: "Higher = more reasonable price for the fundamentals shown" },
  { key: "moat", label: "Moat", hint: "Durability of the competitive advantage, net of the bear case" },
] as const;

export type GradeComponentKey = (typeof GRADE_COMPONENTS)[number]["key"];
export type GradeComponent = { key: GradeComponentKey; label: string; score: number; note: string | null };
export type StudyGrade = { overall: string; score: number; components: GradeComponent[] };

// Fundamental variants only — setups (one_candle, davinci_model), digests and
// comparisons aren't a single business to grade.
export const GRADED_VARIANTS = new Set(["full", "quick_take", "memo", "newsletter", "script", "carousel", "earnings_update"]);

export const GRADE_DISCLAIMER =
  "Research-quality score: how the business scores on this study's four cards, from the verified facts in it. Not a buy, sell, or price-target rating.";

const LETTERS: [number, string][] = [
  [93, "A"], [90, "A-"], [87, "B+"], [83, "B"], [80, "B-"], [77, "C+"],
  [73, "C"], [70, "C-"], [67, "D+"], [63, "D"], [60, "D-"],
];

export function scoreToLetter(score: number): string {
  for (const [min, letter] of LETTERS) if (score >= min) return letter;
  return "F";
}

// Accepts the model's / manual engine's raw component scores
// ({ growth: { score, note }, ... }) and returns a validated grade, or null if
// any card is missing or out of range — a partial grade would mislead.
export function computeGrade(raw: unknown): StudyGrade | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const components: GradeComponent[] = [];
  for (const c of GRADE_COMPONENTS) {
    const v = input[c.key] as { score?: unknown; note?: unknown } | number | undefined;
    const score = typeof v === "number" ? v : Number((v as { score?: unknown } | undefined)?.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) return null;
    const note = typeof v === "object" && typeof v?.note === "string" ? v.note.trim().slice(0, 240) || null : null;
    components.push({ key: c.key, label: c.label, score: Math.round(score), note });
  }
  const score = Math.round(components.reduce((s, c) => s + c.score, 0) / components.length);
  return { overall: scoreToLetter(score), score, components };
}

// Stored rows came from computeGrade, but JSONB is JSONB — re-check shape
// before rendering.
export function parseStoredGrade(v: unknown): StudyGrade | null {
  if (!v || typeof v !== "object") return null;
  const g = v as StudyGrade;
  if (typeof g.overall !== "string" || !Number.isFinite(g.score) || !Array.isArray(g.components)) return null;
  return g;
}

export const SUMMARY_LINE_MAX = 220;

export function cleanSummaryLine(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, SUMMARY_LINE_MAX) : null;
}

export const THESIS_STATUSES = ["intact", "weakening", "broken", "unknown"] as const;
export type ThesisStatus = (typeof THESIS_STATUSES)[number];

export function parseThesisStatus(v: unknown): ThesisStatus | null {
  return (THESIS_STATUSES as readonly string[]).includes(String(v)) ? (v as ThesisStatus) : null;
}
