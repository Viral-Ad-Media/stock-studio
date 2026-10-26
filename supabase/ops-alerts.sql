-- Optional hosted alert setup, run once as the database owner after the
-- 20261026150000_ops_alerts migration. Needs pg_net and pg_cron (already
-- enabled for worker-automation.sql).
--
-- 1. Create a Discord webhook (channel settings → Integrations → Webhooks) in
--    a private ops channel and store its URL in Vault. Never commit it:
--      SELECT vault.create_secret('<webhook url>', 'ops_alert_webhook_url');
--    To rotate: SELECT vault.update_secret(id, '<new url>') FROM vault.secrets
--    WHERE name = 'ops_alert_webhook_url';
-- 2. Run this file. Every 5 minutes it posts newly opened alerts, a reminder
--    every 3 hours while one stays open, and a line when each one resolves.
-- 3. Test: SELECT * FROM stocks.ops_health_issues(); shows what is open now.
DO $$ DECLARE existing bigint; BEGIN
 FOR existing IN SELECT jobid FROM cron.job WHERE jobname = 'stocks-ops-alerts' LOOP
  PERFORM cron.unschedule(existing);
 END LOOP;
 PERFORM cron.schedule('stocks-ops-alerts', '*/5 * * * *', 'SELECT stocks.send_ops_alerts()');
END $$;
