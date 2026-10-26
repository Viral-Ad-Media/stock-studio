-- Operator alerts for worker outages and delayed deliveries.
--
-- Checks run inside the database (pg_cron, see supabase/ops-alerts.sql), so an
-- alert still fires when the web host itself is down, asleep or misconfigured.
-- The worker and the signal bot write heartbeats; stocks.ops_health_issues()
-- turns heartbeats, the jobs queue and the signal outbox into open issues;
-- stocks.ops_alert_sweep() remembers which issues were already announced so
-- each one is posted once when it opens, reminded while it lasts, and posted
-- again when it resolves.

CREATE TABLE stocks.ops_heartbeats (
 component text PRIMARY KEY CHECK (component IN ('engine','signal-bot')),
 beat_at timestamptz NOT NULL DEFAULT now(),
 detail jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE stocks.ops_alerts (
 key text PRIMARY KEY,
 severity text NOT NULL CHECK (severity IN ('critical','warning')),
 summary text NOT NULL,
 opened_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 notified_at timestamptz,
 resolved_at timestamptz
);
ALTER TABLE stocks.ops_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocks.ops_alerts ENABLE ROW LEVEL SECURITY;
-- Default privileges hand stocks_app full DML on new tables; it only reads these.
REVOKE ALL ON stocks.ops_heartbeats, stocks.ops_alerts FROM PUBLIC, anon, authenticated, stocks_app, stocks_signals;
GRANT SELECT ON stocks.ops_heartbeats, stocks.ops_alerts TO stocks_app;

-- One function per component, so each role can only vouch for itself.
CREATE FUNCTION stocks.engine_heartbeat(p_detail jsonb DEFAULT '{}')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = stocks, public AS $$
 INSERT INTO stocks.ops_heartbeats(component, beat_at, detail) VALUES ('engine', now(), coalesce(p_detail, '{}'))
 ON CONFLICT (component) DO UPDATE SET beat_at = excluded.beat_at, detail = excluded.detail;
$$;
CREATE FUNCTION stocks.signal_bot_heartbeat(p_detail jsonb DEFAULT '{}')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = stocks, public AS $$
 INSERT INTO stocks.ops_heartbeats(component, beat_at, detail) VALUES ('signal-bot', now(), coalesce(p_detail, '{}'))
 ON CONFLICT (component) DO UPDATE SET beat_at = excluded.beat_at, detail = excluded.detail;
$$;
REVOKE ALL ON FUNCTION stocks.engine_heartbeat(jsonb), stocks.signal_bot_heartbeat(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stocks.engine_heartbeat(jsonb) TO stocks_app, service_role;
GRANT EXECUTE ON FUNCTION stocks.signal_bot_heartbeat(jsonb) TO stocks_signals, service_role;

-- Everything wrong right now, one row per issue. Thresholds are arguments so
-- tests (and a one-off manual check) can tighten them.
CREATE FUNCTION stocks.ops_health_issues(
 engine_silent_after interval DEFAULT '10 minutes',
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

-- Reconciles current issues with remembered alerts and returns only what
-- should be announced now: 'opened', 'reminder' (still open after
-- remind_every) or 'resolved'.
CREATE FUNCTION stocks.ops_alert_sweep(remind_every interval DEFAULT '3 hours')
RETURNS TABLE (kind text, key text, severity text, summary text, opened_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = stocks, public AS $$
#variable_conflict use_column
BEGIN
 -- One sweep at a time, so overlapping cron runs can't double-post.
 PERFORM pg_advisory_xact_lock(hashtext('stocks.ops_alert_sweep'));
 CREATE TEMP TABLE IF NOT EXISTS ops_current (key text PRIMARY KEY, severity text, summary text) ON COMMIT DROP;
 TRUNCATE ops_current;
 INSERT INTO ops_current SELECT i.key, i.severity, i.summary FROM stocks.ops_health_issues() i;

 RETURN QUERY
 WITH resolved AS (
  UPDATE stocks.ops_alerts a SET resolved_at = now()
  WHERE a.resolved_at IS NULL AND NOT EXISTS (SELECT FROM ops_current c WHERE c.key = a.key)
  RETURNING a.key, a.severity, a.summary, a.opened_at
 )
 SELECT 'resolved', r.key, r.severity, r.summary, r.opened_at FROM resolved r;

 -- A resolved key that comes back opens a fresh alert.
 DELETE FROM stocks.ops_alerts a USING ops_current c WHERE a.key = c.key AND a.resolved_at IS NOT NULL;
 INSERT INTO stocks.ops_alerts AS a (key, severity, summary)
 SELECT c.key, c.severity, c.summary FROM ops_current c
 ON CONFLICT (key) DO UPDATE SET severity = excluded.severity, summary = excluded.summary, last_seen_at = now();
 RETURN QUERY
 UPDATE stocks.ops_alerts a SET notified_at = now()
 FROM (SELECT o.key, o.notified_at AS prev FROM stocks.ops_alerts o JOIN ops_current c ON c.key = o.key) p
 WHERE a.key = p.key AND (p.prev IS NULL OR p.prev < now() - remind_every)
 RETURNING CASE WHEN p.prev IS NULL THEN 'opened' ELSE 'reminder' END, a.key, a.severity, a.summary, a.opened_at;

 -- Keep a short history of resolved alerts for the admin page.
 DELETE FROM stocks.ops_alerts a WHERE a.resolved_at < now() - interval '30 days';
END $$;

-- Posts what the sweep returns to a Discord webhook stored in Vault as
-- ops_alert_webhook_url. Portable like notify_job_inserted: without Vault or
-- pg_net (or without the secret) it still sweeps, so the admin page stays
-- current, and just doesn't post.
CREATE FUNCTION stocks.send_ops_alerts()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = stocks, public AS $$
DECLARE
 hook text; app_url text; lines text[] := '{}'; a record; body text; sent int := 0;
BEGIN
 FOR a IN SELECT * FROM stocks.ops_alert_sweep() ORDER BY (kind = 'resolved'), severity, key LOOP
  lines := lines || CASE a.kind
   WHEN 'opened' THEN format('%s **%s** %s', CASE WHEN a.severity = 'critical' THEN '🔴' ELSE '🟠' END, a.key, a.summary)
   WHEN 'reminder' THEN format('🔁 **%s** still open since %s UTC: %s', a.key, to_char(a.opened_at AT TIME ZONE 'UTC', 'MM-DD HH24:MI'), a.summary)
   ELSE format('✅ **%s** resolved (open since %s UTC).', a.key, to_char(a.opened_at AT TIME ZONE 'UTC', 'MM-DD HH24:MI'))
  END;
 END LOOP;
 IF cardinality(lines) = 0 THEN RETURN 0; END IF;
 IF to_regclass('vault.decrypted_secrets') IS NULL OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN RETURN 0; END IF;
 EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1 LIMIT 1' INTO hook USING 'ops_alert_webhook_url';
 IF hook IS NULL THEN RETURN 0; END IF;
 -- The admin link reuses the worker URL already in Vault; no extra setting.
 EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1 LIMIT 1' INTO app_url USING 'engine_webhook_url';
 app_url := substring(app_url FROM '^(https?://[^/]+)');
 body := left(array_to_string(lines, E'\n'), 1800)
  || CASE WHEN app_url IS NOT NULL THEN E'\n' || app_url || '/admin/system' ELSE '' END;
 EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3)'
  USING hook,
   jsonb_build_object('username', 'Stock Studio alerts', 'content', '**Stock Studio** ' || E'\n' || body, 'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)),
   jsonb_build_object('Content-Type', 'application/json');
 sent := cardinality(lines);
 RETURN sent;
END $$;

REVOKE ALL ON FUNCTION stocks.ops_health_issues(interval, interval, int, interval, interval), stocks.ops_alert_sweep(interval), stocks.send_ops_alerts()
 FROM PUBLIC, anon, authenticated, stocks_app, stocks_signals;
GRANT EXECUTE ON FUNCTION stocks.ops_health_issues(interval, interval, int, interval, interval) TO stocks_app, service_role;
GRANT EXECUTE ON FUNCTION stocks.ops_alert_sweep(interval), stocks.send_ops_alerts() TO service_role;
