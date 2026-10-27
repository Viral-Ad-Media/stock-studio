-- The hosted worker is woken by the engine cron about every 30 minutes (each
-- invocation lands on a freshly woken Render instance), so a 10-minute
-- silence threshold flapped engine_down open and closed every half hour.
-- 45 minutes allows one missed wake-up before alerting.
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
 n int;
 oldest timestamptz;
 detail text;
BEGIN
 SELECT * INTO engine FROM stocks.ops_heartbeats h WHERE h.component = 'engine';
 SELECT * INTO bot FROM stocks.ops_heartbeats h WHERE h.component = 'signal-bot';
 -- Which jobs the worker is expected to take (ENGINE_WEB_RESEARCH, reported
 -- in its heartbeat). Jobs it never claims are left for the manual path.
 web_research := coalesce((engine.detail->>'web_research')::boolean, false);

 -- Jobs held because the Anthropic account can't run (no credit, bad key…).
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
