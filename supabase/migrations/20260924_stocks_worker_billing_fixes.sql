-- Worker/billing correctness fixes from the ECC review.
--
-- 1. claim_job dead-letters jobs whose invocation died max_attempts times —
--    but never refunded them (the worker's failJob never runs for a killed
--    invocation). It now refunds each dead-lettered job, and writes a
--    customer-facing message to the study instead of an internal one.
-- 2. At most one open (pending/running) refresh per watchlist row and one open
--    movers digest per workspace, enforced by partial unique indexes: the
--    app's check-then-insert allowed double-click double charges.
-- 3. A dedicated stocks_billing role for the Stripe webhook. Only it may call
--    fulfill_checkout / refund_payment; stocks_app loses EXECUTE on both, so
--    the app's DATABASE_URL can no longer mint credits or access.
--    The role is created WITHOUT a password (it cannot log in yet). Set one
--    out-of-band in the Supabase SQL editor:
--      ALTER ROLE stocks_billing WITH PASSWORD '<generated>';
--    and give the webhook BILLING_DATABASE_URL (pooler user
--    stocks_billing.<project-ref>). Never commit the password.

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
  dead RECORD;
BEGIN
  -- Dead-lettering: stale, out of attempts → error, refund, study error.
  FOR dead IN
    UPDATE stocks.jobs
    SET status = 'error',
        result = 'Worker invocation died ' || attempts || ' times (timeout or crash) — giving up',
        updated_at = now()
    WHERE status = 'running'
      AND locked_at IS NOT NULL
      AND locked_at < now() - stale_after
      AND attempts >= max_attempts
    RETURNING id, payload
  LOOP
    UPDATE stocks.case_studies
    SET status = 'error',
        error = 'We couldn''t build this report. Your credits have been refunded.',
        updated_at = now()
    WHERE id = (dead.payload->>'case_study_id')::bigint;
    PERFORM stocks.refund_job_credits(dead.id);
  END LOOP;

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
REVOKE ALL ON FUNCTION stocks.claim_job(INTERVAL, INT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stocks.claim_job(INTERVAL, INT, BOOLEAN) TO service_role, stocks_app;

CREATE UNIQUE INDEX jobs_one_open_watchlist_refresh
  ON stocks.jobs (workspace_id, (payload->>'watchlist_id'))
  WHERE type = 'watchlist_entry' AND status IN ('pending', 'running');
CREATE UNIQUE INDEX jobs_one_open_movers_digest
  ON stocks.jobs (workspace_id)
  WHERE type = 'movers_digest' AND status IN ('pending', 'running');

CREATE ROLE stocks_billing LOGIN NOINHERIT;
GRANT USAGE ON SCHEMA stocks TO stocks_billing;
REVOKE EXECUTE ON FUNCTION stocks.fulfill_checkout(TEXT, TEXT, UUID, UUID, TEXT, INT, INT) FROM stocks_app;
REVOKE EXECUTE ON FUNCTION stocks.refund_payment(TEXT) FROM stocks_app;
GRANT EXECUTE ON FUNCTION stocks.fulfill_checkout(TEXT, TEXT, UUID, UUID, TEXT, INT, INT) TO stocks_billing;
GRANT EXECUTE ON FUNCTION stocks.refund_payment(TEXT) TO stocks_billing;
