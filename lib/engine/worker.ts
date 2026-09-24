import { sql } from "@/lib/db";
import { fetchOpeningCandle, fetchHistory, fetchMovers } from "@/lib/marketdata";
import {
  researchWithWebSearch,
  writeFromData,
  extractStructured,
  isPermanentAnthropicFailure,
} from "./anthropic";
import {
  systemPromptWithWebSearch,
  systemPromptFromDataOnly,
  buildCaseStudyPrompt,
  moversDigestPrompt,
  oneCandlePrompt,
  davinciModelPrompt,
  watchlistResearchPrompt,
  CASE_STUDY_META_TOOL,
  WATCHLIST_ENTRY_TOOL,
} from "./prompts";

const MAX_ATTEMPTS = 3;
// Keep comfortably under whatever the deploy host's function-duration limit
// ends up being once actually deployed (see app/api/engine/run/route.ts's
// maxDuration) — tune this alongside that once a host is chosen.
const INVOCATION_BUDGET_MS = Number(process.env.ENGINE_INVOCATION_BUDGET_MS ?? 240_000);

type CaseStudyMeta = { company?: string | null; as_of_date: string; corrections_md?: string | null };
type WatchlistEntry = {
  company?: string | null;
  as_of_date: string;
  thesis: string;
  snapshot: string;
  triggers: string[];
  status_tag: "watching" | "building_conviction" | "pass";
};

async function processCaseStudy(job: any) {
  const caseStudyId = job.payload.case_study_id;
  const [study] = await sql`SELECT * FROM case_studies WHERE id = ${caseStudyId}`;
  if (!study) throw new Error(`case_studies row ${caseStudyId} not found`);

  let parentStudyMarkdown: string | null = null;
  if (job.type === "earnings_update" && study.parent_id) {
    const [parent] = await sql`SELECT content_md FROM case_studies WHERE id = ${study.parent_id}`;
    parentStudyMarkdown = parent?.content_md ?? null;
  }

  let content: string;
  let sources: { title: string; url: string }[] = [];

  if (study.variant === "one_candle") {
    const data = await fetchOpeningCandle(study.ticker, study.notes ?? undefined);
    const res = await writeFromData({
      system: systemPromptFromDataOnly(),
      prompt: oneCandlePrompt(study.ticker, study.notes, data),
    });
    content = res.text;
  } else if (study.variant === "davinci_model") {
    const data = await fetchHistory(study.ticker, "5m", "5d");
    const res = await writeFromData({
      system: systemPromptFromDataOnly(),
      prompt: davinciModelPrompt(study.ticker, study.notes, data),
    });
    content = res.text;
  } else {
    const res = await researchWithWebSearch({
      system: systemPromptWithWebSearch(),
      prompt: buildCaseStudyPrompt({
        ticker: study.ticker,
        variant: study.variant,
        company: study.company,
        notes: study.notes,
        parentStudyMarkdown,
      }),
    });
    content = res.text;
    sources = res.sources;
  }

  const meta = await extractStructured<CaseStudyMeta>({
    researchedText: content,
    instructions: CASE_STUDY_META_TOOL.instructions,
    toolName: CASE_STUDY_META_TOOL.toolName,
    schema: CASE_STUDY_META_TOOL.schema,
  });

  await sql`
    UPDATE case_studies SET
      status = 'ready', content_md = ${content}, error = NULL,
      company = COALESCE(${meta.company ?? null}, company),
      as_of_date = COALESCE(${meta.as_of_date ?? null}, as_of_date),
      sources_json = COALESCE(${sources.length ? sql.json(sources) : null}, sources_json),
      corrections_md = COALESCE(${meta.corrections_md ?? null}, corrections_md),
      updated_at = now()
    WHERE id = ${caseStudyId}
  `;
}

async function processMoversDigest(job: any) {
  const caseStudyId = job.payload.case_study_id;
  const moversData = await fetchMovers(5);
  const res = await researchWithWebSearch({
    system: systemPromptWithWebSearch(),
    prompt: moversDigestPrompt(moversData),
  });
  const meta = await extractStructured<CaseStudyMeta>({
    researchedText: res.text,
    instructions: CASE_STUDY_META_TOOL.instructions,
    toolName: CASE_STUDY_META_TOOL.toolName,
    schema: CASE_STUDY_META_TOOL.schema,
  });

  await sql`
    UPDATE case_studies SET
      status = 'ready', content_md = ${res.text}, error = NULL,
      as_of_date = COALESCE(${meta.as_of_date ?? null}, as_of_date),
      sources_json = COALESCE(${res.sources.length ? sql.json(res.sources) : null}, sources_json),
      updated_at = now()
    WHERE id = ${caseStudyId}
  `;
}

async function processWatchlistEntry(job: any) {
  const watchlistId = job.payload.watchlist_id;
  const [row] = await sql`SELECT * FROM watchlist WHERE id = ${watchlistId}`;
  if (!row) throw new Error(`watchlist row ${watchlistId} not found`);

  const research = await researchWithWebSearch({
    system: systemPromptWithWebSearch(),
    prompt: watchlistResearchPrompt(row.ticker, row.company),
  });
  const entry = await extractStructured<WatchlistEntry>({
    researchedText: research.text,
    instructions: WATCHLIST_ENTRY_TOOL.instructions,
    toolName: WATCHLIST_ENTRY_TOOL.toolName,
    schema: WATCHLIST_ENTRY_TOOL.schema,
  });

  await sql`
    UPDATE watchlist SET
      thesis = ${entry.thesis},
      snapshot = COALESCE(${entry.snapshot ?? null}, snapshot),
      triggers_json = COALESCE(${entry.triggers ? sql.json(entry.triggers) : null}, triggers_json),
      as_of_date = COALESCE(${entry.as_of_date ?? null}, as_of_date),
      company = COALESCE(${entry.company ?? null}, company),
      status_tag = COALESCE(${entry.status_tag ?? null}, status_tag),
      updated_at = now()
    WHERE id = ${watchlistId}
  `;
}

async function processJob(job: any) {
  if (job.type === "build_case_study" || job.type === "earnings_update") {
    await processCaseStudy(job);
  } else if (job.type === "movers_digest") {
    await processMoversDigest(job);
  } else if (job.type === "watchlist_entry") {
    await processWatchlistEntry(job);
  } else {
    throw new Error(`Unknown job type: ${job.type}`);
  }
}

async function failJob(job: any, err: unknown) {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
  await sql`UPDATE jobs SET status = 'error', result = ${message}, updated_at = now() WHERE id = ${job.id}`;
  const payload = job.payload as Record<string, any>;
  if (payload.case_study_id) {
    await sql`UPDATE case_studies SET status = 'error', error = ${message}, updated_at = now() WHERE id = ${payload.case_study_id}`;
  }
}

export async function runWorkerLoop() {
  const startedAt = Date.now();
  const processed: { job_id: number; status: "done" | "error" | "retrying" }[] = [];

  while (Date.now() - startedAt < INVOCATION_BUDGET_MS) {
    const [job] = await sql`SELECT * FROM claim_job()`;
    if (!job || job.id == null) break; // nothing left to claim

    try {
      await processJob(job);
      await sql`UPDATE jobs SET status = 'done', result = 'ok', updated_at = now() WHERE id = ${job.id}`;
      processed.push({ job_id: job.id, status: "done" });
    } catch (err) {
      const permanent = isPermanentAnthropicFailure(err);
      if (permanent || job.attempts >= MAX_ATTEMPTS) {
        await failJob(job, err);
        processed.push({ job_id: job.id, status: "error" });
      } else {
        // Back to pending — the trigger/cron backstop (or this same loop,
        // if there's budget left) will pick it up again.
        await sql`UPDATE jobs SET status = 'pending', updated_at = now() WHERE id = ${job.id}`;
        processed.push({ job_id: job.id, status: "retrying" });
      }
    }
  }

  return { processed_count: processed.length, processed };
}
