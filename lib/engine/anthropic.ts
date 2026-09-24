import Anthropic from "@anthropic-ai/sdk";

// Automated-worker Anthropic client (Phase 3 of the SaaS conversion).
// Pattern reused from agentor-ai: a deliberately short client-level timeout
// (keep it under whatever the deploy host's function-duration limit ends up
// being — see app/api/engine/run/route.ts's maxDuration export, which needs
// tuning once actually deployed) so a killed invocation fails loudly inside
// try/catch instead of silently over-running; maxRetries: 0 because the
// worker's own per-job `attempts` counter (lib/engine/worker.ts) is the
// single counted retry mechanism, not the SDK's.

export const ENGINE_MODEL = "claude-sonnet-5";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  _client = new Anthropic({ apiKey, timeout: 170_000, maxRetries: 0 });
  return _client;
}

// Auth/billing/dead-key errors should stop the job immediately rather than
// burning through the attempts ceiling — these will never succeed on retry.
export function isPermanentAnthropicFailure(err: unknown): boolean {
  const anyErr = err as any;
  const type = anyErr?.error?.error?.type ?? anyErr?.error?.type ?? anyErr?.type;
  if (type === "authentication_error" || type === "permission_error") return true;
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return (
    msg.includes("credit balance is too low") ||
    msg.includes("insufficient credit") ||
    msg.includes("billing") ||
    msg.includes("invalid x-api-key") ||
    msg.includes("anthropic_api_key is not set")
  );
}

export type ResearchResult = {
  text: string;
  sources: { title: string; url: string }[];
  usage: { input_tokens: number; output_tokens: number };
};

// One call, with Anthropic's hosted web_search tool available — the model
// decides whether/how many times to search server-side; the full exchange
// (search calls + results + final answer) comes back in one response, no
// manual tool-result round-trip needed for this particular tool.
export async function researchWithWebSearch(opts: {
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<ResearchResult> {
  const msg = await client().messages.create({
    model: ENGINE_MODEL,
    max_tokens: opts.maxTokens ?? 16_000,
    system: opts.system,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: opts.prompt }],
  });

  const textBlocks = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
  const text = textBlocks.map((b) => b.text).join("\n\n");
  if (!text.trim()) {
    // Seen in testing: this model's extended thinking can consume the
    // entire max_tokens budget before producing any text (stop_reason
    // "max_tokens" with only a "thinking" content block) — fail loudly
    // rather than write an empty study.
    throw new Error(`Model produced no text output (stop_reason: ${msg.stop_reason}) — raise maxTokens`);
  }

  const sources: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const block of msg.content) {
    if (block.type !== "web_search_tool_result") continue;
    const results = Array.isArray((block as any).content) ? (block as any).content : [];
    for (const r of results) {
      if (r?.type === "web_search_result" && r.url && !seen.has(r.url)) {
        seen.add(r.url);
        sources.push({ title: r.title ?? r.url, url: r.url });
      }
    }
  }

  return {
    text,
    sources,
    usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens },
  };
}

// For the OHLC-only variants (one_candle, davinci_model, movers_digest) —
// no web search needed, just interpretation of data already fetched from
// Yahoo (lib/marketdata.ts).
export async function writeFromData(opts: { system: string; prompt: string; maxTokens?: number }): Promise<ResearchResult> {
  const msg = await client().messages.create({
    model: ENGINE_MODEL,
    max_tokens: opts.maxTokens ?? 16_000,
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
  });
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
  if (!text.trim()) {
    throw new Error(`Model produced no text output (stop_reason: ${msg.stop_reason}) — raise maxTokens`);
  }
  return { text, sources: [], usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens } };
}

// Second-stage extraction: converts already-researched free text into a
// discrete JSON shape (used for watchlist_entry jobs, which need fields —
// thesis/snapshot/triggers/status_tag — not a markdown document). No tools,
// no web search — the research already happened in an earlier call; this
// call only reformats what it's given, so it can't introduce new facts.
export async function extractStructured<T>(opts: {
  researchedText: string;
  instructions: string;
  toolName: string;
  schema: Record<string, unknown>;
}): Promise<T> {
  const msg = await client().messages.create({
    model: ENGINE_MODEL,
    max_tokens: 1024,
    system:
      "Extract the requested structured fields from the research below. Do not add facts that " +
      "aren't in the research text — if something wasn't covered, use null or omit it.",
    tools: [{ name: opts.toolName, description: opts.instructions, input_schema: opts.schema as any }],
    tool_choice: { type: "tool", name: opts.toolName },
    messages: [{ role: "user", content: opts.researchedText }],
  });
  const toolUse = msg.content.find((b) => b.type === "tool_use") as Anthropic.ToolUseBlock | undefined;
  if (!toolUse) throw new Error("Model did not return the expected structured tool call");
  return toolUse.input as T;
}
