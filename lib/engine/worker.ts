import type { TransactionSql } from "postgres";
import { sql } from "@/lib/db";
import { fetchOpeningCandle, fetchHistory, fetchMovers } from "@/lib/marketdata";
import {
  researchWithWebSearch,
  writeFromData,
  extractStructured,
  isPermanentAnthropicFailure,
  PermanentJobError,
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
import { maybeRunSetupScan } from "@/lib/setups-run";
import { computeGrade, cleanSummaryLine, parseThesisStatus, GRADED_VARIANTS } from "@/lib/grades";

const MAX_ATTEMPTS = 3;
// Total wall-clock this invocation may spend, kept under the route's
// maxDuration (300s). Every Anthropic/Yahoo call is bounded by this deadline
// (lib/engine/anthropic.ts), so a job either finishes or fails cleanly inside
// the invocation instead of being killed mid-flight.
const INVOCATION_BUDGET_MS = Number(process.env.ENGINE_INVOCATION_BUDGET_MS ?? 280_000);
// Don't start another job with less than this left — it would only time out.
const MIN_CLAIM_MS = Number(process.env.ENGINE_MIN_CLAIM_MS ?? 150_000);
// General research variants (full, memo, watchlist, movers…) depend on the
// hosted web_search tool, whose output quality hasn't been validated against
// the interactive /build-studies bar yet. Off by default: those jobs stay
// pending for the manual path; only OHLC-only variants are automated.
// A scan fetches ~100 daily series plus one small model call.
const SETUP_SCAN_MIN_MS = 90_000;
const INCLUDE_WEB_RESEARCH = process.env.ENGINE_WEB_RESEARCH === "1";

// What customers see on a failed study. Raw error text (API bodies, config
// hints) stays in jobs.result for the operator.
const GENERIC_FAILURE = "We couldn't build this report. Your credits have been refunded.";

type Job = {
  id: number;
  type: string;
  payload: { case_study_id?: number; watchlist_id?: number };
  attempts: number;
};
type Tx = TransactionSql<{}>;
type CaseStudyMeta = {
  company?: string | null;
  as_of_date?: string | null;
  corrections_md?: string | null;
  summary_line?: string | null;
  grade?: unknown;
};
type WatchlistEntry = {
  company?: string | null;
  as_of_date: string;
  thesis: string;
  snapshot: string;
  triggers: string[];
  status_tag: "watching" | "building_conviction" | "pass";
  thesis_status?: string;
  thesis_status_note?: string | null;
};

// The study row was deleted while its job was running. The research was
// already paid for, so this fails the job without a refund.
class StudyGoneError extends Error {}

// Notes are free text ("check Monday's session"); only an explicit
// YYYY-MM-DD in them selects a session date. Otherwise: latest session.
function sessionDateFromNotes(notes: string | null): string | undefined {
  return notes?.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
}

// If structured extraction fails, the study itself is still good — take the
// "As of" date straight from its first line rather than redoing the research.
function fallbackMeta(content: string): CaseStudyMeta {
  const m = content.match(/As of\**:?\**\s*\**\s*([A-Z][a-z]+\.? \d{1,2}, \d{4})/);
  return { as_of_date: m?.[1] ?? null };
}

async function studyMeta(content: string, deadline: number): Promise<CaseStudyMeta> {
  try {
    return await extractStructured<CaseStudyMeta>({
      researchedText: content,
      instructions: CASE_STUDY_META_TOOL.instructions,
      toolName: CASE_STUDY_META_TOOL.toolName,
      schema: CASE_STUDY_META_TOOL.schema,
      deadline,
    });
  } catch (err) {
    console.warn("engine: meta extraction failed, using fallback", err);
    return fallbackMeta(content);
  }
}

async function markDone(tx: Tx, jobId: number) {
  await tx`UPDATE jobs SET status = 'done', result = 'ok', locked_at = NULL, updated_at = now() WHERE id = ${jobId}`;
}

async function writeStudy(
  job: Job,
  caseStudyId: number,
  content: string,
  sources: { title: string; url: string }[],
  meta: CaseStudyMeta,
  variant: string
) {
  // The overall letter is computed from the card scores, never taken from the model.
  const grade = GRADED_VARIANTS.has(variant) ? computeGrade(meta.grade) : null;
  const summaryLine = cleanSummaryLine(meta.summary_line);
  // Study and job flip together — no window where the study is ready but the
  // job still looks unfinished.
  await sql.begin(async (tx) => {
    const updated = await tx`
      UPDATE case_studies SET
        status = 'ready', content_md = ${content}, error = NULL,
        company = COALESCE(${meta.company ?? null}, company),
        as_of_date = COALESCE(${meta.as_of_date ?? null}, as_of_date),
        sources_json = COALESCE(${sources.length ? sql.json(sources) : null}, sources_json),
        corrections_md = COALESCE(${meta.corrections_md ?? null}, corrections_md),
        summary_line = COALESCE(${summaryLine}, summary_line),
        grade_json = COALESCE(${grade ? sql.json(grade) : null}, grade_json),
        updated_at = now()
      WHERE id = ${caseStudyId}
      RETURNING id
    `;
    if (!updated.length) throw new StudyGoneError(`case_studies row ${caseStudyId} was deleted`);
    await markDone(tx, job.id);
  });
}

async function processCaseStudy(job: Job, deadline: number) {
  const caseStudyId = job.payload.case_study_id!;
  const [study] = await sql`
    SELECT id, ticker, company, variant, notes, parent_id FROM case_studies WHERE id = ${caseStudyId}
  `;
  if (!study) throw new StudyGoneError(`case_studies row ${caseStudyId} not found`);

  let parentStudyMarkdown: string | null = null;
  if (job.type === "earnings_update" && study.parent_id) {
    const [parent] = await sql`SELECT content_md FROM case_studies WHERE id = ${study.parent_id}`;
    parentStudyMarkdown = parent?.content_md ?? null;
  }

  let content: string;
  let sources: { title: string; url: string }[] = [];

  if (study.variant === "one_candle") {
    const data = await fetchOpeningCandle(study.ticker, sessionDateFromNotes(study.notes));
    const res = await writeFromData({
      system: systemPromptFromDataOnly(),
      prompt: oneCandlePrompt(study.ticker, study.notes, data),
      deadline,
    });
    content = res.text;
  } else if (study.variant === "davinci_model") {
    const data = await fetchHistory(study.ticker, "5m", "5d");
    const res = await writeFromData({
      system: systemPromptFromDataOnly(),
      prompt: davinciModelPrompt(study.ticker, study.notes, data),
      deadline,
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
      deadline,
    });
    content = res.text;
    sources = res.sources;
  }

  await writeStudy(job, caseStudyId, content, sources, await studyMeta(content, deadline), study.variant);
}

async function processMoversDigest(job: Job, deadline: number) {
  const moversData = await fetchMovers(5);
  const res = await researchWithWebSearch({
    system: systemPromptWithWebSearch(),
    prompt: moversDigestPrompt(moversData),
    deadline,
  });
  const meta = await studyMeta(res.text, deadline);
  await writeStudy(
    job,
    job.payload.case_study_id!,
    res.text,
    res.sources,
    { as_of_date: meta.as_of_date, summary_line: meta.summary_line },
    "movers_digest"
  );
}

async function processWatchlistEntry(job: Job, deadline: number) {
  const watchlistId = job.payload.watchlist_id!;
  const [row] = await sql`SELECT id, ticker, company, thesis, as_of_date FROM watchlist WHERE id = ${watchlistId}`;
  if (!row) throw new StudyGoneError(`watchlist row ${watchlistId} not found`);

  const research = await researchWithWebSearch({
    system: systemPromptWithWebSearch(),
    prompt: watchlistResearchPrompt(row.ticker, row.company, row.thesis ? { thesis: row.thesis, as_of_date: row.as_of_date } : null),
    deadline,
  });
  const entry = await extractStructured<WatchlistEntry>({
    researchedText: research.text,
    instructions: WATCHLIST_ENTRY_TOOL.instructions,
    toolName: WATCHLIST_ENTRY_TOOL.toolName,
    schema: WATCHLIST_ENTRY_TOOL.schema,
    deadline,
  });
  const triggers = Array.isArray(entry.triggers) ? entry.triggers.map(String) : null;
  const statusTag = ["watching", "building_conviction", "pass"].includes(entry.status_tag) ? entry.status_tag : null;
  // A first entry has nothing to judge against.
  const thesisStatus = row.thesis ? parseThesisStatus(entry.thesis_status) ?? "unknown" : "unknown";
  const thesisNote = row.thesis ? cleanSummaryLine(entry.thesis_status_note) : null;

  await sql.begin(async (tx) => {
    const updated = await tx`
      UPDATE watchlist SET
        thesis = ${String(entry.thesis)},
        snapshot = COALESCE(${entry.snapshot ?? null}, snapshot),
        triggers_json = COALESCE(${triggers ? sql.json(triggers) : null}, triggers_json),
        as_of_date = COALESCE(${entry.as_of_date ?? null}, as_of_date),
        company = COALESCE(${entry.company ?? null}, company),
        status_tag = COALESCE(${statusTag}, status_tag),
        thesis_status = ${thesisStatus},
        thesis_status_note = ${thesisNote},
        updated_at = now()
      WHERE id = ${watchlistId}
      RETURNING id
    `;
    if (!updated.length) throw new StudyGoneError(`watchlist row ${watchlistId} was deleted`);
    await markDone(tx, job.id);
  });
}

async function processJob(job: Job, deadline: number) {
  if (job.type === "build_case_study" || job.type === "earnings_update") {
    await processCaseStudy(job, deadline);
  } else if (job.type === "movers_digest") {
    await processMoversDigest(job, deadline);
  } else if (job.type === "watchlist_entry") {
    await processWatchlistEntry(job, deadline);
  } else {
    throw new PermanentJobError(`Unknown job type: ${job.type}`);
  }
}

async function failJob(job: Job, err: unknown, refund: boolean) {
  const raw = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
  const shown = err instanceof PermanentJobError && !/API_KEY/.test(raw) ? `${raw}. Your credits have been refunded.` : GENERIC_FAILURE;
  await sql.begin(async (tx) => {
    await tx`UPDATE jobs SET status = 'error', result = ${raw}, locked_at = NULL, updated_at = now() WHERE id = ${job.id}`;
    if (job.payload.case_study_id) {
      await tx`
        UPDATE case_studies SET status = 'error', error = ${refund ? shown : "This report was deleted while it was being built."},
        updated_at = now() WHERE id = ${job.payload.case_study_id}
      `;
    }
    // The credits charged at queue time go back — the customer got nothing.
    if (refund) await tx`SELECT refund_job_credits(${job.id})`;
  });
}

async function retryLater(job: Job, err: unknown) {
  const raw = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
  await sql.begin(async (tx) => {
    await tx`
      UPDATE jobs SET status = 'pending', locked_at = NULL, result = ${`attempt ${job.attempts} failed: ${raw}`},
      updated_at = now() WHERE id = ${job.id}
    `;
    if (job.payload.case_study_id) {
      await tx`UPDATE case_studies SET status = 'queued', updated_at = now() WHERE id = ${job.payload.case_study_id}`;
    }
  });
}

export async function runWorkerLoop() {
  const deadline = Date.now() + INVOCATION_BUDGET_MS;
  const processed: { job_id: number; status: "done" | "error" | "retrying" }[] = [];

  while (deadline - Date.now() >= MIN_CLAIM_MS) {
    const [job] = (await sql`
      SELECT * FROM claim_job(max_attempts => ${MAX_ATTEMPTS}, include_web_research => ${INCLUDE_WEB_RESEARCH})
    `) as unknown as (Job | { id: null })[];
    if (!job || job.id == null) break; // nothing left to claim

    try {
      await processJob(job, deadline);
      processed.push({ job_id: job.id, status: "done" });
    } catch (err) {
      console.error(`engine: job ${job.id} attempt ${job.attempts} failed`, err);
      if (err instanceof StudyGoneError) {
        await failJob(job, err, false);
        processed.push({ job_id: job.id, status: "error" });
      } else if (isPermanentAnthropicFailure(err) || job.attempts >= MAX_ATTEMPTS) {
        await failJob(job, err, true);
        processed.push({ job_id: job.id, status: "error" });
      } else {
        // Back to pending — the trigger/cron backstop (or this same loop,
        // if there's budget left) will pick it up again.
        await retryLater(job, err);
        processed.push({ job_id: job.id, status: "retrying" });
      }
    }
  }

  // Once per completed session, run the market-wide setup-bot scan with
  // whatever budget the queue left. Customer jobs always come first.
  let setupScan: unknown = null;
  if (deadline - Date.now() >= SETUP_SCAN_MIN_MS) {
    try {
      setupScan = await maybeRunSetupScan({ deadline });
    } catch (err) {
      console.error("engine: setup scan failed", err);
      setupScan = { ran: false, reason: "error" };
    }
  }

  return { processed_count: processed.length, processed, setup_scan: setupScan };
}
