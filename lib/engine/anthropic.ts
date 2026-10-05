import Anthropic from "@anthropic-ai/sdk";
import type { UsageMeter } from "./usage";

// Automated-worker Anthropic client. Pattern reused from agentor-ai:
// maxRetries: 0 because the worker's own per-job `attempts` counter
// (lib/engine/worker.ts) is the single counted retry mechanism, and every call
// carries a per-request timeout derived from the invocation's deadline, so a
// slow call fails loudly inside try/catch instead of being killed by the host
// mid-job (which strands the job in `running` until the stale-lock window).

export const ENGINE_MODEL = "claude-sonnet-5";

// Single-call ceiling; the deadline usually binds first. Raise it with the
// invocation budget on hosts without a function time limit (e.g. Render).
const MAX_CALL_MS = Number(process.env.ENGINE_MAX_CALL_MS ?? 170_000);
// Headroom kept after a call for the DB write-back.
const WRITE_BACK_MS = 5_000;
// Extraction is a small structured call — never give it more than this.
const EXTRACT_CALL_MS = 30_000;
// Reserved for the extraction call when sizing the main research/write call.
export const EXTRACT_RESERVE_MS = EXTRACT_CALL_MS + WRITE_BACK_MS;
// A server-tool (web search) turn can pause; resume at most this many times.
const MAX_CONTINUATIONS = 4;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new EngineUnavailableError("ANTHROPIC_API_KEY is not set");
  _client = new Anthropic({ apiKey, maxRetries: 0 });
  return _client;
}

// Thrown for failures a retry can't fix (refusal, output over the length
// limit, bad input). The worker fails the job immediately and refunds.
export class PermanentJobError extends Error {}

// Our own API account can't serve any job right now: no key, a revoked key,
// an empty credit balance, an unknown model, or rate-limited / overloaded.
// None of that is the job's fault, so the worker puts the job back in the
// queue without spending an attempt and stops the invocation, instead of
// failing (and refunding) every queued report until the account is fixed.
export class EngineUnavailableError extends Error {}

export function isEngineUnavailable(err: unknown): boolean {
  if (err instanceof EngineUnavailableError) return true;
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError ||
    err instanceof Anthropic.NotFoundError ||
    err instanceof Anthropic.RateLimitError
  ) {
    return true;
  }
  if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) return true;
  if (err instanceof Anthropic.APIError && err.status === 529) return true; // overloaded
  return false;
}

// Bad-request errors and our own permanent errors stop the job immediately
// rather than burning the attempts ceiling. Account-level failures are
// checked first (isEngineUnavailable) and never land here.
export function isPermanentAnthropicFailure(err: unknown): boolean {
  if (err instanceof PermanentJobError) return true;
  return err instanceof Anthropic.BadRequestError;
}

// Time left for one call: bounded by the invocation deadline minus what the
// caller still needs afterwards. Too little left → a retryable error, so the
// job goes back to pending for the next invocation instead of being killed.
function callTimeout(deadline: number, reserveAfterMs: number, capMs: number): number {
  const ms = Math.min(capMs, deadline - Date.now() - reserveAfterMs);
  if (ms < 15_000) throw new Error("Not enough time left in this worker invocation — will retry");
  return ms;
}

// Only a natural end is a publishable study. A length cut-off would drop the
// required closing disclaimer; a refusal has no study at all.
function assertComplete(msg: Anthropic.Message) {
  if (msg.stop_reason === "end_turn") return;
  if (msg.stop_reason === "refusal") {
    throw new PermanentJobError("The model declined to write this report");
  }
  if (msg.stop_reason === "max_tokens") {
    throw new PermanentJobError("The report hit the output length limit before it was finished");
  }
  throw new Error(`Unexpected stop_reason: ${msg.stop_reason}`);
}

// The study is the text after the model's last tool activity — anything
// before it ("Let me search for…") is working narration, not the report.
function finalText(msg: Anthropic.Message): string {
  let lastNonText = -1;
  msg.content.forEach((b, i) => {
    if (b.type !== "text" && b.type !== "thinking" && b.type !== "redacted_thinking") lastNonText = i;
  });
  const text = msg.content
    .slice(lastNonText + 1)
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) {
    throw new Error(`Model produced no final text (stop_reason: ${msg.stop_reason})`);
  }
  return text.trim();
}

export type ResearchResult = {
  text: string;
  sources: { title: string; url: string }[];
  usage: { input_tokens: number; output_tokens: number };
};

// The methodology system prompt is identical for every job, so it's cached:
// repeat reads (continuations, and other jobs within 5 minutes) cost 0.1x.
function cachedSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

export type Effort = "low" | "medium" | "high";

// Research call with Anthropic's hosted web_search tool. The model searches
// server-side; a `pause_turn` (server tool loop hit its iteration limit) is
// resumed by re-sending the conversation with the paused assistant turn.
// `maxSearches` caps web searches across the whole call, continuations
// included (the API's max_uses is per request, so it's re-derived each time).
export async function researchWithWebSearch(opts: {
  system: string;
  prompt: string;
  deadline: number;
  maxSearches: number;
  effort?: Effort;
  meter?: UsageMeter;
  maxTokens?: number;
}): Promise<ResearchResult> {
  if (!Number.isSafeInteger(opts.maxSearches) || opts.maxSearches < 1) {
    throw new PermanentJobError("Search budget must be a positive integer");
  }
  const budgetNote =
    `\n\nSearch budget: at most ${opts.maxSearches} web searches for this report. Plan them — ` +
    "primary sources (investor-relations releases, SEC filings) first — and when the budget runs " +
    "out, write the report from what you found, saying plainly what you couldn't verify.";
  const messages: Anthropic.MessageParam[] = [
    // Cached too, so each continuation re-reads the prompt at 0.1x.
    { role: "user", content: [{ type: "text", text: opts.prompt + budgetNote, cache_control: { type: "ephemeral" } }] },
  ];
  let searchesUsed = 0;
  let billedSearches = 0;
  const observedSearchIds = new Set<string>();
  const sources: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  const usage = { input_tokens: 0, output_tokens: 0 };

  for (let i = 0; ; i++) {
    const canSearch = searchesUsed < opts.maxSearches;
    const msg = await client().messages.create(
      {
        model: ENGINE_MODEL,
        max_tokens: opts.maxTokens ?? 16_000,
        system: cachedSystem(opts.system),
        tools: [
          {
            type: "web_search_20260209",
            name: "web_search",
            ...(canSearch ? { max_uses: opts.maxSearches - searchesUsed } : {}),
          },
        ],
        // Retain the tool declaration so encrypted results and pending server
        // calls remain valid, but prohibit choosing any further search.
        ...(!canSearch ? { tool_choice: { type: "none" as const } } : {}),
        ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
        messages,
      },
      { timeout: callTimeout(opts.deadline, EXTRACT_RESERVE_MS, MAX_CALL_MS) }
    );
    opts.meter?.add(msg.usage);
    // A paused turn may include a pending search that is billed on the next
    // response. Reserve its ID once without counting its later usage twice.
    for (const block of msg.content) {
      if (block.type === "server_tool_use" && block.name === "web_search") observedSearchIds.add(block.id);
    }
    billedSearches += msg.usage.server_tool_use?.web_search_requests ?? 0;
    searchesUsed = Math.max(billedSearches, observedSearchIds.size);
    usage.input_tokens += msg.usage.input_tokens;
    usage.output_tokens += msg.usage.output_tokens;

    for (const block of msg.content) {
      if (block.type !== "web_search_tool_result") continue;
      // A failed search returns an error object here, not a list.
      if (!Array.isArray(block.content)) continue;
      for (const r of block.content) {
        if (r.type === "web_search_result" && r.url && !seen.has(r.url)) {
          seen.add(r.url);
          sources.push({ title: r.title ?? r.url, url: r.url });
        }
      }
    }

    if (msg.stop_reason === "pause_turn") {
      if (i >= MAX_CONTINUATIONS) throw new Error("Research did not finish after repeated continuations");
      // Preserve the complete evidence, citations, and server-tool state.
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    assertComplete(msg);
    return { text: finalText(msg), sources, usage };
  }
}

// For the OHLC-only variants (one_candle, davinci_model) — no web search,
// just interpretation of data already fetched from Yahoo (lib/marketdata.ts).
export async function writeFromData(opts: {
  system: string;
  prompt: string;
  deadline: number;
  meter?: UsageMeter;
  maxTokens?: number;
}): Promise<ResearchResult> {
  const msg = await client().messages.create(
    {
      model: ENGINE_MODEL,
      max_tokens: opts.maxTokens ?? 16_000,
      system: cachedSystem(opts.system),
      messages: [{ role: "user", content: opts.prompt }],
    },
    { timeout: callTimeout(opts.deadline, EXTRACT_RESERVE_MS, MAX_CALL_MS) }
  );
  opts.meter?.add(msg.usage);
  assertComplete(msg);
  return {
    text: finalText(msg),
    sources: [],
    usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens },
  };
}

// Second-stage extraction: converts already-researched text into a discrete
// JSON shape. No tools, no web search, thinking off (a small forced tool call
// doesn't need it and thinking could eat the token budget) — it only reformats
// what it's given. Required fields are checked before the result is trusted.
export async function extractStructured<T>(opts: {
  researchedText: string;
  instructions: string;
  toolName: string;
  schema: { required?: string[] } & Record<string, unknown>;
  deadline: number;
  meter?: UsageMeter;
}): Promise<T> {
  const msg = await client().messages.create(
    {
      model: ENGINE_MODEL,
      max_tokens: 4096,
      thinking: { type: "disabled" },
      system:
        "Extract the requested structured fields from the research below. Do not add facts that " +
        "aren't in the research text — if something wasn't covered, use null or omit it.",
      tools: [{ name: opts.toolName, description: opts.instructions, input_schema: opts.schema as any }],
      tool_choice: { type: "tool", name: opts.toolName },
      messages: [{ role: "user", content: opts.researchedText }],
    },
    { timeout: callTimeout(opts.deadline, WRITE_BACK_MS, EXTRACT_CALL_MS) }
  );
  opts.meter?.add(msg.usage);
  if (msg.stop_reason !== "tool_use") {
    throw new Error(`Extraction did not complete (stop_reason: ${msg.stop_reason})`);
  }
  const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("Model did not return the expected structured tool call");
  const input = toolUse.input as Record<string, unknown>;
  for (const field of opts.schema.required ?? []) {
    if (input[field] == null || input[field] === "") {
      throw new Error(`Extraction is missing required field "${field}"`);
    }
  }
  return input as T;
}
