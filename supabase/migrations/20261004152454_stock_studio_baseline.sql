-- Reconstructed fresh-install baseline from the application and archived SQL.
-- Existing installations are not rebuilt or grandfathered again. This is a
-- new baseline, not an assertion that missing historical files were recovered.
DO $baseline$
DECLARE required_table text;
BEGIN
 IF to_regnamespace('stocks') IS NOT NULL THEN
  FOREACH required_table IN ARRAY ARRAY['workspaces','workspace_members','profiles','case_studies','watchlist','jobs','credits_ledger','payments','watchlist_history','setup_scans','setup_matches','platform_admins','admin_audit','signals','signal_deliveries'] LOOP
   IF to_regclass('stocks.' || required_table) IS NULL THEN
    RAISE EXCEPTION 'Partial stocks schema (missing %): restore/repair the historical schema before applying this baseline', required_table;
   END IF;
  END LOOP;
  RETURN;
 END IF;
 EXECUTE $definition$

CREATE SCHEMA stocks;
DO $roles$ BEGIN
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='stocks_app') THEN
 CREATE ROLE stocks_app LOGIN NOINHERIT BYPASSRLS;
END IF;
END $roles$;
ALTER ROLE stocks_app SET search_path = stocks, public;
GRANT USAGE ON SCHEMA stocks TO stocks_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA stocks GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO stocks_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA stocks GRANT USAGE, SELECT ON SEQUENCES TO stocks_app;
CREATE TABLE stocks.workspaces (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE stocks.workspace_members (workspace_id uuid NOT NULL REFERENCES stocks.workspaces ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE, role text NOT NULL DEFAULT 'member' CHECK(role IN ('owner','admin','member')), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,user_id));
CREATE INDEX workspace_members_user_idx ON stocks.workspace_members(user_id);
CREATE TABLE stocks.profiles (id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE, active_workspace_id uuid REFERENCES stocks.workspaces, trial_ends_at timestamptz NOT NULL DEFAULT now()+interval '30 days', access_granted boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION stocks.is_workspace_member(p_workspace uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=stocks,public AS $member$ SELECT EXISTS (SELECT FROM stocks.workspace_members WHERE workspace_id=p_workspace AND user_id=auth.uid()) $member$;
REVOKE ALL ON FUNCTION stocks.is_workspace_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION stocks.is_workspace_member(uuid) TO authenticated, stocks_app;
CREATE TABLE stocks.case_studies (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES stocks.workspaces ON DELETE CASCADE, ticker text NOT NULL, company text, variant text NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','building','ready','error')), notes text, as_of_date text, content_md text, sources_json jsonb, corrections_md text, error text, parent_id bigint REFERENCES stocks.case_studies ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX case_studies_workspace_idx ON stocks.case_studies(workspace_id,created_at DESC);
CREATE TABLE stocks.watchlist (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES stocks.workspaces ON DELETE CASCADE, ticker text NOT NULL, company text, status_tag text NOT NULL DEFAULT 'watching' CHECK(status_tag IN ('watching','building_conviction','pass')), thesis text, triggers_json jsonb, snapshot text, as_of_date text, case_study_id bigint REFERENCES stocks.case_studies ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,ticker));
CREATE TABLE stocks.jobs (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES stocks.workspaces ON DELETE CASCADE, type text NOT NULL CHECK(type IN ('build_case_study','earnings_update','watchlist_entry','movers_digest')), payload jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','error')), result text, locked_at timestamptz, attempts int NOT NULL DEFAULT 0 CHECK(attempts>=0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX jobs_queue_idx ON stocks.jobs(created_at) WHERE status IN ('pending','running');
CREATE INDEX jobs_workspace_idx ON stocks.jobs(workspace_id);
ALTER TABLE stocks.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocks.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocks.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocks.case_studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocks.watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocks.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY members_read ON stocks.workspaces FOR SELECT USING(stocks.is_workspace_member(id));
CREATE POLICY members_read ON stocks.workspace_members FOR SELECT USING(stocks.is_workspace_member(workspace_id));
CREATE POLICY own_profile ON stocks.profiles FOR SELECT USING(id=auth.uid());
CREATE POLICY members_read ON stocks.case_studies FOR SELECT USING(stocks.is_workspace_member(workspace_id));
CREATE POLICY members_read ON stocks.watchlist FOR SELECT USING(stocks.is_workspace_member(workspace_id));
CREATE POLICY members_read ON stocks.jobs FOR SELECT USING(stocks.is_workspace_member(workspace_id));
-- No API role can mutate the server-managed schema.
REVOKE ALL ON ALL TABLES IN SCHEMA stocks FROM PUBLIC,anon,authenticated;
-- The trigger is portable; pg_net and Vault are configured separately.
CREATE FUNCTION stocks.notify_job_inserted() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=stocks,public AS $notify$
DECLARE endpoint text; secret text;
BEGIN
 IF to_regclass('vault.decrypted_secrets') IS NULL OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN RETURN NEW; END IF;
 EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1 LIMIT 1' INTO endpoint USING 'engine_webhook_url';
 EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1 LIMIT 1' INTO secret USING 'engine_webhook_secret';
 IF endpoint IS NOT NULL AND secret IS NOT NULL THEN
 EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3)' USING endpoint, '{}'::jsonb, jsonb_build_object('Content-Type','application/json','x-engine-secret',secret);
 END IF;
 RETURN NEW;
END $notify$;
CREATE TRIGGER stocks_job_inserted AFTER INSERT ON stocks.jobs FOR EACH ROW EXECUTE FUNCTION stocks.notify_job_inserted();

-- Historical definition: 20260924_stocks_worker_hardening.sql
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

-- Historical definition: 20260924_stocks_billing.sql
-- Phase 4 of the Stock Studio SaaS conversion: Stripe billing, agentor-ai's
-- model — 30-day server-granted trial → one-time access fee → credits,
-- charged per queued report.
--
-- Hard invariant: access_granted and credit balances are never written by
-- ordinary app queries. The stocks_app role loses INSERT/UPDATE/DELETE on
-- the ledger + payments tables and UPDATE on profiles.access_granted /
-- trial_ends_at; the only write paths are the SECURITY DEFINER RPCs below,
-- whose EXECUTE is revoked from PUBLIC/anon/authenticated in this same
-- migration (never leave a new function PUBLIC-executable). The
-- fulfill/refund-payment RPCs are only called from the signature-verified
-- Stripe webhook route.

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
-- Append-only; balance = SUM(delta) per workspace. 1 credit = 1 standard report.
CREATE TABLE stocks.credits_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES stocks.workspaces(id) ON DELETE CASCADE,
  delta INT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN (
    'trial_grant', 'grandfather', 'purchase', 'purchase_refund', 'job_charge', 'job_refund', 'admin_adjust'
  )),
  -- Idempotency key: 'job:<id>' for charges/refunds, the Checkout Session id
  -- for purchases. One row per (reason, ref) — a replay is a no-op.
  ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_credits_ledger_workspace ON stocks.credits_ledger(workspace_id);
CREATE UNIQUE INDEX credits_ledger_reason_ref_key ON stocks.credits_ledger(reason, ref) WHERE ref IS NOT NULL;

-- Stripe audit trail + webhook idempotency (unique stripe_session_id).
CREATE TABLE stocks.payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES stocks.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('access', 'credits')),
  amount_cents INT NOT NULL,
  credits INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  refunded_at TIMESTAMPTZ
);
CREATE INDEX idx_payments_workspace ON stocks.payments(workspace_id);
CREATE INDEX idx_payments_payment_intent ON stocks.payments(stripe_payment_intent);

ALTER TABLE stocks.credits_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocks.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members read" ON stocks.credits_ledger FOR SELECT
  USING (stocks.is_workspace_member(workspace_id));
CREATE POLICY "workspace members read" ON stocks.payments FOR SELECT
  USING (stocks.is_workspace_member(workspace_id));
-- Deliberately no write policies — never add a client write policy here.

-- ---------------------------------------------------------------------
-- Privileges: the app role reads, never writes, billing state directly.
-- ---------------------------------------------------------------------
REVOKE ALL ON stocks.credits_ledger, stocks.payments FROM PUBLIC, anon, authenticated, stocks_app;
GRANT SELECT ON stocks.credits_ledger, stocks.payments TO stocks_app;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON stocks.profiles FROM stocks_app;
GRANT UPDATE (active_workspace_id, updated_at) ON stocks.profiles TO stocks_app;

-- ---------------------------------------------------------------------
-- Grandfathering: this migration must never lock an existing, actively
-- used account out of its own app.
-- ---------------------------------------------------------------------
UPDATE stocks.profiles SET access_granted = true, updated_at = now();
INSERT INTO stocks.credits_ledger (workspace_id, delta, reason, ref)
SELECT id, 100, 'grandfather', 'grandfather:' || id FROM stocks.workspaces;

-- ---------------------------------------------------------------------
-- New signups: same server-granted trial as before, plus starter credits
-- so the trial is actually usable (not a paywall around a paywall).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stocks.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  ws_id UUID;
BEGIN
  INSERT INTO stocks.workspaces (name) VALUES (COALESCE(NEW.email, 'My workspace'))
  RETURNING id INTO ws_id;

  INSERT INTO stocks.workspace_members (workspace_id, user_id, role)
  VALUES (ws_id, NEW.id, 'owner');

  -- Literal interval — never read from client signup metadata.
  INSERT INTO stocks.profiles (id, active_workspace_id, trial_ends_at, access_granted)
  VALUES (NEW.id, ws_id, now() + interval '30 days', false);

  INSERT INTO stocks.credits_ledger (workspace_id, delta, reason, ref)
  VALUES (ws_id, 5, 'trial_grant', 'trial:' || NEW.id);

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION stocks.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- RPCs — the only write paths into billing state.
-- ---------------------------------------------------------------------

-- Charged at queue time, inside the same transaction as the job INSERT: if
-- the balance is short this raises (SQLSTATE SS402) and the job never exists.
-- Serialised per workspace with an advisory lock so two concurrent queues
-- can't both spend the last credit.
CREATE OR REPLACE FUNCTION stocks.charge_job_credits(p_job_id BIGINT, p_cost INT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  ws UUID;
  bal INT;
BEGIN
  IF p_cost <= 0 THEN
    RAISE EXCEPTION 'cost must be positive';
  END IF;
  SELECT workspace_id INTO ws FROM stocks.jobs WHERE id = p_job_id;
  IF ws IS NULL THEN
    RAISE EXCEPTION 'job % not found', p_job_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('stocks_credits:' || ws::text));
  SELECT COALESCE(SUM(delta), 0) INTO bal FROM stocks.credits_ledger WHERE workspace_id = ws;
  IF bal < p_cost THEN
    RAISE EXCEPTION 'Not enough credits: % available, % needed', bal, p_cost USING ERRCODE = 'SS402';
  END IF;

  INSERT INTO stocks.credits_ledger (workspace_id, delta, reason, ref)
  VALUES (ws, -p_cost, 'job_charge', 'job:' || p_job_id)
  ON CONFLICT DO NOTHING;
  RETURN bal - p_cost;
END;
$$;

-- Returns a failed or user-cancelled job's charge. Idempotent: the worker,
-- the manual CLI's `fail`, and queue deletion can all call it safely.
CREATE OR REPLACE FUNCTION stocks.refund_job_credits(p_job_id BIGINT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  charge stocks.credits_ledger;
  inserted INT;
BEGIN
  SELECT * INTO charge FROM stocks.credits_ledger
  WHERE reason = 'job_charge' AND ref = 'job:' || p_job_id;
  IF charge.id IS NULL THEN
    RETURN 0; -- never charged (operator-queued / pre-billing job)
  END IF;

  INSERT INTO stocks.credits_ledger (workspace_id, delta, reason, ref)
  VALUES (charge.workspace_id, -charge.delta, 'job_refund', charge.ref)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN CASE WHEN inserted > 0 THEN -charge.delta ELSE 0 END;
END;
$$;

-- checkout.session.completed fulfilment, all in one transaction: a webhook
-- replay hits the UNIQUE stripe_session_id and only observes the
-- already-completed result (returns false, grants nothing twice).
CREATE OR REPLACE FUNCTION stocks.fulfill_checkout(
  p_session_id TEXT,
  p_payment_intent TEXT,
  p_workspace_id UUID,
  p_user_id UUID,
  p_kind TEXT,
  p_amount_cents INT,
  p_credits INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  new_id BIGINT;
BEGIN
  IF p_kind NOT IN ('access', 'credits') THEN
    RAISE EXCEPTION 'unknown kind %', p_kind;
  END IF;
  IF p_kind = 'credits' AND COALESCE(p_credits, 0) <= 0 THEN
    RAISE EXCEPTION 'credit purchase with no credits';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM stocks.workspace_members WHERE workspace_id = p_workspace_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'user % is not a member of workspace %', p_user_id, p_workspace_id;
  END IF;

  INSERT INTO stocks.payments
    (workspace_id, user_id, stripe_session_id, stripe_payment_intent, kind, amount_cents, credits)
  VALUES
    (p_workspace_id, p_user_id, p_session_id, p_payment_intent, p_kind, p_amount_cents,
     CASE WHEN p_kind = 'credits' THEN p_credits ELSE 0 END)
  ON CONFLICT (stripe_session_id) DO NOTHING
  RETURNING id INTO new_id;

  IF new_id IS NULL THEN
    RETURN false; -- replay
  END IF;

  IF p_kind = 'access' THEN
    UPDATE stocks.profiles SET access_granted = true, updated_at = now() WHERE id = p_user_id;
  ELSE
    INSERT INTO stocks.credits_ledger (workspace_id, delta, reason, ref)
    VALUES (p_workspace_id, p_credits, 'purchase', p_session_id);
  END IF;
  RETURN true;
END;
$$;

-- charge.refunded (full refunds only): reverses exactly what the payment
-- granted. Access is only revoked if no other completed access payment
-- remains; a credit refund can take the balance negative, which just blocks
-- new jobs until topped up. Idempotent via status + ledger (reason, ref).
CREATE OR REPLACE FUNCTION stocks.refund_payment(p_payment_intent TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  p stocks.payments;
BEGIN
  UPDATE stocks.payments SET status = 'refunded', refunded_at = now()
  WHERE stripe_payment_intent = p_payment_intent AND status = 'completed'
  RETURNING * INTO p;
  IF p.id IS NULL THEN
    RETURN false;
  END IF;

  IF p.kind = 'access' THEN
    IF NOT EXISTS (
      SELECT 1 FROM stocks.payments
      WHERE user_id = p.user_id AND kind = 'access' AND status = 'completed'
    ) THEN
      UPDATE stocks.profiles SET access_granted = false, updated_at = now() WHERE id = p.user_id;
    END IF;
  ELSE
    INSERT INTO stocks.credits_ledger (workspace_id, delta, reason, ref)
    VALUES (p.workspace_id, -p.credits, 'purchase_refund', p.stripe_session_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION stocks.charge_job_credits(BIGINT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stocks.refund_job_credits(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stocks.fulfill_checkout(TEXT, TEXT, UUID, UUID, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stocks.refund_payment(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stocks.charge_job_credits(BIGINT, INT) TO stocks_app, service_role;
GRANT EXECUTE ON FUNCTION stocks.refund_job_credits(BIGINT) TO stocks_app, service_role;
GRANT EXECUTE ON FUNCTION stocks.fulfill_checkout(TEXT, TEXT, UUID, UUID, TEXT, INT, INT) TO stocks_app, service_role;
GRANT EXECUTE ON FUNCTION stocks.refund_payment(TEXT) TO stocks_app, service_role;

-- Historical definition: 20260924_stocks_worker_billing_fixes.sql
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

DO $roles$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='stocks_billing') THEN CREATE ROLE stocks_billing LOGIN NOINHERIT; END IF; END $roles$;
GRANT USAGE ON SCHEMA stocks TO stocks_billing;
REVOKE EXECUTE ON FUNCTION stocks.fulfill_checkout(TEXT, TEXT, UUID, UUID, TEXT, INT, INT) FROM stocks_app;
REVOKE EXECUTE ON FUNCTION stocks.refund_payment(TEXT) FROM stocks_app;
GRANT EXECUTE ON FUNCTION stocks.fulfill_checkout(TEXT, TEXT, UUID, UUID, TEXT, INT, INT) TO stocks_billing;
GRANT EXECUTE ON FUNCTION stocks.refund_payment(TEXT) TO stocks_billing;

-- Historical definition: 20260925_stocks_insights.sql
-- Study grades, interpreting sentences, and thesis tracking (features adapted
-- from QuantEdgeResearch, kept inside Stock Studio's educational framing).
-- Purely additive: code deployed before this migration ignores the new columns.

-- A research-quality grade per study: per-card scores the engine records from
-- the study it just wrote, plus the overall letter computed from them in code
-- (lib/grades.ts). Not a buy/sell rating. Shape:
--   { "overall": "B+", "score": 78, "components": [{ "key", "label", "score", "note" }] }
ALTER TABLE stocks.case_studies
  ADD COLUMN IF NOT EXISTS grade_json JSONB,
  -- One plain-English "what this study says" line for dashboard cards.
  ADD COLUMN IF NOT EXISTS summary_line TEXT;

-- Whether the thesis still holds, as of the entry's last engine refresh.
ALTER TABLE stocks.watchlist
  ADD COLUMN IF NOT EXISTS thesis_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (thesis_status IN ('intact', 'weakening', 'broken', 'unknown')),
  ADD COLUMN IF NOT EXISTS thesis_status_note TEXT;

-- Every thesis the engine has written for a row — the thesis timeline. Filled
-- by the trigger below, so the worker and the manual CLI can't diverge.
CREATE TABLE IF NOT EXISTS stocks.watchlist_history (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES stocks.workspaces(id) ON DELETE CASCADE,
  watchlist_id BIGINT NOT NULL REFERENCES stocks.watchlist(id) ON DELETE CASCADE,
  as_of_date TEXT,
  thesis TEXT NOT NULL,
  snapshot TEXT,
  thesis_status TEXT NOT NULL,
  thesis_status_note TEXT,
  status_tag TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS watchlist_history_row_idx ON stocks.watchlist_history (watchlist_id, id DESC);

ALTER TABLE stocks.watchlist_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members read" ON stocks.watchlist_history FOR SELECT
  USING (stocks.is_workspace_member(workspace_id));

GRANT SELECT, INSERT ON stocks.watchlist_history TO stocks_app;
GRANT USAGE ON SEQUENCE stocks.watchlist_history_id_seq TO stocks_app;

-- SECURITY INVOKER: runs as whoever updated the watchlist row (stocks_app).
CREATE OR REPLACE FUNCTION stocks.record_watchlist_history() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = stocks AS $$
BEGIN
  INSERT INTO stocks.watchlist_history
    (workspace_id, watchlist_id, as_of_date, thesis, snapshot, thesis_status, thesis_status_note, status_tag)
  VALUES
    (NEW.workspace_id, NEW.id, NEW.as_of_date, NEW.thesis, NEW.snapshot, NEW.thesis_status, NEW.thesis_status_note, NEW.status_tag);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION stocks.record_watchlist_history() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS watchlist_history_on_update ON stocks.watchlist;
CREATE TRIGGER watchlist_history_on_update
  AFTER UPDATE OF thesis, thesis_status, as_of_date ON stocks.watchlist
  FOR EACH ROW
  WHEN (NEW.thesis IS NOT NULL AND (
    NEW.thesis IS DISTINCT FROM OLD.thesis
    OR NEW.thesis_status IS DISTINCT FROM OLD.thesis_status
    OR NEW.as_of_date IS DISTINCT FROM OLD.as_of_date))
  EXECUTE FUNCTION stocks.record_watchlist_history();

-- Seed the timeline with each row's current thesis.
INSERT INTO stocks.watchlist_history
  (workspace_id, watchlist_id, as_of_date, thesis, snapshot, thesis_status, thesis_status_note, status_tag, created_at)
SELECT w.workspace_id, w.id, w.as_of_date, w.thesis, w.snapshot, w.thesis_status, w.thesis_status_note, w.status_tag, w.updated_at
FROM stocks.watchlist w
WHERE w.thesis IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM stocks.watchlist_history h WHERE h.watchlist_id = w.id);

-- Historical definition: 20260926_stocks_setup_bots.sql
-- Setup bots (lib/setups.ts): one market-wide scan per completed session, its
-- pattern matches, and each match's paper-tracked outcome. Market data shown
-- identically to every user, so these two tables deliberately have no
-- workspace_id; only stocks_app (and admin roles) can touch them.

CREATE TABLE IF NOT EXISTS stocks.setup_scans (
  id BIGSERIAL PRIMARY KEY,
  session_date TEXT NOT NULL UNIQUE CHECK (session_date ~ '^\d{4}-\d{2}-\d{2}$'),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'error')),
  universe_size INT,
  -- { "<bot key>": "descriptive AI desk note" }; absent when no model call was made.
  notes_json JSONB,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stocks.setup_matches (
  id BIGSERIAL PRIMARY KEY,
  scan_id BIGINT NOT NULL REFERENCES stocks.setup_scans(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL,
  bot TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
  close NUMERIC NOT NULL,
  adj_close NUMERIC NOT NULL,
  spy_adj_close NUMERIC,
  levels_json JSONB NOT NULL,
  invalidation_json JSONB,
  detail TEXT NOT NULL,
  horizon_sessions INT NOT NULL CHECK (horizon_sessions > 0),
  -- Paper tracking, filled once horizon_sessions have passed.
  resolved_at TIMESTAMPTZ,
  exit_date TEXT,
  fwd_return NUMERIC,
  spy_return NUMERIC,
  invalidated BOOLEAN,
  UNIQUE (session_date, bot, symbol)
);
CREATE INDEX IF NOT EXISTS setup_matches_open_idx ON stocks.setup_matches (session_date) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS setup_matches_bot_idx ON stocks.setup_matches (bot, session_date DESC);

-- Defense in depth: RLS on with no policies — the API roles see nothing.
ALTER TABLE stocks.setup_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocks.setup_matches ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON stocks.setup_scans, stocks.setup_matches TO stocks_app;
GRANT DELETE ON stocks.setup_matches TO stocks_app; -- a re-run replaces its own session's matches
GRANT USAGE ON SEQUENCE stocks.setup_scans_id_seq, stocks.setup_matches_id_seq TO stocks_app;

-- Historical definition: 20260926_stocks_provision_existing_users.sql
-- Accounts that existed in auth.users before Stock Studio's signup trigger
-- (the Supabase project is shared with Facebook Ads Studio) never got a
-- stocks profile/workspace, so every queue route answered "unauthorized".
-- Move the signup setup into one idempotent function, backfill those users,
-- and let the app provision on first sign-in if one is ever missed again.

CREATE OR REPLACE FUNCTION stocks.provision_user(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  ws_id UUID;
  user_email TEXT;
BEGIN
  -- One provisioning per user even under concurrent first requests.
  PERFORM pg_advisory_xact_lock(hashtext('stocks.provision_user:' || p_user_id::text));

  SELECT active_workspace_id INTO ws_id FROM stocks.profiles WHERE id = p_user_id;
  IF FOUND THEN
    RETURN ws_id;
  END IF;

  -- Only real Supabase Auth users.
  SELECT email INTO user_email FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown user %', p_user_id USING ERRCODE = 'SS404';
  END IF;

  -- Reuse an existing membership if one somehow exists without a profile.
  SELECT workspace_id INTO ws_id FROM stocks.workspace_members WHERE user_id = p_user_id ORDER BY created_at LIMIT 1;
  IF ws_id IS NULL THEN
    INSERT INTO stocks.workspaces (name) VALUES (COALESCE(user_email, 'My workspace')) RETURNING id INTO ws_id;
    INSERT INTO stocks.workspace_members (workspace_id, user_id, role) VALUES (ws_id, p_user_id, 'owner');
  END IF;

  -- Same server-granted trial as a new signup: 30 days + 5 starter credits.
  INSERT INTO stocks.profiles (id, active_workspace_id, trial_ends_at, access_granted)
  VALUES (p_user_id, ws_id, now() + interval '30 days', false);

  -- (reason, ref) is unique, so a trial is granted at most once per user.
  INSERT INTO stocks.credits_ledger (workspace_id, delta, reason, ref)
  VALUES (ws_id, 5, 'trial_grant', 'trial:' || p_user_id)
  ON CONFLICT (reason, ref) WHERE ref IS NOT NULL DO NOTHING;

  RETURN ws_id;
END;
$$;
REVOKE ALL ON FUNCTION stocks.provision_user(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stocks.provision_user(UUID) TO stocks_app, service_role;

-- The signup trigger now uses the same function.
CREATE OR REPLACE FUNCTION stocks.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
BEGIN
  PERFORM stocks.provision_user(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION stocks.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Backfill every existing account that has no profile yet.
SELECT stocks.provision_user(u.id)
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM stocks.profiles p WHERE p.id = u.id);

-- Historical definition: 20260926_stocks_super_admin.sql
-- Super admin console (/admin).
--
-- Who is an admin: rows in stocks.platform_admins (managed here in SQL, never
-- from the UI). Reading across workspaces uses the app role; every CHANGE to
-- credits, access or trials goes through the SECURITY DEFINER functions
-- below, which only the new stocks_admin role may execute — the same
-- separation as stocks_billing, so the app role still can't mint credits or
-- grant access. Every admin action lands in stocks.admin_audit.

CREATE TABLE IF NOT EXISTS stocks.platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stocks.admin_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON stocks.admin_audit (created_at DESC);

-- Not tenant data: RLS on with no policies, so the API roles see nothing.
ALTER TABLE stocks.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocks.admin_audit ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON stocks.platform_admins TO stocks_app;
-- Append-only from the app (job actions); no UPDATE/DELETE for anyone but owners.
GRANT SELECT, INSERT ON stocks.admin_audit TO stocks_app;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stocks_admin') THEN
    -- No password here: set one out of band, then use it in ADMIN_DATABASE_URL.
    CREATE ROLE stocks_admin LOGIN NOINHERIT;
  END IF;
END $$;
GRANT USAGE ON SCHEMA stocks TO stocks_admin;

CREATE OR REPLACE FUNCTION stocks.assert_platform_admin(p_admin UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM stocks.platform_admins WHERE user_id = p_admin) THEN
    RAISE EXCEPTION 'not a platform admin' USING ERRCODE = 'SS403';
  END IF;
END;
$$;

-- Add or remove credits. Removal can't take a balance below zero.
CREATE OR REPLACE FUNCTION stocks.admin_adjust_credits(p_admin UUID, p_workspace UUID, p_delta INT, p_note TEXT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  bal INT;
  audit_id BIGINT;
BEGIN
  PERFORM stocks.assert_platform_admin(p_admin);
  IF p_delta IS NULL OR p_delta = 0 OR abs(p_delta) > 10000 THEN
    RAISE EXCEPTION 'delta must be between -10000 and 10000 and not zero' USING ERRCODE = 'SS400';
  END IF;
  IF coalesce(length(trim(p_note)), 0) < 3 THEN
    RAISE EXCEPTION 'a note is required' USING ERRCODE = 'SS400';
  END IF;
  -- Serialize with charge_job_credits for this workspace.
  PERFORM pg_advisory_xact_lock(hashtext('stocks_credits:' || p_workspace::text));
  IF NOT EXISTS (SELECT 1 FROM stocks.workspaces WHERE id = p_workspace) THEN
    RAISE EXCEPTION 'unknown workspace' USING ERRCODE = 'SS404';
  END IF;
  SELECT coalesce(sum(delta), 0) INTO bal FROM stocks.credits_ledger WHERE workspace_id = p_workspace;
  IF bal + p_delta < 0 THEN
    RAISE EXCEPTION 'balance would go below zero (current %)', bal USING ERRCODE = 'SS400';
  END IF;

  INSERT INTO stocks.admin_audit (admin_user_id, action, target_type, target_id, detail)
  VALUES (p_admin, 'adjust_credits', 'workspace', p_workspace::text,
          jsonb_build_object('delta', p_delta, 'note', left(trim(p_note), 500), 'balance_before', bal))
  RETURNING id INTO audit_id;

  INSERT INTO stocks.credits_ledger (workspace_id, delta, reason, ref)
  VALUES (p_workspace, p_delta, 'admin_adjust', 'admin:' || audit_id);
  RETURN bal + p_delta;
END;
$$;

-- Comp (or remove comp) lifetime access. Note: refund_payment() revokes
-- access when a user's last access payment is refunded, comp or not.
CREATE OR REPLACE FUNCTION stocks.admin_set_access(p_admin UUID, p_user UUID, p_granted BOOLEAN, p_note TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  before BOOLEAN;
BEGIN
  PERFORM stocks.assert_platform_admin(p_admin);
  IF coalesce(length(trim(p_note)), 0) < 3 THEN
    RAISE EXCEPTION 'a note is required' USING ERRCODE = 'SS400';
  END IF;
  SELECT access_granted INTO before FROM stocks.profiles WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown user' USING ERRCODE = 'SS404';
  END IF;
  UPDATE stocks.profiles SET access_granted = p_granted, updated_at = now() WHERE id = p_user;
  INSERT INTO stocks.admin_audit (admin_user_id, action, target_type, target_id, detail)
  VALUES (p_admin, CASE WHEN p_granted THEN 'grant_access' ELSE 'revoke_access' END, 'user', p_user::text,
          jsonb_build_object('note', left(trim(p_note), 500), 'access_before', before));
END;
$$;

-- Extend a trial by N days from whichever is later: now or the current end.
CREATE OR REPLACE FUNCTION stocks.admin_extend_trial(p_admin UUID, p_user UUID, p_days INT, p_note TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  before TIMESTAMPTZ;
  after TIMESTAMPTZ;
BEGIN
  PERFORM stocks.assert_platform_admin(p_admin);
  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'days must be between 1 and 365' USING ERRCODE = 'SS400';
  END IF;
  IF coalesce(length(trim(p_note)), 0) < 3 THEN
    RAISE EXCEPTION 'a note is required' USING ERRCODE = 'SS400';
  END IF;
  SELECT trial_ends_at INTO before FROM stocks.profiles WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown user' USING ERRCODE = 'SS404';
  END IF;
  after := greatest(now(), coalesce(before, now())) + make_interval(days => p_days);
  UPDATE stocks.profiles SET trial_ends_at = after, updated_at = now() WHERE id = p_user;
  INSERT INTO stocks.admin_audit (admin_user_id, action, target_type, target_id, detail)
  VALUES (p_admin, 'extend_trial', 'user', p_user::text,
          jsonb_build_object('days', p_days, 'note', left(trim(p_note), 500), 'trial_before', before, 'trial_after', after));
  RETURN after;
END;
$$;

REVOKE ALL ON FUNCTION stocks.assert_platform_admin(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stocks.admin_adjust_credits(UUID, UUID, INT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stocks.admin_set_access(UUID, UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stocks.admin_extend_trial(UUID, UUID, INT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stocks.admin_adjust_credits(UUID, UUID, INT, TEXT) TO stocks_admin;
GRANT EXECUTE ON FUNCTION stocks.admin_set_access(UUID, UUID, BOOLEAN, TEXT) TO stocks_admin;
GRANT EXECUTE ON FUNCTION stocks.admin_extend_trial(UUID, UUID, INT, TEXT) TO stocks_admin;

-- First super admin.
-- Bootstrap platform admins explicitly after deployment.

-- Read-only user directory for the console. The app role can't read
-- auth.users; this returns only accounts that have a Stock Studio profile
-- (the auth schema is shared with other apps), and only to a platform admin.
CREATE OR REPLACE FUNCTION stocks.admin_user_directory(
  p_admin UUID, p_ids UUID[] DEFAULT NULL, p_query TEXT DEFAULT NULL, p_limit INT DEFAULT 50, p_offset INT DEFAULT 0
)
RETURNS TABLE (id UUID, email TEXT, full_name TEXT, provider TEXT, created_at TIMESTAMPTZ, last_sign_in_at TIMESTAMPTZ, total BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = stocks, public
AS $$
BEGIN
  PERFORM stocks.assert_platform_admin(p_admin);
  RETURN QUERY
  SELECT u.id, u.email::text,
         nullif(trim(coalesce(u.raw_user_meta_data->>'full_name',
                              concat_ws(' ', u.raw_user_meta_data->>'first_name', u.raw_user_meta_data->>'last_name'))), ''),
         u.raw_app_meta_data->>'provider', u.created_at, u.last_sign_in_at,
         count(*) OVER ()
  FROM auth.users u
  JOIN stocks.profiles p ON p.id = u.id
  WHERE (p_ids IS NULL OR u.id = ANY (p_ids))
    AND (p_query IS NULL OR u.email ILIKE '%' || p_query || '%'
         OR (u.raw_user_meta_data->>'full_name') ILIKE '%' || p_query || '%')
  ORDER BY u.created_at DESC
  LIMIT least(greatest(p_limit, 1), 200) OFFSET greatest(p_offset, 0);
END;
$$;
REVOKE ALL ON FUNCTION stocks.admin_user_directory(UUID, UUID[], TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stocks.admin_user_directory(UUID, UUID[], TEXT, INT, INT) TO stocks_app;

-- Historical definition: 20260928_stocks_job_usage.sql
-- Per-job model spend. The worker adds each attempt's token usage and its
-- estimated cost (list prices, lib/engine/pricing.ts) after every attempt,
-- successful or not, so failed and retried jobs are counted too. Estimates:
-- a call that times out before responding reports no usage.
ALTER TABLE stocks.jobs
  ADD COLUMN IF NOT EXISTS usage_json JSONB,
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10, 4);

CREATE INDEX IF NOT EXISTS idx_jobs_cost_updated ON stocks.jobs (updated_at) WHERE cost_usd IS NOT NULL;

-- Historical definition: 20260928_stocks_signals.sql
-- Trade signals: the program trader's BUY/SELL/EXIT/CLOSE/ALERT calls, posted
-- from a private Discord channel by the signal bot (scripts/signal-bot.ts),
-- reposted to members, and kept here as the track record.
--
-- The track record is append-only and tamper-evident:
--   * UPDATE, DELETE and TRUNCATE are rejected by triggers, for every role.
--   * posted_at is stamped by the database, so a signal can't be backdated.
--   * Each row stores sha256(previous row's hash + its own fields), so editing
--     or removing any row after the fact breaks the chain from that row on.
--     stocks.verify_signal_chain() re-computes it.
-- Deliveries (the Discord message a signal became) are a separate insert-only
-- table, so recording a delivery never needs an UPDATE of the signal.
--
-- Program-wide data, not tenant data: like setup_scans, no workspace_id. The
-- app shows it to paying members (profiles.access_granted) and admins.

CREATE TABLE IF NOT EXISTS stocks.signals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL', 'EXIT', 'CLOSE', 'ALERT')),
  ticker TEXT NOT NULL CHECK (ticker ~ '^[A-Z][A-Z0-9]{0,5}([.-][A-Z0-9]{1,4})?$'),
  instrument TEXT CHECK (instrument IN ('CALL', 'PUT')),
  entry NUMERIC(14, 4) CHECK (entry > 0),
  target NUMERIC(14, 4) CHECK (target > 0),
  stop NUMERIC(14, 4) CHECK (stop > 0),
  detail TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 1000),
  author_discord_id TEXT NOT NULL CHECK (author_discord_id ~ '^[0-9]{5,25}$'),
  author_name TEXT CHECK (length(author_name) <= 100),
  source_message_id TEXT NOT NULL UNIQUE CHECK (source_message_id ~ '^[0-9]{5,25}$'),
  prev_hash TEXT,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS signals_posted_idx ON stocks.signals (posted_at DESC);

CREATE TABLE IF NOT EXISTS stocks.signal_deliveries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  signal_id BIGINT NOT NULL REFERENCES stocks.signals(id),
  channel TEXT NOT NULL CHECK (channel IN ('discord', 'sms')),
  destination TEXT NOT NULL,
  external_id TEXT,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signal_deliveries_signal_idx ON stocks.signal_deliveries (signal_id);

-- One canonical text form per row; the hash covers exactly this.
CREATE OR REPLACE FUNCTION stocks.signal_canonical(s stocks.signals)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = stocks, public
AS $$
  SELECT concat_ws('|',
    coalesce(s.prev_hash, 'GENESIS'),
    s.id::text,
    to_char(s.posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    s.action, s.ticker, coalesce(s.instrument, ''),
    coalesce(s.entry::text, ''), coalesce(s.target::text, ''), coalesce(s.stop::text, ''),
    s.detail, s.author_discord_id, s.source_message_id)
$$;

-- Stamps time and chains the hash. SECURITY DEFINER so the bot role can read
-- the previous hash without SELECT on the whole table mattering.
CREATE OR REPLACE FUNCTION stocks.signals_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
BEGIN
  -- Serialize inserts so two signals can't chain off the same parent.
  PERFORM pg_advisory_xact_lock(hashtext('stocks.signals.chain'));
  NEW.posted_at := now();
  SELECT hash INTO NEW.prev_hash FROM stocks.signals ORDER BY id DESC LIMIT 1;
  NEW.hash := encode(sha256(convert_to(stocks.signal_canonical(NEW), 'UTF8')), 'hex');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION stocks.signals_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = stocks, public
AS $$
BEGIN
  RAISE EXCEPTION 'the signal track record is append-only (% refused on %)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'SS403';
END;
$$;

DROP TRIGGER IF EXISTS signals_chain ON stocks.signals;
CREATE TRIGGER signals_chain BEFORE INSERT ON stocks.signals
  FOR EACH ROW EXECUTE FUNCTION stocks.signals_before_insert();
DROP TRIGGER IF EXISTS signals_no_change ON stocks.signals;
CREATE TRIGGER signals_no_change BEFORE UPDATE OR DELETE ON stocks.signals
  FOR EACH ROW EXECUTE FUNCTION stocks.signals_append_only();
DROP TRIGGER IF EXISTS signals_no_truncate ON stocks.signals;
CREATE TRIGGER signals_no_truncate BEFORE TRUNCATE ON stocks.signals
  FOR EACH STATEMENT EXECUTE FUNCTION stocks.signals_append_only();
DROP TRIGGER IF EXISTS signal_deliveries_no_change ON stocks.signal_deliveries;
CREATE TRIGGER signal_deliveries_no_change BEFORE UPDATE OR DELETE ON stocks.signal_deliveries
  FOR EACH ROW EXECUTE FUNCTION stocks.signals_append_only();
DROP TRIGGER IF EXISTS signal_deliveries_no_truncate ON stocks.signal_deliveries;
CREATE TRIGGER signal_deliveries_no_truncate BEFORE TRUNCATE ON stocks.signal_deliveries
  FOR EACH STATEMENT EXECUTE FUNCTION stocks.signals_append_only();

-- First row whose stored prev_hash or hash doesn't match a recomputation, or
-- no rows when the whole chain is intact.
CREATE OR REPLACE FUNCTION stocks.verify_signal_chain()
RETURNS TABLE (broken_at BIGINT, checked BIGINT)
LANGUAGE sql
STABLE
SET search_path = stocks, public
AS $$
  WITH ordered AS (
    SELECT s AS r, lag(s.hash) OVER (ORDER BY s.id) AS expected_prev FROM stocks.signals s
  )
  SELECT
    (SELECT min((o.r).id) FROM ordered o
      WHERE (o.r).prev_hash IS DISTINCT FROM o.expected_prev
         OR (o.r).hash <> encode(sha256(convert_to(stocks.signal_canonical(o.r), 'UTF8')), 'hex')),
    (SELECT count(*) FROM stocks.signals)
$$;

-- RLS on as defense in depth. The app role bypasses RLS and gets SELECT only.
ALTER TABLE stocks.signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocks.signal_deliveries ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON stocks.signals, stocks.signal_deliveries TO stocks_app;
GRANT EXECUTE ON FUNCTION stocks.verify_signal_chain() TO stocks_app;

-- The bot's own login: insert + read signals and deliveries, nothing else.
-- No password here: set one out of band, then use it in SIGNALS_DATABASE_URL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stocks_signals') THEN
    CREATE ROLE stocks_signals LOGIN NOINHERIT;
  END IF;
END $$;
GRANT USAGE ON SCHEMA stocks TO stocks_signals;
GRANT SELECT, INSERT ON stocks.signals, stocks.signal_deliveries TO stocks_signals;
DROP POLICY IF EXISTS signals_bot_read ON stocks.signals;
CREATE POLICY signals_bot_read ON stocks.signals FOR SELECT TO stocks_signals USING (true);
DROP POLICY IF EXISTS signals_bot_insert ON stocks.signals;
CREATE POLICY signals_bot_insert ON stocks.signals FOR INSERT TO stocks_signals WITH CHECK (true);
DROP POLICY IF EXISTS signal_deliveries_bot_read ON stocks.signal_deliveries;
CREATE POLICY signal_deliveries_bot_read ON stocks.signal_deliveries FOR SELECT TO stocks_signals USING (true);
DROP POLICY IF EXISTS signal_deliveries_bot_insert ON stocks.signal_deliveries;
CREATE POLICY signal_deliveries_bot_insert ON stocks.signal_deliveries FOR INSERT TO stocks_signals WITH CHECK (true);

REVOKE ALL ON FUNCTION stocks.signals_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stocks.signals_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stocks.verify_signal_chain() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stocks.signal_canonical(stocks.signals) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stocks.signal_canonical(stocks.signals) TO stocks_app;

-- The schema's default privileges hand stocks_app full DML on new tables; the
-- web app only ever reads signals, so it must not be able to insert (forge)
-- one either. Only stocks_signals writes.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON stocks.signals, stocks.signal_deliveries FROM stocks_app;

-- Historical definition: 20260929_stocks_grade_letter_scale.sql
-- Re-letter stored study grades on the calibration-aligned scale (lib/grades.ts
-- LETTERS): 70+ A..B-, 45-69 C+..C-, under 45 D+..F. The app already derives
-- the letter from grade_json.score when rendering; this keeps the stored
-- "overall" consistent for anything reading the raw JSON.
UPDATE stocks.case_studies
SET grade_json = jsonb_set(grade_json, '{overall}', to_jsonb(
  CASE
    WHEN (grade_json->>'score')::numeric >= 90 THEN 'A'
    WHEN (grade_json->>'score')::numeric >= 85 THEN 'A-'
    WHEN (grade_json->>'score')::numeric >= 80 THEN 'B+'
    WHEN (grade_json->>'score')::numeric >= 75 THEN 'B'
    WHEN (grade_json->>'score')::numeric >= 70 THEN 'B-'
    WHEN (grade_json->>'score')::numeric >= 60 THEN 'C+'
    WHEN (grade_json->>'score')::numeric >= 50 THEN 'C'
    WHEN (grade_json->>'score')::numeric >= 45 THEN 'C-'
    WHEN (grade_json->>'score')::numeric >= 40 THEN 'D+'
    WHEN (grade_json->>'score')::numeric >= 35 THEN 'D'
    WHEN (grade_json->>'score')::numeric >= 30 THEN 'D-'
    ELSE 'F'
  END))
WHERE grade_json ? 'score' AND jsonb_typeof(grade_json->'score') = 'number';

CREATE TRIGGER stocks_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION stocks.handle_new_user();
$definition$;
END $baseline$;
