-- SR 11-7 model-risk controls:
-- 1. Provenance & cost columns on setup_scans (data_source, usage_json, cost_usd)
--    and case_studies (data_source) for R6 / R9 / Gap 8.
-- 2. Outcome-tracking ledger stocks.setup_study_plans for OHLC setup studies
--    (one_candle, davinci_model) for R2 / SS-02.
-- 3. Daily Anthropic USD spend ceiling alerts (daily_spend_warning at 70%,
--    daily_spend_cap at 100%) in stocks.ops_health_issues() for R4 / SS-11.

ALTER TABLE stocks.setup_scans
  ADD COLUMN IF NOT EXISTS data_source TEXT CHECK (data_source IS NULL OR data_source IN ('yahoo', 'alpaca', 'mixed')),
  ADD COLUMN IF NOT EXISTS usage_json JSONB,
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10, 6);

ALTER TABLE stocks.case_studies
  ADD COLUMN IF NOT EXISTS data_source TEXT CHECK (
    data_source IS NULL OR data_source IN ('yahoo', 'alpaca', 'mixed', 'web_search', 'manual')
  );

CREATE TABLE IF NOT EXISTS stocks.setup_study_plans (
  id BIGSERIAL PRIMARY KEY,
  case_study_id BIGINT NOT NULL UNIQUE REFERENCES stocks.case_studies(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES stocks.workspaces(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('one_candle', 'davinci_model')),
  session_date TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
  entry_price NUMERIC NOT NULL CHECK (entry_price > 0),
  stop_price NUMERIC NOT NULL CHECK (stop_price > 0),
  target_price NUMERIC NOT NULL CHECK (target_price > 0),
  horizon_sessions INT NOT NULL DEFAULT 5 CHECK (horizon_sessions BETWEEN 1 AND 60),
  resolved_at TIMESTAMPTZ,
  exit_date TEXT,
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('target', 'stop', 'expired', 'ambiguous')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_setup_study_plans_open
  ON stocks.setup_study_plans(ticker, session_date) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_setup_study_plans_workspace
  ON stocks.setup_study_plans(workspace_id);

ALTER TABLE stocks.setup_study_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workspace setup study plans" ON stocks.setup_study_plans;
CREATE POLICY "workspace setup study plans" ON stocks.setup_study_plans
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM stocks.workspace_members m
      WHERE m.workspace_id = setup_study_plans.workspace_id
        AND m.user_id = auth.uid()
    )
  );

REVOKE ALL ON stocks.setup_study_plans FROM PUBLIC, anon, authenticated, stocks_signals;
GRANT SELECT, INSERT, UPDATE, DELETE ON stocks.setup_study_plans TO stocks_app;

REVOKE ALL ON SEQUENCE stocks.setup_study_plans_id_seq FROM PUBLIC, anon, authenticated, stocks_signals;
GRANT USAGE, SELECT ON SEQUENCE stocks.setup_study_plans_id_seq TO stocks_app;

-- Keep the exact 5-parameter signature so existing callers and ACLs remain
-- unambiguous; read daily_spend_cap_usd from the engine heartbeat detail
-- (default $25.00 UTC/day; set <= 0 in detail to disable).
CREATE OR REPLACE FUNCTION stocks.ops_health_issues(
  engine_silent_after interval DEFAULT '45 minutes',
  job_late_after interval DEFAULT '20 minutes',
  failures_per_hour int DEFAULT 3,
  delivery_late_after interval DEFAULT '5 minutes',
  bot_silent_after interval DEFAULT '5 minutes'
)
RETURNS TABLE (key text, severity text, summary text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = stocks, public AS $$
DECLARE
  engine stocks.ops_heartbeats;
  bot stocks.ops_heartbeats;
  web_research boolean;
  spend_cap numeric;
  today_spend numeric;
  utc_day_start timestamptz;
  n int;
  oldest timestamptz;
  detail text;
BEGIN
  SELECT * INTO engine FROM stocks.ops_heartbeats h WHERE h.component = 'engine';
  SELECT * INTO bot FROM stocks.ops_heartbeats h WHERE h.component = 'signal-bot';
  -- Which jobs the worker is expected to take (ENGINE_WEB_RESEARCH, reported
  -- in its heartbeat). Jobs it never claims are left for the manual path.
  web_research := coalesce((engine.detail->>'web_research')::boolean, false);
  spend_cap := coalesce((engine.detail->>'daily_spend_cap_usd')::numeric, 25.0);
  utc_day_start := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  -- Daily Anthropic USD spend ceiling across jobs and setup-bot desk notes (R4).
  IF spend_cap > 0 THEN
    SELECT
      coalesce((SELECT sum(j.cost_usd) FROM stocks.jobs j WHERE j.cost_usd IS NOT NULL AND j.updated_at >= utc_day_start), 0)
      + coalesce((SELECT sum(sc.cost_usd) FROM stocks.setup_scans sc WHERE sc.cost_usd IS NOT NULL AND sc.finished_at >= utc_day_start), 0)
    INTO today_spend;

    IF today_spend >= spend_cap THEN
      key := 'daily_spend_cap'; severity := 'critical';
      summary := format(
        'Daily Anthropic spend reached $%s of the $%s UTC cap; automated queue claims are held until 00:00 UTC or cap adjustment.',
        to_char(round(today_spend, 2), 'FM999990.00'),
        to_char(round(spend_cap, 2), 'FM999990.00')
      );
      RETURN NEXT;
    ELSIF today_spend >= spend_cap * 0.7 THEN
      key := 'daily_spend_warning'; severity := 'warning';
      summary := format(
        'Daily Anthropic spend is at $%s (%s%% of the $%s UTC cap).',
        to_char(round(today_spend, 2), 'FM999990.00'),
        round((today_spend / spend_cap) * 100),
        to_char(round(spend_cap, 2), 'FM999990.00')
      );
      RETURN NEXT;
    END IF;
  END IF;

  -- Jobs held because the Anthropic account can't run (no credit, bad key, or daily cap…).
  SELECT count(*), min(j.created_at), min(j.result) INTO n, oldest, detail
  FROM stocks.jobs j WHERE j.status = 'pending' AND j.result LIKE 'waiting for the engine:%';
  IF n > 0 THEN
    key := 'engine_unavailable'; severity := 'critical';
    summary := format('%s job(s) are on hold because the research engine can''t run: %s', n, left(regexp_replace(detail, '^waiting for the engine:\s*', ''), 300));
    RETURN NEXT;
  END IF;

  -- The worker hasn't been invoked (host down, Vault URL/secret wrong, cron stopped).
  IF engine.component IS NOT NULL AND engine.beat_at < now() - engine_silent_after THEN
    key := 'engine_down'; severity := 'critical';
    summary := format('The research worker hasn''t run since %s UTC (%s min ago). Check the web service and the engine cron.',
      to_char(engine.beat_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'), floor(extract(epoch FROM now() - engine.beat_at) / 60));
    RETURN NEXT;
  END IF;

  -- Jobs the worker should have finished by now.
  SELECT count(*), min(j.created_at) INTO n, oldest
  FROM stocks.jobs j
  LEFT JOIN stocks.case_studies cs ON cs.id = (j.payload->>'case_study_id')::bigint
  WHERE j.status IN ('pending','running')
    AND j.created_at < now() - job_late_after
    AND coalesce(j.result, '') NOT LIKE 'waiting for the engine:%'
    AND (web_research OR (j.type = 'build_case_study' AND cs.variant IN ('one_candle','davinci_model')));
  IF n > 0 THEN
    key := 'jobs_delayed'; severity := CASE WHEN engine.component IS NULL THEN 'critical' ELSE 'warning' END;
    summary := format('%s report(s) still not built; the oldest was queued %s min ago.%s',
      n, floor(extract(epoch FROM now() - oldest) / 60),
      CASE WHEN engine.component IS NULL THEN ' The worker has never checked in.' ELSE '' END);
    RETURN NEXT;
  END IF;

  SELECT count(*), max(j.result) INTO n, detail
  FROM stocks.jobs j WHERE j.status = 'error' AND j.updated_at > now() - interval '1 hour';
  IF n >= failures_per_hour THEN
    key := 'jobs_failing'; severity := 'warning';
    summary := format('%s reports failed (and were refunded) in the last hour. Latest error: %s', n, left(detail, 300));
    RETURN NEXT;
  END IF;

  SELECT count(*), min(s.posted_at), (array_agg(o.last_error ORDER BY o.signal_id) FILTER (WHERE o.last_error IS NOT NULL))[1]
  INTO n, oldest, detail
  FROM stocks.signal_outbox o JOIN stocks.signals s ON s.id = o.signal_id
  WHERE o.delivered_at IS NULL AND s.posted_at < now() - delivery_late_after;
  IF n > 0 THEN
    key := 'signal_delivery_delayed'; severity := 'critical';
    summary := format('%s signal(s) not delivered to Discord; the oldest was posted %s min ago.%s',
      n, floor(extract(epoch FROM now() - oldest) / 60),
      CASE WHEN detail IS NOT NULL THEN ' Last error: ' || left(detail, 300) ELSE '' END);
    RETURN NEXT;
  END IF;

  -- Only once the bot has checked in at least once, so an undeployed bot is quiet.
  -- To retire the bot: DELETE FROM stocks.ops_heartbeats WHERE component = 'signal-bot'.
  IF bot.component IS NOT NULL AND bot.beat_at < now() - bot_silent_after THEN
    key := 'signal_bot_down'; severity := 'critical';
    summary := format('The Discord signal bot hasn''t checked in since %s UTC (%s min ago).',
      to_char(bot.beat_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'), floor(extract(epoch FROM now() - bot.beat_at) / 60));
    RETURN NEXT;
  END IF;
END $$;
