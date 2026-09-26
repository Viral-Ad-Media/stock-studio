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
INSERT INTO stocks.platform_admins (user_id)
SELECT id FROM auth.users WHERE lower(email) = 'viraladmediacontent@gmail.com'
ON CONFLICT DO NOTHING;

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
