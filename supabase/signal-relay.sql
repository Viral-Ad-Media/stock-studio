-- Hosted Discord signal relay, run once as the database owner after the
-- signal-relay edge function is deployed (supabase/functions/signal-relay/README.md).
-- Needs pg_net and pg_cron (already enabled for worker-automation.sql).
--
-- 1. Store the function URL and the shared secret in Vault. Never commit them:
--      SELECT vault.create_secret('https://<project-ref>.supabase.co/functions/v1/signal-relay', 'signal_relay_url');
--      SELECT vault.create_secret('<same value as SIGNAL_RELAY_SECRET>', 'signal_relay_secret');
-- 2. Run this file. Every minute pg_cron asks the function for one relay pass.
-- 3. Check: SELECT status_code, left(content, 200) FROM net._http_response ORDER BY created DESC LIMIT 5;
-- To stop: SELECT cron.unschedule('stocks-signal-relay');
CREATE OR REPLACE FUNCTION stocks.request_signal_relay() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=stocks,public AS $$
DECLARE endpoint text; secret text;
BEGIN
 SELECT decrypted_secret INTO endpoint FROM vault.decrypted_secrets WHERE name='signal_relay_url' LIMIT 1;
 SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='signal_relay_secret' LIMIT 1;
 IF endpoint IS NULL OR secret IS NULL THEN RAISE EXCEPTION 'Configure signal relay Vault secrets first'; END IF;
 PERFORM net.http_post(url:=endpoint, body:='{}'::jsonb,
  headers:=jsonb_build_object('Content-Type','application/json','x-relay-secret',secret),
  timeout_milliseconds:=55000);
END $$;
REVOKE ALL ON FUNCTION stocks.request_signal_relay() FROM PUBLIC,anon,authenticated,stocks_app,stocks_signals;
DO $$ DECLARE existing bigint; BEGIN
 FOR existing IN SELECT jobid FROM cron.job WHERE jobname='stocks-signal-relay' LOOP
  PERFORM cron.unschedule(existing);
 END LOOP;
 PERFORM cron.schedule('stocks-signal-relay','* * * * *','SELECT stocks.request_signal_relay()');
END $$;
