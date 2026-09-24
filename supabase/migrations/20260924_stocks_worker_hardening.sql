-- Phase 3 hardening for the automated worker (stocks_automated_worker
-- shipped claim_job/trigger/cron; this fixes two gaps in it).
--
-- 1. Stale-lock window was 90s, but one web-research job can run ~170s+
--    (and /api/engine/run's maxDuration is 300s). The every-minute cron
--    backstop would re-claim a job that is still being worked on and run
--    it twice (double API spend, double credit charge risk). Staleness is
--    now 6 minutes: strictly longer than any live invocation can last.
-- 2. No attempts ceiling at claim time. A job whose invocation is killed
--    every time (timeout, OOM) never reaches the worker's catch block, so
--    it was re-claimed forever — agentor-ai's "109 attempts" incident.
--    Stale jobs at/over max_attempts are now failed here, in SQL.
--
-- Also: only claims job kinds the caller says it can handle
-- (include_web_research=false → only OHLC-only case studies: one_candle,
-- davinci_model). Everything else stays pending for the manual
-- /build-studies path until the hosted web_search output is validated.
-- Jobs claimed by the manual CLI (`npm run engine -- claim`) have
-- locked_at NULL and are never stolen by the automated worker.

DROP FUNCTION IF EXISTS stocks.claim_job(INTERVAL);

CREATE OR REPLACE FUNCTION stocks.claim_job(
  stale_after INTERVAL DEFAULT '6 minutes',
  max_attempts INT DEFAULT 3,
  include_web_research BOOLEAN DEFAULT false
)
RETURNS stocks.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  claimed stocks.jobs;
BEGIN
  -- Dead-lettering: stale, out of attempts → error (and its study too).
  WITH dead AS (
    UPDATE stocks.jobs
    SET status = 'error',
        result = 'Worker invocation died ' || attempts || ' times (timeout or crash) — giving up',
        updated_at = now()
    WHERE status = 'running'
      AND locked_at IS NOT NULL
      AND locked_at < now() - stale_after
      AND attempts >= max_attempts
    RETURNING id, payload
  )
  UPDATE stocks.case_studies cs
  SET status = 'error', error = 'Automated worker gave up after repeated timeouts', updated_at = now()
  FROM dead
  WHERE cs.id = (dead.payload->>'case_study_id')::bigint;

  SELECT j.* INTO claimed
  FROM stocks.jobs j
  LEFT JOIN stocks.case_studies cs ON cs.id = (j.payload->>'case_study_id')::bigint
  WHERE (
      j.status = 'pending'
      OR (j.status = 'running' AND j.locked_at IS NOT NULL AND j.locked_at < now() - stale_after)
    )
    AND (
      include_web_research
      OR (j.type = 'build_case_study' AND cs.variant IN ('one_candle', 'davinci_model'))
    )
  ORDER BY j.created_at
  FOR UPDATE OF j SKIP LOCKED
  LIMIT 1;

  IF claimed.id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE stocks.jobs
  SET status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
  WHERE id = claimed.id
  RETURNING * INTO claimed;

  UPDATE stocks.case_studies
  SET status = 'building', updated_at = now()
  WHERE id = (claimed.payload->>'case_study_id')::bigint;

  RETURN claimed;
END;
$$;

-- New functions are EXECUTE-able by PUBLIC by default — revoke in the same
-- migration that creates them (agentor-ai's anon-EXECUTE incident).
REVOKE ALL ON FUNCTION stocks.claim_job(INTERVAL, INT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stocks.claim_job(INTERVAL, INT, BOOLEAN) TO service_role, stocks_app;

-- Trigger functions aren't callable directly, but keep the ACL tight anyway.
REVOKE ALL ON FUNCTION stocks.notify_job_inserted() FROM PUBLIC, anon, authenticated;
