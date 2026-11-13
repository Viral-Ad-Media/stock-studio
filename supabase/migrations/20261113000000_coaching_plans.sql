-- Coaching plans: Silver, Gold and Diamond are now tiers of the coaching
-- program. The upfront program fee is collected outside the app; an admin
-- then enrols the member in a tier, and the app bills only the monthly fee.
--
-- * profiles.enrolled_plan is the tier an admin confirmed. Checkout only
--   starts a subscription for that tier, and a live subscription never
--   unlocks more than it (lib/plans.ts effectiveTier).
-- * Members who already had a live subscription are enrolled in its plan, so
--   nobody loses access.
-- * Signals: every paid tier now sees every call live, on the web, by push
--   and in the optional Gold/Silver Discord channels. signal_live_tiers()
--   stays the one definition those three read.

ALTER TABLE stocks.profiles
  ADD COLUMN IF NOT EXISTS enrolled_plan TEXT CHECK (enrolled_plan IN ('silver', 'gold', 'diamond'));

UPDATE stocks.profiles p SET enrolled_plan = s.plan
FROM stocks.subscriptions s
WHERE s.user_id = p.id AND stocks.subscription_is_live(s.status) AND p.enrolled_plan IS NULL;

-- Admin: enrol a member in a tier (NULL removes the enrolment). The app role
-- has no UPDATE on this column; only this audited function writes it.
CREATE OR REPLACE FUNCTION stocks.admin_set_enrolled_plan(p_admin UUID, p_user UUID, p_plan TEXT, p_note TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  before TEXT;
BEGIN
  PERFORM stocks.assert_platform_admin(p_admin);
  IF coalesce(length(trim(p_note)), 0) < 3 THEN
    RAISE EXCEPTION 'a note is required' USING ERRCODE = 'SS400';
  END IF;
  IF p_plan IS NOT NULL AND p_plan NOT IN ('silver', 'gold', 'diamond') THEN
    RAISE EXCEPTION 'unknown plan' USING ERRCODE = 'SS400';
  END IF;
  SELECT enrolled_plan INTO before FROM stocks.profiles WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown user' USING ERRCODE = 'SS404';
  END IF;
  UPDATE stocks.profiles SET enrolled_plan = p_plan, updated_at = now() WHERE id = p_user;
  INSERT INTO stocks.admin_audit (admin_user_id, action, target_type, target_id, detail)
  VALUES (p_admin, 'set_enrolled_plan', 'user', p_user::text,
          jsonb_build_object('note', left(trim(p_note), 500), 'plan_before', before, 'plan_after', p_plan));
END;
$$;
REVOKE ALL ON FUNCTION stocks.admin_set_enrolled_plan(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stocks.admin_set_enrolled_plan(UUID, UUID, TEXT, TEXT) TO stocks_admin;

-- Every call is live for Gold and Silver too.
CREATE OR REPLACE FUNCTION stocks.signal_live_tiers()
RETURNS TABLE (id BIGINT, gold BOOLEAN, silver BOOLEAN)
LANGUAGE sql
STABLE
SET search_path = stocks, public
AS $$
  SELECT s.id, true, true FROM stocks.signals s
$$;
REVOKE ALL ON FUNCTION stocks.signal_live_tiers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stocks.signal_live_tiers() TO stocks_app, stocks_signals, service_role;
