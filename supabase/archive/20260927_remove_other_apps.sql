-- The Supabase project (formerly "Vam-dashboard") now belongs to Stock
-- Studio alone. Removes the other apps that shared it, at the owner's
-- request: Facebook Ads Studio (fbads schema + fbads_app role), the
-- visibility auditor (public.vis_* + its cron job and vault secrets), and
-- the old VAM dashboard (remaining public tables/functions). Checked
-- beforehand: no stocks object, policy, trigger or login depends on any of it.

-- Visibility auditor's every-minute backstop.
SELECT cron.unschedule('vis-engine-drain-backstop')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vis-engine-drain-backstop');
DELETE FROM cron.job_run_details WHERE jobid NOT IN (SELECT jobid FROM cron.job);
DELETE FROM vault.secrets WHERE name IN ('vis_engine_webhook_url', 'vis_engine_webhook_secret');

-- Facebook Ads Studio.
DROP SCHEMA IF EXISTS fbads CASCADE;
-- Once its schema is gone the role owns nothing and holds no grants, so it
-- can be dropped directly (applied as a separate step: DROP OWNED BY needs
-- the role's privileges, which the admin login doesn't inherit).
DROP ROLE IF EXISTS fbads_app;

-- Visibility auditor and the old dashboard: every table and function in
-- public (the schema itself stays, as Supabase expects it).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      -- leave extension-owned functions alone
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.sig);
  END LOOP;
END $$;
