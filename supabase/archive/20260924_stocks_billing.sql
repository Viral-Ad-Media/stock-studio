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
