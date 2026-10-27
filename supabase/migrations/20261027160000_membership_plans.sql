-- Membership plans: Silver, Gold and Diamond monthly or yearly Stripe
-- subscriptions replace the one-time access unlock for new members.
--
-- * stocks.subscriptions mirrors each member's Stripe subscription. Only the
--   stocks_billing role (the signature-verified webhook) writes it, through
--   upsert_subscription; the app reads it.
-- * Each paid invoice grants the plan's credits once (ledger reason
--   'plan_grant', ref = invoice id). Unused plan credits roll over up to the
--   plan's carry cap and the rest expire at renewal ('plan_expire'). Plan
--   credits are counted as spent before purchased credits, which never expire.
-- * Members who bought the old one-time unlock keep profiles.access_granted;
--   the app treats them as Founding members with every Diamond feature.
-- * Signals: Diamond sees every call live. Gold sees the first 2 BUY calls of
--   each week (New York time) live, Silver the first BUY call of each month,
--   and both see every follow-up (SELL/EXIT/CLOSE/ALERT) on a ticker whose
--   latest BUY was one of their picks. stocks.signal_live_tiers() is the one
--   definition of that rule; the web app and the bot's tier channels use it.

-- ---------------------------------------------------------------------
-- Ledger reasons
-- ---------------------------------------------------------------------
ALTER TABLE stocks.credits_ledger DROP CONSTRAINT IF EXISTS credits_ledger_reason_check;
ALTER TABLE stocks.credits_ledger ADD CONSTRAINT credits_ledger_reason_check CHECK (reason IN (
  'trial_grant', 'grandfather', 'purchase', 'purchase_refund', 'job_charge', 'job_refund', 'admin_adjust',
  'plan_grant', 'plan_expire'
));

-- ---------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stocks.subscriptions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES stocks.workspaces(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL CHECK (plan IN ('silver', 'gold', 'diamond')),
  billing_interval TEXT NOT NULL CHECK (billing_interval IN ('month', 'year')),
  -- Stripe's status, verbatim: active, trialing, past_due, unpaid, canceled, incomplete, ...
  status TEXT NOT NULL,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  -- Plan credits left at the last grant (after expiry + the new grant), and
  -- what that grant was, for rollover and mid-period upgrades.
  plan_credits_bucket INT NOT NULL DEFAULT 0,
  last_grant_credits INT NOT NULL DEFAULT 0,
  last_grant_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace ON stocks.subscriptions(workspace_id);

ALTER TABLE stocks.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own subscription read" ON stocks.subscriptions;
CREATE POLICY "own subscription read" ON stocks.subscriptions FOR SELECT USING (user_id = auth.uid());
-- The schema's default privileges would hand stocks_app full DML on this new
-- table; the app only ever reads it.
REVOKE ALL ON stocks.subscriptions FROM PUBLIC, anon, authenticated, stocks_app;
GRANT SELECT ON stocks.subscriptions TO stocks_app;

-- Statuses that keep a plan's features on. past_due keeps access while
-- Stripe retries the card; unpaid, canceled and incomplete don't.
CREATE OR REPLACE FUNCTION stocks.subscription_is_live(p_status TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_status IN ('active', 'trialing', 'past_due')
$$;

-- Webhook: record the latest state of a Stripe subscription (the route always
-- re-reads it from Stripe first, so event order doesn't matter). One row per
-- member: a different subscription id replaces the row unless that would
-- swap a live subscription for a dead one (a late event for an old,
-- cancelled subscription).
CREATE OR REPLACE FUNCTION stocks.upsert_subscription(
  p_user_id UUID,
  p_workspace_id UUID,
  p_customer_id TEXT,
  p_subscription_id TEXT,
  p_plan TEXT,
  p_interval TEXT,
  p_status TEXT,
  p_period_end TIMESTAMPTZ,
  p_cancel_at_period_end BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  cur stocks.subscriptions;
BEGIN
  IF coalesce(p_subscription_id, '') = '' OR coalesce(p_customer_id, '') = '' THEN
    RAISE EXCEPTION 'subscription identifiers required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM stocks.workspace_members WHERE workspace_id = p_workspace_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'user % is not a member of workspace %', p_user_id, p_workspace_id;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('stocks.subscription:' || p_user_id::text, 0));

  SELECT * INTO cur FROM stocks.subscriptions WHERE user_id = p_user_id FOR UPDATE;
  IF cur.user_id IS NOT NULL AND cur.stripe_subscription_id <> p_subscription_id
     AND stocks.subscription_is_live(cur.status) AND NOT stocks.subscription_is_live(p_status) THEN
    RETURN false;
  END IF;

  INSERT INTO stocks.subscriptions AS s
    (user_id, workspace_id, stripe_customer_id, stripe_subscription_id, plan, billing_interval,
     status, current_period_end, cancel_at_period_end)
  VALUES
    (p_user_id, p_workspace_id, p_customer_id, p_subscription_id, p_plan, p_interval,
     p_status, p_period_end, coalesce(p_cancel_at_period_end, false))
  ON CONFLICT (user_id) DO UPDATE SET
    workspace_id = excluded.workspace_id,
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    plan = excluded.plan,
    billing_interval = excluded.billing_interval,
    status = excluded.status,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    -- A new subscription starts a fresh credit cycle.
    plan_credits_bucket = CASE WHEN s.stripe_subscription_id = excluded.stripe_subscription_id THEN s.plan_credits_bucket ELSE 0 END,
    last_grant_credits = CASE WHEN s.stripe_subscription_id = excluded.stripe_subscription_id THEN s.last_grant_credits ELSE 0 END,
    last_grant_at = CASE WHEN s.stripe_subscription_id = excluded.stripe_subscription_id THEN s.last_grant_at END,
    updated_at = now();
  RETURN true;
END;
$$;

-- Webhook, once per paid invoice (idempotent on the invoice id).
--   p_mode 'renewal' (first invoice or a new period): expire unused plan
--     credits above p_carry_cap, then grant p_credits.
--   p_mode 'upgrade' (a prorated mid-period plan change): grant only the
--     difference between p_credits and the last grant, never less than 0.
-- Plan credits are treated as spent first, so the plan credits still unused
-- are the bucket from the last grant minus net job charges since, capped by
-- the actual balance.
CREATE OR REPLACE FUNCTION stocks.grant_plan_credits(
  p_subscription_id TEXT,
  p_invoice_id TEXT,
  p_mode TEXT,
  p_credits INT,
  p_carry_cap INT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  sub stocks.subscriptions;
  bal INT;
  spent INT;
  unused INT;
  expire INT := 0;
  grant_n INT;
BEGIN
  IF coalesce(p_invoice_id, '') = '' THEN RAISE EXCEPTION 'invoice id required'; END IF;
  IF p_mode NOT IN ('renewal', 'upgrade') THEN RAISE EXCEPTION 'unknown mode %', p_mode; END IF;
  IF coalesce(p_credits, 0) < 0 OR coalesce(p_carry_cap, 0) < 0 THEN RAISE EXCEPTION 'credits must not be negative'; END IF;

  SELECT * INTO sub FROM stocks.subscriptions WHERE stripe_subscription_id = p_subscription_id;
  IF sub.user_id IS NULL THEN RAISE EXCEPTION 'subscription % not recorded', p_subscription_id; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('stocks_credits:' || sub.workspace_id::text));
  SELECT * INTO sub FROM stocks.subscriptions WHERE stripe_subscription_id = p_subscription_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM stocks.credits_ledger WHERE reason = 'plan_grant' AND ref = p_invoice_id) THEN
    RETURN 0; -- replay
  END IF;

  SELECT COALESCE(SUM(delta), 0) INTO bal FROM stocks.credits_ledger WHERE workspace_id = sub.workspace_id;
  SELECT COALESCE(-SUM(delta), 0) INTO spent FROM stocks.credits_ledger
  WHERE workspace_id = sub.workspace_id AND reason IN ('job_charge', 'job_refund')
    AND created_at > coalesce(sub.last_grant_at, '-infinity');
  unused := greatest(0, least(bal, sub.plan_credits_bucket - greatest(spent, 0)));

  IF p_mode = 'renewal' THEN
    expire := greatest(0, unused - p_carry_cap);
    grant_n := p_credits;
  ELSE
    grant_n := greatest(0, p_credits - sub.last_grant_credits);
  END IF;

  IF expire > 0 THEN
    INSERT INTO stocks.credits_ledger (workspace_id, delta, reason, ref)
    VALUES (sub.workspace_id, -expire, 'plan_expire', p_invoice_id);
  END IF;
  -- Always write the grant row (even 0) so a replay is recognised.
  INSERT INTO stocks.credits_ledger (workspace_id, delta, reason, ref)
  VALUES (sub.workspace_id, grant_n, 'plan_grant', p_invoice_id);

  UPDATE stocks.subscriptions SET
    plan_credits_bucket = unused - expire + grant_n,
    last_grant_credits = CASE WHEN p_mode = 'renewal' THEN p_credits ELSE greatest(p_credits, last_grant_credits) END,
    last_grant_at = now(),
    updated_at = now()
  WHERE user_id = sub.user_id;
  RETURN grant_n;
END;
$$;

REVOKE ALL ON FUNCTION stocks.upsert_subscription(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC, anon, authenticated, stocks_app;
REVOKE ALL ON FUNCTION stocks.grant_plan_credits(TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated, stocks_app;
GRANT EXECUTE ON FUNCTION stocks.upsert_subscription(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, BOOLEAN) TO stocks_billing, service_role;
GRANT EXECUTE ON FUNCTION stocks.grant_plan_credits(TEXT, TEXT, TEXT, INT, INT) TO stocks_billing, service_role;
REVOKE ALL ON FUNCTION stocks.subscription_is_live(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stocks.subscription_is_live(TEXT) TO stocks_app, stocks_billing, service_role;

-- ---------------------------------------------------------------------
-- Signal picks per tier
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stocks.signal_live_tiers()
RETURNS TABLE (id BIGINT, gold BOOLEAN, silver BOOLEAN)
LANGUAGE sql
STABLE
SET search_path = stocks, public
AS $$
  WITH buys AS (
    SELECT s.id,
      row_number() OVER (PARTITION BY date_trunc('week', s.posted_at AT TIME ZONE 'America/New_York') ORDER BY s.id) AS week_n,
      row_number() OVER (PARTITION BY date_trunc('month', s.posted_at AT TIME ZONE 'America/New_York') ORDER BY s.id) AS month_n
    FROM stocks.signals s WHERE s.action = 'BUY'
  ), opened AS (
    -- The latest BUY on the same ticker at or before each signal: a BUY is
    -- its own opener, a follow-up inherits its opener's pick status.
    SELECT s.id, max(s.id) FILTER (WHERE s.action = 'BUY') OVER (PARTITION BY s.ticker ORDER BY s.id) AS opener
    FROM stocks.signals s
  )
  SELECT o.id, coalesce(b.week_n <= 2, false), coalesce(b.month_n <= 1, false)
  FROM opened o LEFT JOIN buys b ON b.id = o.opener
$$;
REVOKE ALL ON FUNCTION stocks.signal_live_tiers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stocks.signal_live_tiers() TO stocks_app, stocks_signals, service_role;

-- ---------------------------------------------------------------------
-- Tier channels on Discord: one outbox row per (signal, destination).
-- ---------------------------------------------------------------------
ALTER TABLE stocks.signal_outbox DROP CONSTRAINT IF EXISTS signal_outbox_pkey;
ALTER TABLE stocks.signal_outbox ADD PRIMARY KEY (signal_id, destination);

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
 WHERE o.signal_id=item.signal_id AND o.destination=item.destination RETURNING o.* INTO item;
 RETURN QUERY SELECT to_jsonb(s),item.destination,item.attempts,item.lease_token FROM stocks.signals s WHERE s.id=item.signal_id;
END $$;

-- Leases are unique per outbox row, so finishing and retrying by
-- (signal, lease) stays correct with several destinations per signal.
CREATE OR REPLACE FUNCTION stocks.finish_signal_delivery(p_id bigint,p_lease uuid,p_external text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=stocks,public AS $$
DECLARE item stocks.signal_outbox;
BEGIN
 UPDATE stocks.signal_outbox SET delivered_at=now(),external_id=p_external,locked_at=NULL,lease_token=NULL,last_error=NULL
 WHERE signal_id=p_id AND lease_token=p_lease AND delivered_at IS NULL RETURNING * INTO item;
 IF item.signal_id IS NULL THEN RETURN false; END IF;
 INSERT INTO stocks.signal_deliveries(signal_id,channel,destination,external_id)
 VALUES(p_id,'discord',item.destination,p_external);
 RETURN true;
END $$;

-- Records a signal for the main (Diamond) channel, then also queues it for
-- the Gold and Silver channels when it is live for that tier. Either tier
-- destination may be NULL (channel not configured). Replays are safe: the
-- outbox key and the deliveries check stop a second send.
CREATE OR REPLACE FUNCTION stocks.record_signal(
  p_signal jsonb, p_author_id text, p_author_name text, p_source_id text,
  p_destination text, p_gold_destination text, p_silver_destination text)
RETURNS stocks.signals LANGUAGE plpgsql SECURITY DEFINER SET search_path=stocks,public AS $$
DECLARE
 recorded stocks.signals;
 tiers record;
 dest text;
BEGIN
 recorded := stocks.record_signal(p_signal, p_author_id, p_author_name, p_source_id, p_destination);
 SELECT t.gold, t.silver INTO tiers FROM stocks.signal_live_tiers() t WHERE t.id = recorded.id;
 FOREACH dest IN ARRAY ARRAY[
   CASE WHEN tiers.gold THEN nullif(p_gold_destination, '') END,
   CASE WHEN tiers.silver THEN nullif(p_silver_destination, '') END]
 LOOP
  IF dest IS NOT NULL AND dest <> p_destination
     AND NOT EXISTS(SELECT FROM stocks.signal_deliveries WHERE signal_id=recorded.id AND channel='discord' AND destination=dest) THEN
   INSERT INTO stocks.signal_outbox(signal_id,destination) VALUES(recorded.id,dest) ON CONFLICT DO NOTHING;
  END IF;
 END LOOP;
 RETURN recorded;
END $$;

REVOKE ALL ON FUNCTION stocks.record_signal(jsonb,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,stocks_app;
GRANT EXECUTE ON FUNCTION stocks.record_signal(jsonb,text,text,text,text,text,text) TO stocks_signals;
REVOKE ALL ON FUNCTION stocks.claim_signal_delivery(text),stocks.finish_signal_delivery(bigint,uuid,text) FROM PUBLIC,anon,authenticated,stocks_app;
GRANT EXECUTE ON FUNCTION stocks.claim_signal_delivery(text),stocks.finish_signal_delivery(bigint,uuid,text) TO stocks_signals;
