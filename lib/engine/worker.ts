import type { TransactionSql } from "postgres";
import { sql } from "@/lib/db";
import { fetchOpeningCandle, fetchHistory, fetchMovers } from "@/lib/marketdata";
import {
  researchWithWebSearch,
  writeFromData,
  extractStructured,
  extractStructuredOrFail,
  isPermanentAnthropicFailure,
  isEngineUnavailable,
  PermanentJobError,
  ENGINE_MODEL,
} from "./anthropic";
import {
  systemPromptWithWebSearch,
  systemPromptFromDataOnly,
  buildCaseStudyPrompt,
  moversDigestPrompt,
  oneCandlePrompt,
  davinciModelPrompt,
  watchlistResearchPrompt,
  methodologyVersion,
  methodologyPromptHash,
  CASE_STUDY_META_TOOL,
  WATCHLIST_ENTRY_TOOL,
} from "./prompts";
import { UsageMeter } from "./usage";
import { searchBudget, effortFor } from "./budgets";
import {
  validateAsOfDate,
  validateWebStudyOutput,
  validateOhlcStudyOutput,
  type ExtractedSetupPlan,
} from "./postcheck";
import { maybeRunSetupScan } from "@/lib/setups-run";
import { computeGrade, cleanSummaryLine, parseThesisStatus, GRADED_VARIANTS } from "@/lib/grades";
import {
  drainSignalPushQueue,
  notifyStudyFinished,
  notifyWatchlistUpdated,
} from "@/lib/push-dispatch";

const MAX_ATTEMPTS = 3;
// Total wall-clock this invocation may spend, kept under the route's
// maxDuration (300s) on serverless hosts; a long-running server (Render) can
// raise it so deep-research jobs have time to finish. Every Anthropic/Yahoo call is bounded by this deadline
// (lib/engine/anthropic.ts), so a job either finishes or fails cleanly inside
// the invocation instead of being killed mid-flight.
const INVOCATION_BUDGET_MS = Number(process.env.ENGINE_INVOCATION_BUDGET_MS ?? 280_000);
// Don't start another job with less than this left — it would only time out.
const MIN_CLAIM_MS = Number(process.env.ENGINE_MIN_CLAIM_MS ?? 150_000);
// A running job's lock goes stale (reclaimable) only after the longest an
// invocation can live, plus margin — otherwise a second invocation could take
// over a job that is still being written.
export const STALE_LOCK_MS = Math.max(360_000, INVOCATION_BUDGET_MS + 120_000);
// General research variants (full, memo, watchlist, movers…) depend on the
// hosted web_search tool, whose output quality hasn't been validated against
// the manually researched bar yet. Off by default: those jobs stay
// pending for the manual path; only OHLC-only variants are automated.
// A scan fetches ~100 daily series plus one small model call.
const SETUP_SCAN_MIN_MS = 90_000;
const INCLUDE_WEB_RESEARCH = process.env.ENGINE_WEB_RESEARCH === "1";
// Daily UTC ceiling on automated Anthropic spend across jobs + setup-bot desk
// notes (SR 11-7 R4 / SS-11). Set <= 0 to disable.
export const DAILY_SPEND_CAP_USD = Number(process.env.ENGINE_DAILY_SPEND_CAP_USD ?? 25);

export const MAX_THESIS_LENGTH = 500;
export const MAX_SNAPSHOT_LENGTH = 300;
export const MAX_TRIGGERS_COUNT = 5;
export const MAX_TRIGGER_LENGTH = 240;

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

function isoDateFromCandleTime(formatted: string | undefined, fallbackIso: string): string {
  if (!formatted) return fallbackIso;
  const mdy = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(formatted.trim());
  if (mdy) return `${mdy[3]}-${mdy[1]}-${mdy[2]}`;
  const ymd = /^(\d{4}-\d{2}-\d{2})/.exec(formatted.trim());
  if (ymd) return ymd[1];
  return fallbackIso;
}

async function studyMeta(
  content: string,
  deadline: number,
  meter: UsageMeter
): Promise<{ meta: CaseStudyMeta; usedFallback: boolean }> {
  try {
    const meta = await extractStructured<CaseStudyMeta>({
      researchedText: content,
      instructions: CASE_STUDY_META_TOOL.instructions,
      toolName: CASE_STUDY_META_TOOL.toolName,
      schema: CASE_STUDY_META_TOOL.schema,
      deadline,
      meter,
    });
    return { meta, usedFallback: false };
  } catch (err) {
    console.warn("engine: meta extraction failed, using fallback", err);
    return { meta: fallbackMeta(content), usedFallback: true };
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
  variant: string,
  opts?: {
    dataSource?: "yahoo" | "alpaca" | "mixed" | "web_search" | "manual" | null;
    setupPlan?: { plan: ExtractedSetupPlan; sessionDate: string } | null;
  }
) {
  // The overall letter is computed from the card scores, never taken from the model.
  const grade = GRADED_VARIANTS.has(variant) ? computeGrade(meta.grade) : null;
  const summaryLine = cleanSummaryLine(meta.summary_line);
  const dataSource = opts?.dataSource ?? null;
  const setupPlan = opts?.setupPlan ?? null;
  // Study and job flip together — no window where the study is ready but the
  // job still looks unfinished.
  let notified: { workspace_id: string; ticker: string } | undefined;
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
        data_source = COALESCE(${dataSource}, data_source),
        updated_at = now()
      WHERE id = ${caseStudyId}
      RETURNING id, workspace_id, ticker
    `;
    if (!updated.length) throw new StudyGoneError(`case_studies row ${caseStudyId} was deleted`);
    notified = { workspace_id: updated[0].workspace_id, ticker: updated[0].ticker };
    if (setupPlan && (variant === "one_candle" || variant === "davinci_model")) {
      await tx`
        INSERT INTO setup_study_plans
          (case_study_id, workspace_id, ticker, variant, session_date, direction, entry_price, stop_price, target_price)
        VALUES
          (${caseStudyId}, ${updated[0].workspace_id}, ${updated[0].ticker}, ${variant},
           ${setupPlan.sessionDate}, ${setupPlan.plan.direction},
           ${setupPlan.plan.entry}, ${setupPlan.plan.stop}, ${setupPlan.plan.target})
        ON CONFLICT (case_study_id) DO UPDATE SET
          session_date = EXCLUDED.session_date,
          direction = EXCLUDED.direction,
          entry_price = EXCLUDED.entry_price,
          stop_price = EXCLUDED.stop_price,
          target_price = EXCLUDED.target_price,
          resolved_at = NULL,
          exit_date = NULL,
          outcome = NULL
      `;
    }
    await markDone(tx, job.id);
  });
  if (notified) {
    await notifyStudyFinished({
      workspaceId: notified.workspace_id,
      studyId: caseStudyId,
      ticker: notified.ticker,
      variant,
      status: "ready",
      gradeLetter: grade?.overall ?? null,
      summaryLine,
    });
  }
}

async function processCaseStudy(job: Job, deadline: number, meter: UsageMeter): Promise<boolean> {
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
  let dataSource: "yahoo" | "alpaca" | "web_search" = "web_search";
  let ohlcContext:
    | {
        variant: "one_candle" | "davinci_model";
        candles: { t: string; o: number; h: number; l: number; c: number }[];
        openingRange?: { start: string; end: string; open: number; high: number; low: number; close: number } | null;
        rawSessionDate?: string;
        lastCandleTime?: string;
      }
    | undefined;

  if (study.variant === "one_candle") {
    const data = await fetchOpeningCandle(study.ticker, sessionDateFromNotes(study.notes), deadline - 40_000);
    dataSource = data.data_source;
    const res = await writeFromData({
      system: systemPromptFromDataOnly(),
      prompt: oneCandlePrompt(study.ticker, study.notes, data),
      deadline,
      meter,
    });
    content = res.text;
    ohlcContext = {
      variant: "one_candle",
      candles: data.one_minute_candles,
      openingRange: data.first_five_minute_candle,
      rawSessionDate: data.session_date,
    };
  } else if (study.variant === "davinci_model") {
    const data = await fetchHistory(study.ticker, "5m", "5d", deadline - 40_000);
    dataSource = data.data_source;
    const res = await writeFromData({
      system: systemPromptFromDataOnly(),
      prompt: davinciModelPrompt(study.ticker, study.notes, data),
      deadline,
      meter,
    });
    content = res.text;
    ohlcContext = {
      variant: "davinci_model",
      candles: data.candles,
      lastCandleTime: data.last_candle_time,
    };
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
      maxSearches: searchBudget(study.variant),
      effort: effortFor(study.variant),
      meter,
    });
    content = res.text;
    sources = res.sources;
  }

  const { meta, usedFallback } = await studyMeta(content, deadline, meter);

  let setupPlan: { plan: ExtractedSetupPlan; sessionDate: string } | null = null;
  if (ohlcContext) {
    const check = validateOhlcStudyOutput({
      content,
      variant: ohlcContext.variant,
      candles: ohlcContext.candles,
      openingRange: ohlcContext.openingRange,
      asOfDate: meta.as_of_date,
    });
    if (!check.ok) throw new PermanentJobError(check.reason);
    if (check.plan) {
      const sessionDate =
        ohlcContext.rawSessionDate ?? isoDateFromCandleTime(ohlcContext.lastCandleTime, check.asOfIso);
      setupPlan = { plan: check.plan, sessionDate };
    }
  } else {
    const check = validateWebStudyOutput({
      content,
      variant: study.variant,
      sources,
      asOfDate: meta.as_of_date,
    });
    if (!check.ok) throw new PermanentJobError(check.reason);
  }

  await writeStudy(job, caseStudyId, content, sources, meta, study.variant, {
    dataSource,
    setupPlan,
  });
  return usedFallback;
}

async function processMoversDigest(job: Job, deadline: number, meter: UsageMeter): Promise<boolean> {
  const moversData = await fetchMovers(5, undefined, deadline - 40_000);
  const res = await researchWithWebSearch({
    system: systemPromptWithWebSearch(),
    prompt: moversDigestPrompt(moversData),
    deadline,
    maxSearches: searchBudget("movers_digest"),
    meter,
  });
  const { meta, usedFallback } = await studyMeta(res.text, deadline, meter);
  const check = validateWebStudyOutput({
    content: res.text,
    variant: "movers_digest",
    sources: res.sources,
    asOfDate: meta.as_of_date,
  });
  if (!check.ok) throw new PermanentJobError(check.reason);
  await writeStudy(
    job,
    job.payload.case_study_id!,
    res.text,
    res.sources,
    { as_of_date: meta.as_of_date, summary_line: meta.summary_line },
    "movers_digest",
    { dataSource: moversData.data_source === "alpaca" ? "mixed" : "web_search" }
  );
  return usedFallback;
}

async function processWatchlistEntry(job: Job, deadline: number, meter: UsageMeter): Promise<boolean> {
  const watchlistId = job.payload.watchlist_id!;
  const [row] = await sql`SELECT id, ticker, company, thesis, as_of_date FROM watchlist WHERE id = ${watchlistId}`;
  if (!row) throw new StudyGoneError(`watchlist row ${watchlistId} not found`);

  const research = await researchWithWebSearch({
    system: systemPromptWithWebSearch(),
    prompt: watchlistResearchPrompt(row.ticker, row.company, row.thesis ? { thesis: row.thesis, as_of_date: row.as_of_date } : null),
    deadline,
    maxSearches: searchBudget("watchlist_entry"),
    effort: effortFor("watchlist_entry"),
    meter,
  });
  const entry = await extractStructuredOrFail<WatchlistEntry>({
    researchedText: research.text,
    instructions: WATCHLIST_ENTRY_TOOL.instructions,
    toolName: WATCHLIST_ENTRY_TOOL.toolName,
    schema: WATCHLIST_ENTRY_TOOL.schema,
    deadline,
    meter,
  });
  const asOfCheck = validateAsOfDate(entry.as_of_date);
  if (!asOfCheck.ok) throw new PermanentJobError(asOfCheck.reason);

  const boundedThesis = String(entry.thesis ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_THESIS_LENGTH);
  if (!boundedThesis) throw new PermanentJobError("postcheck_failed: empty watchlist thesis");

  const boundedSnapshot = entry.snapshot
    ? String(entry.snapshot).replace(/\s+/g, " ").trim().slice(0, MAX_SNAPSHOT_LENGTH) || null
    : null;
  const triggers = Array.isArray(entry.triggers)
    ? entry.triggers
        .slice(0, MAX_TRIGGERS_COUNT)
        .map((t) => String(t).replace(/\s+/g, " ").trim().slice(0, MAX_TRIGGER_LENGTH))
        .filter(Boolean)
    : null;
  const statusTag = ["watching", "building_conviction", "pass"].includes(entry.status_tag) ? entry.status_tag : null;
  // A first entry has nothing to judge against.
  const thesisStatus = row.thesis ? parseThesisStatus(entry.thesis_status) ?? "unknown" : "unknown";
  const thesisNote = row.thesis ? cleanSummaryLine(entry.thesis_status_note) : null;

  let updatedWorkspaceId: string | null = null;
  await sql.begin(async (tx) => {
    const updated = await tx`
      UPDATE watchlist SET
        thesis = ${boundedThesis},
        snapshot = COALESCE(${boundedSnapshot}, snapshot),
        triggers_json = COALESCE(${triggers ? sql.json(triggers) : null}, triggers_json),
        as_of_date = COALESCE(${entry.as_of_date ?? null}, as_of_date),
        company = COALESCE(${entry.company ?? null}, company),
        status_tag = COALESCE(${statusTag}, status_tag),
        thesis_status = ${thesisStatus},
        thesis_status_note = ${thesisNote},
        updated_at = now()
      WHERE id = ${watchlistId}
      RETURNING id, workspace_id
    `;
    if (!updated.length) throw new StudyGoneError(`watchlist row ${watchlistId} was deleted`);
    updatedWorkspaceId = updated[0].workspace_id;
    await markDone(tx, job.id);
  });
  if (updatedWorkspaceId) {
    await notifyWatchlistUpdated({
      workspaceId: updatedWorkspaceId,
      watchlistId,
      ticker: row.ticker,
      thesisStatus,
      note: thesisNote,
    });
  }
  return false;
}

async function processJob(job: Job, deadline: number, meter: UsageMeter): Promise<boolean> {
  if (job.type === "build_case_study" || job.type === "earnings_update") {
    return processCaseStudy(job, deadline, meter);
  } else if (job.type === "movers_digest") {
    return processMoversDigest(job, deadline, meter);
  } else if (job.type === "watchlist_entry") {
    return processWatchlistEntry(job, deadline, meter);
  } else {
    throw new PermanentJobError(`Unknown job type: ${job.type}`);
  }
}

async function failJob(job: Job, err: unknown, refund: boolean) {
  const raw = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
  const shown = /^postcheck_failed:/i.test(raw)
    ? "Automated verification checks did not pass on this draft report. Your credits have been refunded."
    : err instanceof PermanentJobError && !/API_KEY/.test(raw)
      ? `${raw}. Your credits have been refunded.`
      : GENERIC_FAILURE;
  let failedStudy: { id: number; workspace_id: string; ticker: string; variant: string } | null = null;
  await sql.begin(async (tx) => {
    await tx`UPDATE jobs SET status = 'error', result = ${raw}, locked_at = NULL, updated_at = now() WHERE id = ${job.id}`;
    if (job.payload.case_study_id) {
      const [studyRow] = await tx`
        UPDATE case_studies SET status = 'error', error = ${refund ? shown : "This report was deleted while it was being built."},
        updated_at = now() WHERE id = ${job.payload.case_study_id}
        RETURNING id, workspace_id, ticker, variant
      `;
      if (studyRow && refund) {
        failedStudy = {
          id: studyRow.id,
          workspace_id: studyRow.workspace_id,
          ticker: studyRow.ticker,
          variant: studyRow.variant,
        };
      }
    }
    // The credits charged at queue time go back — the customer got nothing.
    if (refund) await tx`SELECT refund_job_credits(${job.id})`;
  });
  if (failedStudy) {
    const info: { id: number; workspace_id: string; ticker: string; variant: string } = failedStudy;
    await notifyStudyFinished({
      workspaceId: info.workspace_id,
      studyId: info.id,
      ticker: info.ticker,
      variant: info.variant,
      status: "error",
    });
  }
}

// Adds this attempt's model usage to the job's running totals. Accounting
// must never break the worker, so failures here are only logged.
async function recordUsage(jobId: number, meter: UsageMeter, extractionFallback = false) {
  const t = meter.totals;
  if (t.calls === 0) return;
  const cost = meter.costUsd();
  const promptVer = methodologyVersion();
  const promptHash = methodologyPromptHash();
  try {
    await sql`
      UPDATE jobs SET
        usage_json = jsonb_build_object(
          'model', ${t.model}::text,
          'prompt_version', ${promptVer}::text,
          'prompt_hash', ${promptHash}::text,
          'extraction_fallback', (coalesce((usage_json->>'extraction_fallback')::boolean, false) OR ${extractionFallback}),
          'calls', coalesce((usage_json->>'calls')::bigint, 0) + ${t.calls},
          'input_tokens', coalesce((usage_json->>'input_tokens')::bigint, 0) + ${t.input_tokens},
          'output_tokens', coalesce((usage_json->>'output_tokens')::bigint, 0) + ${t.output_tokens},
          'cache_creation_input_tokens', coalesce((usage_json->>'cache_creation_input_tokens')::bigint, 0) + ${t.cache_creation_input_tokens},
          'cache_read_input_tokens', coalesce((usage_json->>'cache_read_input_tokens')::bigint, 0) + ${t.cache_read_input_tokens},
          'web_search_requests', coalesce((usage_json->>'web_search_requests')::bigint, 0) + ${t.web_search_requests}
        ),
        cost_usd = CASE WHEN ${cost}::numeric IS NULL THEN cost_usd ELSE coalesce(cost_usd, 0) + ${cost}::numeric END
      WHERE id = ${jobId}
    `;
  } catch (err) {
    console.error(`engine: couldn't record usage for job ${jobId}`, err);
  }
}

// The account, not the job, failed: release the claim and give the attempt
// back so an empty credit balance can't dead-letter the whole queue.
async function holdForEngine(job: Job, err: unknown) {
  const raw = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
  await sql.begin(async (tx) => {
    await tx`
      UPDATE jobs SET status = 'pending', locked_at = NULL, attempts = greatest(attempts - 1, 0),
        result = ${`waiting for the engine: ${raw}`}, updated_at = now()
      WHERE id = ${job.id}
    `;
    if (job.payload.case_study_id) {
      await tx`UPDATE case_studies SET status = 'queued', updated_at = now() WHERE id = ${job.payload.case_study_id}`;
    }
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

// Tells the database's alert checks (stocks.ops_health_issues) the worker is
// alive, which jobs it takes, and the active daily spend cap.
async function heartbeat() {
  try {
    await sql`
      SELECT engine_heartbeat(${sql.json({
        web_research: INCLUDE_WEB_RESEARCH,
        daily_spend_cap_usd: DAILY_SPEND_CAP_USD,
        prompt_version: methodologyVersion(),
        prompt_hash: methodologyPromptHash(),
      })})
    `;
  } catch (err) {
    console.error("engine: heartbeat failed", err);
  }
}

async function todayAnthropicSpendUsd(): Promise<number> {
  try {
    const [row] = await sql`
      WITH bounds AS (SELECT (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS utc_start)
      SELECT (
        coalesce((SELECT sum(j.cost_usd) FROM jobs j, bounds b WHERE j.cost_usd IS NOT NULL AND j.updated_at >= b.utc_start), 0)
        + coalesce((SELECT sum(sc.cost_usd) FROM setup_scans sc, bounds b WHERE sc.cost_usd IS NOT NULL AND sc.finished_at >= b.utc_start), 0)
      )::float AS spent
    `;
    return Number(row?.spent ?? 0);
  } catch {
    return 0;
  }
}

export async function runWorkerLoop() {
  const deadline = Date.now() + INVOCATION_BUDGET_MS;
  await heartbeat();
  // Time-sensitive live signals push out first before multi-minute AI jobs.
  const signalPushes = await drainSignalPushQueue({
    deadline: Math.min(deadline, Date.now() + 20_000),
  });
  const processed: { job_id: number; status: "done" | "error" | "retrying" | "held" }[] = [];
  let engineUnavailable = false;
  let spendCapReached = false;

  while (deadline - Date.now() >= MIN_CLAIM_MS) {
    if (Number.isFinite(DAILY_SPEND_CAP_USD) && DAILY_SPEND_CAP_USD > 0) {
      const todaySpend = await todayAnthropicSpendUsd();
      if (todaySpend >= DAILY_SPEND_CAP_USD) {
        spendCapReached = true;
        console.warn(
          `engine: daily Anthropic spend cap reached ($${todaySpend.toFixed(2)} >= $${DAILY_SPEND_CAP_USD.toFixed(2)}); holding automated claims until 00:00 UTC`
        );
        break;
      }
    }

    const [job] = (await sql`
      SELECT * FROM claim_job(
        stale_after => make_interval(secs => ${STALE_LOCK_MS / 1000}),
        max_attempts => ${MAX_ATTEMPTS},
        include_web_research => ${INCLUDE_WEB_RESEARCH}
      )
    `) as unknown as (Job | { id: null })[];
    if (!job || job.id == null) break; // nothing left to claim

    const meter = new UsageMeter(ENGINE_MODEL);
    let extractionFallback = false;
    try {
      extractionFallback = await processJob(job, deadline, meter);
      processed.push({ job_id: job.id, status: "done" });
    } catch (err) {
      console.error(`engine: job ${job.id} attempt ${job.attempts} failed`, err);
      if (err instanceof StudyGoneError) {
        await failJob(job, err, false);
        processed.push({ job_id: job.id, status: "error" });
      } else if (isEngineUnavailable(err)) {
        await holdForEngine(job, err);
        processed.push({ job_id: job.id, status: "held" });
        engineUnavailable = true;
        break; // every other job would hit the same wall
      } else if (isPermanentAnthropicFailure(err) || job.attempts >= MAX_ATTEMPTS) {
        await failJob(job, err, true);
        processed.push({ job_id: job.id, status: "error" });
      } else {
        // Back to pending — the trigger/cron backstop (or this same loop,
        // if there's budget left) will pick it up again.
        await retryLater(job, err);
        processed.push({ job_id: job.id, status: "retrying" });
      }
    } finally {
      // Every attempt's spend is counted, including failed and held ones.
      await recordUsage(job.id, meter, extractionFallback);
    }
  }

  // Once per completed session, run the market-wide setup-bot scan with
  // whatever budget the queue left. Customer jobs always come first.
  let setupScan: unknown = null;
  if (!engineUnavailable && deadline - Date.now() >= SETUP_SCAN_MIN_MS) {
    try {
      setupScan = await maybeRunSetupScan({ deadline, skipDeskNotes: spendCapReached });
    } catch (err) {
      console.error("engine: setup scan failed", err);
      setupScan = { ran: false, reason: "error" };
    }
  }

  return {
    processed_count: processed.length,
    processed,
    signal_pushes: signalPushes,
    setup_scan: setupScan,
    engine_unavailable: engineUnavailable,
    spend_cap_reached: spendCapReached,
  };
}
