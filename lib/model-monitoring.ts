// SR 11-7 ongoing model monitoring & outcomes calibration queries
// (Risk Register R2, R4, R6, R7, R8, R9 and Section 6 Monitoring Plan).
import { sql } from "./db";
import { ENGINE_MODEL } from "./engine/anthropic";
import { methodologyPromptHash, methodologyVersion } from "./engine/prompts";
import { MAX_PRICE_AGE_DAYS, PRICE_VERIFIED_ON, priceVerificationAgeDays } from "./engine/usage";
import { DAILY_SPEND_CAP_USD } from "./engine/worker";

export type GradeBucketCalibration = {
  bucket: "A" | "B" | "C" | "D/F";
  studies: number;
  meanScore: number | null;
  tracked: number;
  avgExcessVsSpyPct: number | null;
};

export type ThesisCalibrationRow = {
  status: "intact" | "weakening" | "broken";
  rows: number;
  tracked: number;
  avgExcessVsSpyPct: number | null;
};

export type SetupPlanSummary = {
  total: number;
  open: number;
  target: number;
  stop: number;
  expired: number;
  ambiguous: number;
};

export type ModelMonitoringSnapshot = {
  governance: {
    model: string;
    promptVersion: string;
    promptHash: string;
    priceVerifiedOn: string;
    priceAgeDays: number;
    priceStale: boolean;
    dailySpendCapUsd: number;
    todaySpendUsd: number;
    webResearchEnabled: boolean;
  };
  process30d: {
    doneStudyJobs: number;
    extractionFallbacks: number;
    extractionFallbackPct: number | null;
    postcheckFailures: number;
    scansDone: number;
    alpacaOrMixedScans: number;
    alpacaScanPct: number | null;
  };
  grades90d: {
    totalGraded: number;
    buckets: GradeBucketCalibration[];
    driftWarning: string | null;
  };
  thesisStatus: ThesisCalibrationRow[];
  setupPlans: SetupPlanSummary | null;
};

export function evaluateGradeDriftWarning(buckets: GradeBucketCalibration[]): string | null {
  const total = buckets.reduce((s, b) => s + b.studies, 0);
  if (total < 20) return null;
  const aCount = buckets.find((b) => b.bucket === "A")?.studies ?? 0;
  const aShare = aCount / total;
  if (aShare > 0.6) {
    return `Grade inflation alert: ${Math.round(aShare * 100)}% of graded studies in the last 90 days landed in the A band (>60% threshold).`;
  }
  const dfCount = buckets.find((b) => b.bucket === "D/F")?.studies ?? 0;
  if (dfCount / total > 0.6) {
    return `Grade compression alert: ${Math.round((dfCount / total) * 100)}% of graded studies landed in D/F (>60% threshold).`;
  }
  return null;
}

export async function loadModelMonitoring(): Promise<ModelMonitoringSnapshot> {
  const ageDays = Math.max(0, Math.round(priceVerificationAgeDays()));

  const [proc] = await sql`
    WITH bounds AS (SELECT (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS utc_start)
    SELECT
      count(*) FILTER (WHERE status = 'done' AND type IN ('build_case_study', 'earnings_update', 'movers_digest') AND updated_at > now() - interval '30 days')::int AS done_studies,
      count(*) FILTER (WHERE status = 'done' AND coalesce((usage_json->>'extraction_fallback')::boolean, false) AND updated_at > now() - interval '30 days')::int AS fallbacks,
      count(*) FILTER (WHERE status = 'error' AND result LIKE 'postcheck_failed:%' AND updated_at > now() - interval '30 days')::int AS postcheck_failures,
      coalesce(sum(cost_usd) FILTER (WHERE cost_usd IS NOT NULL AND updated_at >= (SELECT utc_start FROM bounds)), 0)::float AS job_today_usd
    FROM jobs
  `;

  const [scanStats] = await sql`
    WITH bounds AS (SELECT (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS utc_start)
    SELECT
      count(*) FILTER (WHERE status = 'done' AND finished_at > now() - interval '30 days')::int AS scans_done,
      count(*) FILTER (WHERE status = 'done' AND data_source IN ('alpaca', 'mixed') AND finished_at > now() - interval '30 days')::int AS alpaca_scans,
      coalesce(sum(cost_usd) FILTER (WHERE cost_usd IS NOT NULL AND finished_at >= (SELECT utc_start FROM bounds)), 0)::float AS scan_today_usd
    FROM setup_scans
  `.catch(() => [{ scans_done: 0, alpaca_scans: 0, scan_today_usd: 0 }]);

  const gradeRows = await sql`
    WITH graded AS (
      SELECT
        CASE
          WHEN (grade_json->>'overall') IN ('A', 'A-') THEN 'A'
          WHEN (grade_json->>'overall') IN ('B+', 'B', 'B-') THEN 'B'
          WHEN (grade_json->>'overall') IN ('C+', 'C', 'C-') THEN 'C'
          ELSE 'D/F'
        END AS bucket,
        (grade_json->>'score')::float AS score,
        CASE
          WHEN live_json->'since'->>'changePct' IS NOT NULL AND live_json->'since'->>'spyChangePct' IS NOT NULL
          THEN (live_json->'since'->>'changePct')::float - (live_json->'since'->>'spyChangePct')::float
          ELSE NULL
        END AS excess_pct
      FROM case_studies
      WHERE status = 'ready'
        AND grade_json IS NOT NULL
        AND created_at > now() - interval '90 days'
    )
    SELECT
      bucket,
      count(*)::int AS studies,
      round(avg(score)::numeric, 1)::float AS mean_score,
      count(excess_pct)::int AS tracked,
      round(avg(excess_pct)::numeric, 2)::float AS avg_excess
    FROM graded
    GROUP BY bucket
  `;

  const byBucket = new Map<string, any>(gradeRows.map((r) => [String(r.bucket), r]));
  const buckets: GradeBucketCalibration[] = (["A", "B", "C", "D/F"] as const).map((b) => {
    const r = byBucket.get(b);
    return {
      bucket: b,
      studies: r?.studies ?? 0,
      meanScore: r?.mean_score ?? null,
      tracked: r?.tracked ?? 0,
      avgExcessVsSpyPct: r?.avg_excess ?? null,
    };
  });

  const thesisRows = await sql`
    SELECT
      thesis_status AS status,
      count(*)::int AS rows,
      count(*) FILTER (
        WHERE live_json->'since'->>'changePct' IS NOT NULL AND live_json->'since'->>'spyChangePct' IS NOT NULL
      )::int AS tracked,
      round(avg(
        CASE
          WHEN live_json->'since'->>'changePct' IS NOT NULL AND live_json->'since'->>'spyChangePct' IS NOT NULL
          THEN (live_json->'since'->>'changePct')::float - (live_json->'since'->>'spyChangePct')::float
          ELSE NULL
        END
      )::numeric, 2)::float AS avg_excess
    FROM watchlist
    WHERE thesis_status IN ('intact', 'weakening', 'broken')
    GROUP BY thesis_status
  `;
  const byStatus = new Map<string, any>(thesisRows.map((r) => [String(r.status), r]));
  const thesisStatus: ThesisCalibrationRow[] = (["intact", "weakening", "broken"] as const).map((st) => {
    const r = byStatus.get(st);
    return {
      status: st,
      rows: r?.rows ?? 0,
      tracked: r?.tracked ?? 0,
      avgExcessVsSpyPct: r?.avg_excess ?? null,
    };
  });

  const [plans] = await sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE resolved_at IS NULL)::int AS open,
      count(*) FILTER (WHERE outcome = 'target')::int AS target,
      count(*) FILTER (WHERE outcome = 'stop')::int AS stop,
      count(*) FILTER (WHERE outcome = 'expired')::int AS expired,
      count(*) FILTER (WHERE outcome = 'ambiguous')::int AS ambiguous
    FROM setup_study_plans
  `.catch(() => [null]);

  const doneStudies = Number(proc?.done_studies ?? 0);
  const fallbacks = Number(proc?.fallbacks ?? 0);
  const scansDone = Number(scanStats?.scans_done ?? 0);
  const alpacaScans = Number(scanStats?.alpaca_scans ?? 0);

  return {
    governance: {
      model: ENGINE_MODEL,
      promptVersion: methodologyVersion(),
      promptHash: methodologyPromptHash(),
      priceVerifiedOn: PRICE_VERIFIED_ON,
      priceAgeDays: ageDays,
      priceStale: ageDays > MAX_PRICE_AGE_DAYS,
      dailySpendCapUsd: DAILY_SPEND_CAP_USD,
      todaySpendUsd: Number(proc?.job_today_usd ?? 0) + Number(scanStats?.scan_today_usd ?? 0),
      webResearchEnabled: process.env.ENGINE_WEB_RESEARCH === "1",
    },
    process30d: {
      doneStudyJobs: doneStudies,
      extractionFallbacks: fallbacks,
      extractionFallbackPct: doneStudies > 0 ? Math.round((fallbacks / doneStudies) * 1000) / 10 : null,
      postcheckFailures: Number(proc?.postcheck_failures ?? 0),
      scansDone,
      alpacaOrMixedScans: alpacaScans,
      alpacaScanPct: scansDone > 0 ? Math.round((alpacaScans / scansDone) * 1000) / 10 : null,
    },
    grades90d: {
      totalGraded: buckets.reduce((s, b) => s + b.studies, 0),
      buckets,
      driftWarning: evaluateGradeDriftWarning(buckets),
    },
    thesisStatus,
    setupPlans: plans
      ? {
          total: plans.total,
          open: plans.open,
          target: plans.target,
          stop: plans.stop,
          expired: plans.expired,
          ambiguous: plans.ambiguous,
        }
      : null,
  };
}
