-- Forward fix: destination-ordered deliveries and user-serialized access changes.
CREATE OR REPLACE FUNCTION stocks.claim_signal_delivery(p_destination text)
RETURNS TABLE(signal jsonb,destination text,attempts int,lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=stocks,public AS $$
DECLARE item stocks.signal_outbox;
BEGIN
 -- One outstanding delivery per destination, even across bot instances.
 -- Inspect the oldest row BEFORE testing readiness: a backoff or active lease
 -- must block newer signals rather than let CLOSE overtake a pending BUY.
 PERFORM pg_advisory_xact_lock(hashtextextended('stocks.signal_delivery:' || p_destination, 0));
 SELECT o.* INTO item FROM stocks.signal_outbox o
 WHERE o.destination=p_destination AND o.delivered_at IS NULL
 ORDER BY o.signal_id FOR UPDATE LIMIT 1;
 IF item.signal_id IS NULL OR item.next_attempt_at > now()
   OR (item.locked_at IS NOT NULL AND item.locked_at >= now()-interval '90 seconds')
 THEN RETURN; END IF;
 UPDATE stocks.signal_outbox o SET attempts=o.attempts+1,lease_token=gen_random_uuid(),locked_at=now()
 WHERE o.signal_id=item.signal_id RETURNING o.* INTO item;
 RETURN QUERY SELECT to_jsonb(s),item.destination,item.attempts,item.lease_token FROM stocks.signals s WHERE s.id=item.signal_id;
END $$;

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

  -- Access is shared across all payment intents belonging to this user.
  IF p_kind = 'access' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('stocks.access:' || p_user_id::text, 0));
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
  access_user UUID;
BEGIN
  IF coalesce(p_payment_intent, '') = '' THEN RAISE EXCEPTION 'payment intent required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('stocks.payment:' || p_payment_intent));
  INSERT INTO stocks.payment_refunds(payment_intent) VALUES(p_payment_intent) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  -- Lock every affected access user in a stable order before changing any
  -- payment status. Serializes different intents with access fulfillment too.
  FOR access_user IN
    SELECT DISTINCT user_id FROM stocks.payments
    WHERE stripe_payment_intent = p_payment_intent AND kind = 'access'
    ORDER BY user_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('stocks.access:' || access_user::text, 0));
  END LOOP;
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


-- Preserve the dedicated-role boundary explicitly.
REVOKE ALL ON FUNCTION stocks.claim_signal_delivery(text) FROM PUBLIC,anon,authenticated,stocks_app;
GRANT EXECUTE ON FUNCTION stocks.claim_signal_delivery(text) TO stocks_signals;
REVOKE ALL ON FUNCTION stocks.fulfill_checkout(TEXT,TEXT,UUID,UUID,TEXT,INT,INT),stocks.refund_payment(TEXT) FROM PUBLIC,anon,authenticated,stocks_app;
GRANT EXECUTE ON FUNCTION stocks.fulfill_checkout(TEXT,TEXT,UUID,UUID,TEXT,INT,INT),stocks.refund_payment(TEXT) TO stocks_billing,service_role;
