-- Web Push subscriptions and durable live-signal push fan-out.
--
-- * Browser push endpoints and ECDH keys live in stocks.push_subscriptions,
--   scoped to (user_id, workspace_id). Only stocks_app manages rows on behalf
--   of the authenticated session; public API roles and stocks_signals have no
--   access to endpoints or keys.
-- * When a trader call is recorded in stocks.signals, an AFTER INSERT trigger
--   enqueues signal_id in stocks.signal_push_queue and wakes the worker
--   webhook (when pg_net + Vault are configured) without exposing user tables
--   or VAPID keys to stocks_signals.
-- * Signal push eligibility uses stocks.signal_live_tiers() and
--   stocks.subscription_is_live() so Diamond/Founding/Admin receive all calls,
--   Gold receives weekly picks + follow-ups, Silver receives monthly picks +
--   follow-ups, and trial/expired/disabled accounts never receive signal pushes.

CREATE TABLE IF NOT EXISTS stocks.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES stocks.workspaces(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE CHECK (endpoint LIKE 'https://%' AND length(endpoint) <= 2048),
  p256dh TEXT NOT NULL CHECK (length(p256dh) BETWEEN 40 AND 200),
  auth TEXT NOT NULL CHECK (length(auth) BETWEEN 16 AND 100),
  user_agent TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 512),
  notify_studies BOOLEAN NOT NULL DEFAULT true,
  notify_watchlist BOOLEAN NOT NULL DEFAULT true,
  notify_signals BOOLEAN NOT NULL DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON stocks.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_workspace ON stocks.push_subscriptions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_signals ON stocks.push_subscriptions(user_id) WHERE notify_signals = true;

ALTER TABLE stocks.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own push subscriptions" ON stocks.push_subscriptions;
CREATE POLICY "own push subscriptions" ON stocks.push_subscriptions FOR SELECT USING (user_id = auth.uid());

REVOKE ALL ON stocks.push_subscriptions FROM PUBLIC, anon, authenticated, stocks_signals;
GRANT SELECT, INSERT, UPDATE, DELETE ON stocks.push_subscriptions TO stocks_app;

-- ---------------------------------------------------------------------
-- Signal push queue: decoupled from stocks_signals so the Discord relay
-- never touches user profiles, subscriptions, or VAPID secrets.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stocks.signal_push_queue (
  signal_id BIGINT PRIMARY KEY REFERENCES stocks.signals(id) ON DELETE CASCADE,
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  sent_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signal_push_queue_pending
  ON stocks.signal_push_queue(next_attempt_at) WHERE dispatched_at IS NULL;

ALTER TABLE stocks.signal_push_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stocks.signal_push_queue FROM PUBLIC, anon, authenticated, stocks_signals;
GRANT SELECT, UPDATE ON stocks.signal_push_queue TO stocks_app;

CREATE OR REPLACE FUNCTION stocks.enqueue_signal_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  endpoint TEXT;
  secret TEXT;
BEGIN
  INSERT INTO stocks.signal_push_queue (signal_id)
  VALUES (NEW.id)
  ON CONFLICT (signal_id) DO NOTHING;

  IF to_regclass('vault.decrypted_secrets') IS NOT NULL
     AND to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NOT NULL THEN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
      INTO endpoint USING 'engine_webhook_url';
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
      INTO secret USING 'engine_webhook_secret';
    IF endpoint IS NOT NULL AND secret IS NOT NULL THEN
      EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3)'
        USING endpoint, '{"reason":"signal_push"}'::jsonb,
              jsonb_build_object('Content-Type', 'application/json', 'x-engine-secret', secret);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION stocks.enqueue_signal_push() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS stocks_signal_push_enqueue ON stocks.signals;
CREATE TRIGGER stocks_signal_push_enqueue
  AFTER INSERT ON stocks.signals
  FOR EACH ROW EXECUTE FUNCTION stocks.enqueue_signal_push();

-- Claims the next undispatched signal push job and resolves its live-tier pick flags.
CREATE OR REPLACE FUNCTION stocks.claim_signal_push(
  stale_after INTERVAL DEFAULT '2 minutes',
  max_attempts INT DEFAULT 5
)
RETURNS TABLE (
  signal_id BIGINT,
  action TEXT,
  ticker TEXT,
  instrument TEXT,
  entry TEXT,
  target TEXT,
  stop TEXT,
  detail TEXT,
  posted_at TIMESTAMPTZ,
  gold BOOLEAN,
  silver BOOLEAN,
  attempts INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  picked stocks.signal_push_queue;
BEGIN
  -- Retire stale items that have exhausted max_attempts so they don't spin forever.
  UPDATE stocks.signal_push_queue q
  SET dispatched_at = now(),
      locked_at = NULL,
      last_error = coalesce(q.last_error, 'exhausted push retry attempts')
  WHERE q.dispatched_at IS NULL
    AND q.attempts >= max_attempts
    AND (q.locked_at IS NULL OR q.locked_at < now() - stale_after);

  SELECT q.* INTO picked
  FROM stocks.signal_push_queue q
  WHERE q.dispatched_at IS NULL
    AND q.next_attempt_at <= now()
    AND (q.locked_at IS NULL OR q.locked_at < now() - stale_after)
  ORDER BY q.signal_id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF picked.signal_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE stocks.signal_push_queue q
  SET attempts = q.attempts + 1,
      locked_at = now()
  WHERE q.signal_id = picked.signal_id
  RETURNING * INTO picked;

  RETURN QUERY
  SELECT
    s.id,
    s.action,
    s.ticker,
    s.instrument,
    s.entry::text,
    s.target::text,
    s.stop::text,
    s.detail,
    s.posted_at,
    coalesce(t.gold, false),
    coalesce(t.silver, false),
    picked.attempts
  FROM stocks.signals s
  LEFT JOIN stocks.signal_live_tiers() t ON t.id = s.id
  WHERE s.id = picked.signal_id;
END;
$$;

CREATE OR REPLACE FUNCTION stocks.finish_signal_push(p_signal_id BIGINT, p_sent_count INT DEFAULT 0)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
  UPDATE stocks.signal_push_queue
  SET dispatched_at = now(),
      locked_at = NULL,
      sent_count = greatest(coalesce(p_sent_count, 0), 0),
      last_error = NULL
  WHERE signal_id = p_signal_id AND dispatched_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION stocks.retry_signal_push(p_signal_id BIGINT, p_error TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
  UPDATE stocks.signal_push_queue
  SET locked_at = NULL,
      last_error = left(coalesce(p_error, 'push retry'), 1000),
      next_attempt_at = now() + make_interval(secs => least(900, 10 * power(2, least(attempts, 6)))::int)
  WHERE signal_id = p_signal_id AND dispatched_at IS NULL;
$$;

-- Eligible push subscriptions for a live signal, enforcing plan entitlements
-- and disabled-account checks identically to lib/plans.ts and lib/signal-feed.ts.
CREATE OR REPLACE FUNCTION stocks.signal_push_recipients(p_gold BOOLEAN, p_silver BOOLEAN)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  endpoint TEXT,
  p256dh TEXT,
  auth TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = stocks, public
AS $$
  SELECT ps.id, ps.user_id, ps.endpoint, ps.p256dh, ps.auth
  FROM stocks.push_subscriptions ps
  LEFT JOIN stocks.profiles p ON p.id = ps.user_id
  LEFT JOIN stocks.subscriptions sub ON sub.user_id = ps.user_id
  WHERE ps.notify_signals = true
    AND p.disabled_at IS NULL
    AND (
      EXISTS (SELECT 1 FROM stocks.platform_admins a WHERE a.user_id = ps.user_id)
      OR coalesce(p.access_granted, false)
      OR (sub.user_id IS NOT NULL AND stocks.subscription_is_live(sub.status) AND sub.plan = 'diamond')
      OR (coalesce(p_gold, false) AND sub.user_id IS NOT NULL AND stocks.subscription_is_live(sub.status) AND sub.plan = 'gold')
      OR (coalesce(p_silver, false) AND sub.user_id IS NOT NULL AND stocks.subscription_is_live(sub.status) AND sub.plan = 'silver')
    );
$$;

-- Eligible push subscriptions for workspace-scoped events (studies, watchlist).
CREATE OR REPLACE FUNCTION stocks.workspace_push_recipients(p_workspace_id UUID, p_category TEXT)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  endpoint TEXT,
  p256dh TEXT,
  auth TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = stocks, public
AS $$
  SELECT ps.id, ps.user_id, ps.endpoint, ps.p256dh, ps.auth
  FROM stocks.push_subscriptions ps
  JOIN stocks.workspace_members wm
    ON wm.workspace_id = p_workspace_id AND wm.user_id = ps.user_id
  LEFT JOIN stocks.profiles p ON p.id = ps.user_id
  WHERE ps.workspace_id = p_workspace_id
    AND p.disabled_at IS NULL
    AND (
      (p_category = 'studies' AND ps.notify_studies = true)
      OR (p_category = 'watchlist' AND ps.notify_watchlist = true)
    );
$$;

REVOKE ALL ON FUNCTION
  stocks.claim_signal_push(INTERVAL, INT),
  stocks.finish_signal_push(BIGINT, INT),
  stocks.retry_signal_push(BIGINT, TEXT),
  stocks.signal_push_recipients(BOOLEAN, BOOLEAN),
  stocks.workspace_push_recipients(UUID, TEXT)
FROM PUBLIC, anon, authenticated, stocks_signals;

GRANT EXECUTE ON FUNCTION
  stocks.claim_signal_push(INTERVAL, INT),
  stocks.finish_signal_push(BIGINT, INT),
  stocks.retry_signal_push(BIGINT, TEXT),
  stocks.signal_push_recipients(BOOLEAN, BOOLEAN),
  stocks.workspace_push_recipients(UUID, TEXT)
TO stocks_app, service_role;
