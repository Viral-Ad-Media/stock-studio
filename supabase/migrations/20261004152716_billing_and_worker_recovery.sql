-- Persist early full-refund events, serialized with checkout fulfillment.
CREATE TABLE stocks.payment_refunds(payment_intent text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE stocks.payment_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stocks.payment_refunds FROM PUBLIC,anon,authenticated,stocks_app,stocks_billing;
INSERT INTO stocks.payment_refunds(payment_intent)
SELECT DISTINCT stripe_payment_intent FROM stocks.payments WHERE status='refunded' AND stripe_payment_intent IS NOT NULL ON CONFLICT DO NOTHING;
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
  was_refunded BOOLEAN;
BEGIN
  IF coalesce(p_payment_intent, '') = '' OR coalesce(p_session_id, '') = '' THEN RAISE EXCEPTION 'payment identifiers required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('stocks.payment:' || p_payment_intent));
  SELECT EXISTS(SELECT FROM stocks.payment_refunds WHERE payment_intent=p_payment_intent) INTO was_refunded;
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
    (workspace_id, user_id, stripe_session_id, stripe_payment_intent, kind, amount_cents, credits, status, refunded_at)
  VALUES
    (p_workspace_id, p_user_id, p_session_id, p_payment_intent, p_kind, p_amount_cents,
     CASE WHEN p_kind = 'credits' THEN p_credits ELSE 0 END,
     CASE WHEN was_refunded THEN 'refunded' ELSE 'completed' END,
     CASE WHEN was_refunded THEN now() END)
  ON CONFLICT (stripe_session_id) DO NOTHING
  RETURNING id INTO new_id;

  IF new_id IS NULL THEN
    RETURN false; -- replay
  END IF;

  IF was_refunded THEN RETURN true; END IF;
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
  inserted INT;
BEGIN
  IF coalesce(p_payment_intent, '') = '' THEN RAISE EXCEPTION 'payment intent required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('stocks.payment:' || p_payment_intent));
  INSERT INTO stocks.payment_refunds(payment_intent) VALUES(p_payment_intent) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  FOR p IN
  UPDATE stocks.payments SET status = 'refunded', refunded_at = now()
  WHERE stripe_payment_intent = p_payment_intent AND status = 'completed'
  RETURNING *
  LOOP
  inserted := inserted + 1;

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
  END LOOP;
  RETURN inserted > 0;
END;
$$;


REVOKE ALL ON FUNCTION stocks.fulfill_checkout(TEXT,TEXT,UUID,UUID,TEXT,INT,INT) FROM PUBLIC,anon,authenticated,stocks_app;
REVOKE ALL ON FUNCTION stocks.refund_payment(TEXT) FROM PUBLIC,anon,authenticated,stocks_app;
GRANT EXECUTE ON FUNCTION stocks.fulfill_checkout(TEXT,TEXT,UUID,UUID,TEXT,INT,INT), stocks.refund_payment(TEXT) TO stocks_billing,service_role;

-- Restore the final refund-aware claim implementation after historical replay.
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
