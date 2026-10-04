-- Optional hosted-worker setup. Enable pg_net and pg_cron in Supabase first;
-- configure engine_webhook_url and engine_webhook_secret through Vault.
-- This script reads secrets only inside the server, never returns them.
CREATE OR REPLACE FUNCTION stocks.request_engine_drain() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=stocks,public AS $$
DECLARE endpoint text; secret text;
BEGIN
 SELECT decrypted_secret INTO endpoint FROM vault.decrypted_secrets WHERE name='engine_webhook_url' LIMIT 1;
 SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='engine_webhook_secret' LIMIT 1;
 IF endpoint IS NULL OR secret IS NULL THEN RAISE EXCEPTION 'Configure worker Vault secrets first'; END IF;
 PERFORM net.http_post(url:=endpoint,body:='{}'::jsonb,
 headers:=jsonb_build_object('Content-Type','application/json','x-engine-secret',secret));
END $$;
REVOKE ALL ON FUNCTION stocks.request_engine_drain() FROM PUBLIC,anon,authenticated,stocks_app;
-- Replace any existing named backstop, without touching other applications.
DO $$ DECLARE existing bigint; BEGIN
 FOR existing IN SELECT jobid FROM cron.job WHERE jobname='stocks-engine-drain-backstop' LOOP
  PERFORM cron.unschedule(existing);
 END LOOP;
 PERFORM cron.schedule('stocks-engine-drain-backstop','* * * * *','SELECT stocks.request_engine_drain()');
END $$;
