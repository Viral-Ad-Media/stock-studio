// Token usage and estimated spend for one job attempt. Every model call made
// for a job adds its `usage` here; the worker writes the totals to
// jobs.usage_json / jobs.cost_usd after the attempt, whether it succeeded or
// not. Costs are estimates at list price — the Anthropic Console is the bill.

// USD per million tokens, and per web search. Cache writes use the 5-minute
// TTL (1.25x input); cache reads are 0.1x input.
type Price = { input: number; output: number; cacheWrite: number; cacheRead: number; perSearch: number };

const PRICES: Record<string, Price> = {
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2, perSearch: 0.01 },
};

export type UsageTotals = {
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  web_search_requests: number;
};

// The subset of the API's `usage` object we read (all fields nullable there).
type ApiUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
};

export class UsageMeter {
  readonly totals: UsageTotals;

  constructor(model: string) {
    this.totals = {
      model,
      calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      web_search_requests: 0,
    };
  }

  add(u: ApiUsage) {
    const t = this.totals;
    t.calls += 1;
    t.input_tokens += u.input_tokens ?? 0;
    t.output_tokens += u.output_tokens ?? 0;
    t.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
    t.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
    t.web_search_requests += u.server_tool_use?.web_search_requests ?? 0;
  }

  // Unknown model → null rather than a wrong number.
  costUsd(): number | null {
    const p = PRICES[this.totals.model];
    if (!p) return null;
    const t = this.totals;
    return (
      (t.input_tokens * p.input +
        t.output_tokens * p.output +
        t.cache_creation_input_tokens * p.cacheWrite +
        t.cache_read_input_tokens * p.cacheRead) /
        1_000_000 +
      t.web_search_requests * p.perSearch
    );
  }
}

// "$0.042" under a dollar, "$3.18" above — sub-cent precision matters here.
export function formatCost(usd: number | string | null | undefined): string {
  if (usd == null) return "—";
  const n = Number(usd);
  if (!Number.isFinite(n)) return "—";
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}
