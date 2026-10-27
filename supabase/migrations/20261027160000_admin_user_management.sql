-- Super admin user management: invite, disable, remove, and the admin role.
--
-- Same model as the other admin changes: every write is a SECURITY DEFINER
-- function only stocks_admin may execute, each one checks platform_admins and
-- writes stocks.admin_audit. The auth schema is shared with other apps, so
-- nothing here creates or deletes auth.users rows: "remove" deletes the
-- Stock Studio account and data, and an invite is applied when that email
-- first gets a Stock Studio profile (signup trigger or first sign-in).

-- Disabled accounts keep their data but can't use the app (lib/workspace.ts).
ALTER TABLE stocks.profiles
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT;

-- What a new account starts with, set by an admin before the person signs up.
-- Grants are columns rather than a plan enum so membership tiers can add
-- their own field without reworking invites.
CREATE TABLE IF NOT EXISTS stocks.admin_invites (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL CHECK (email = lower(trim(email)) AND email LIKE '%_@_%'),
  credits INT NOT NULL DEFAULT 0 CHECK (credits BETWEEN 0 AND 10000),
  trial_days INT CHECK (trial_days BETWEEN 1 AND 365),
  access_granted BOOLEAN NOT NULL DEFAULT false,
  note TEXT NOT NULL,
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  claimed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_invites_open_email_key
  ON stocks.admin_invites (email) WHERE claimed_at IS NULL AND revoked_at IS NULL;
ALTER TABLE stocks.admin_invites ENABLE ROW LEVEL SECURITY;
-- The schema's default privileges give stocks_app full DML; it only reads.
REVOKE ALL ON stocks.admin_invites FROM PUBLIC, anon, authenticated, stocks_app;
GRANT SELECT ON stocks.admin_invites TO stocks_app;

-- Applies an open invite for this user's email to their new profile. Called
-- by provision_user in the same transaction that creates the profile.
CREATE OR REPLACE FUNCTION stocks.apply_admin_invite(p_user UUID, p_workspace UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  inv stocks.admin_invites;
BEGIN
  SELECT i.* INTO inv
  FROM stocks.admin_invites i
  JOIN auth.users u ON lower(u.email) = i.email
  WHERE u.id = p_user AND i.claimed_at IS NULL AND i.revoked_at IS NULL
  FOR UPDATE OF i;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE stocks.admin_invites SET claimed_at = now(), claimed_by = p_user WHERE id = inv.id;
  UPDATE stocks.profiles
  SET access_granted = access_granted OR inv.access_granted,
      trial_ends_at = CASE WHEN inv.trial_days IS NULL THEN trial_ends_at
                           ELSE greatest(trial_ends_at, now() + make_interval(days => inv.trial_days)) END,
      updated_at = now()
  WHERE id = p_user;
  IF inv.credits > 0 THEN
    INSERT INTO stocks.credits_ledger (workspace_id, delta, reason, ref)
    VALUES (p_workspace, inv.credits, 'admin_adjust', 'invite:' || inv.id)
    ON CONFLICT (reason, ref) WHERE ref IS NOT NULL DO NOTHING;
  END IF;
  INSERT INTO stocks.admin_audit (admin_user_id, action, target_type, target_id, detail)
  VALUES (inv.invited_by, 'invite_claimed', 'user', p_user::text,
          jsonb_build_object('invite_id', inv.id, 'email', inv.email, 'credits', inv.credits,
                             'trial_days', inv.trial_days, 'access_granted', inv.access_granted, 'note', inv.note));
END;
$$;
REVOKE ALL ON FUNCTION stocks.apply_admin_invite(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- provision_user as before, plus the invite.
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

  PERFORM stocks.apply_admin_invite(p_user_id, ws_id);
  RETURN ws_id;
END;
$$;
REVOKE ALL ON FUNCTION stocks.provision_user(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stocks.provision_user(UUID) TO stocks_app, service_role;

-- A disabled account loses the admin console too.
CREATE OR REPLACE FUNCTION stocks.assert_platform_admin(p_admin UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM stocks.platform_admins a
    LEFT JOIN stocks.profiles p ON p.id = a.user_id
    WHERE a.user_id = p_admin AND p.disabled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not a platform admin' USING ERRCODE = 'SS403';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION stocks.assert_platform_admin(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION stocks.assert_admin_note(p_note TEXT)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF coalesce(length(trim(p_note)), 0) < 3 THEN
    RAISE EXCEPTION 'a note is required' USING ERRCODE = 'SS400';
  END IF;
END;
$$;

-- Add a user by email. An email that already has a Stock Studio account is
-- refused; one that has a login from another app on this project is set up
-- now; anyone else gets an open invite, applied when they sign up.
-- Returns ('provisioned', user id) or ('invited', NULL).
CREATE OR REPLACE FUNCTION stocks.admin_create_user(
  p_admin UUID, p_email TEXT, p_credits INT, p_trial_days INT, p_access BOOLEAN, p_note TEXT
)
RETURNS TABLE (status TEXT, user_id UUID, invite_id BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
#variable_conflict use_column
DECLARE
  addr TEXT := lower(trim(p_email));
  existing UUID;
  new_invite BIGINT;
  ws UUID;
BEGIN
  PERFORM stocks.assert_platform_admin(p_admin);
  PERFORM stocks.assert_admin_note(p_note);
  IF addr IS NULL OR addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(addr) > 254 THEN
    RAISE EXCEPTION 'enter a valid email address' USING ERRCODE = 'SS400';
  END IF;
  IF coalesce(p_credits, 0) < 0 OR coalesce(p_credits, 0) > 10000 THEN
    RAISE EXCEPTION 'credits must be between 0 and 10000' USING ERRCODE = 'SS400';
  END IF;
  IF p_trial_days IS NOT NULL AND (p_trial_days < 1 OR p_trial_days > 365) THEN
    RAISE EXCEPTION 'trial days must be between 1 and 365' USING ERRCODE = 'SS400';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('stocks.admin_create_user:' || addr));

  SELECT u.id INTO existing FROM auth.users u WHERE lower(u.email) = addr ORDER BY u.created_at LIMIT 1;
  IF existing IS NOT NULL AND EXISTS (SELECT 1 FROM stocks.profiles p WHERE p.id = existing) THEN
    RAISE EXCEPTION 'this email already has a Stock Studio account' USING ERRCODE = 'SS400';
  END IF;
  IF EXISTS (SELECT 1 FROM stocks.admin_invites i WHERE i.email = addr AND i.claimed_at IS NULL AND i.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'this email already has an open invite' USING ERRCODE = 'SS400';
  END IF;

  INSERT INTO stocks.admin_invites (email, credits, trial_days, access_granted, note, invited_by)
  VALUES (addr, coalesce(p_credits, 0), p_trial_days, coalesce(p_access, false), left(trim(p_note), 500), p_admin)
  RETURNING id INTO new_invite;
  INSERT INTO stocks.admin_audit (admin_user_id, action, target_type, target_id, detail)
  VALUES (p_admin, 'invite_user', 'invite', new_invite::text,
          jsonb_build_object('email', addr, 'credits', coalesce(p_credits, 0), 'trial_days', p_trial_days,
                             'access_granted', coalesce(p_access, false), 'note', left(trim(p_note), 500)));

  IF existing IS NOT NULL THEN
    -- Claims the invite just created.
    ws := stocks.provision_user(existing);
    RETURN QUERY SELECT 'provisioned'::text, existing, new_invite;
  ELSE
    RETURN QUERY SELECT 'invited'::text, NULL::uuid, new_invite;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION stocks.admin_revoke_invite(p_admin UUID, p_invite BIGINT, p_note TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  addr TEXT;
BEGIN
  PERFORM stocks.assert_platform_admin(p_admin);
  PERFORM stocks.assert_admin_note(p_note);
  UPDATE stocks.admin_invites SET revoked_at = now()
  WHERE id = p_invite AND claimed_at IS NULL AND revoked_at IS NULL
  RETURNING email INTO addr;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no open invite with that id' USING ERRCODE = 'SS404';
  END IF;
  INSERT INTO stocks.admin_audit (admin_user_id, action, target_type, target_id, detail)
  VALUES (p_admin, 'revoke_invite', 'invite', p_invite::text,
          jsonb_build_object('email', addr, 'note', left(trim(p_note), 500)));
END;
$$;

-- Disable or re-enable an account. An admin can't disable their own account.
CREATE OR REPLACE FUNCTION stocks.admin_set_disabled(p_admin UUID, p_user UUID, p_disabled BOOLEAN, p_note TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  before TIMESTAMPTZ;
BEGIN
  PERFORM stocks.assert_platform_admin(p_admin);
  PERFORM stocks.assert_admin_note(p_note);
  IF p_disabled AND p_user = p_admin THEN
    RAISE EXCEPTION 'you can''t disable your own account' USING ERRCODE = 'SS400';
  END IF;
  SELECT disabled_at INTO before FROM stocks.profiles WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown user' USING ERRCODE = 'SS404';
  END IF;
  UPDATE stocks.profiles
  SET disabled_at = CASE WHEN p_disabled THEN coalesce(disabled_at, now()) END,
      disabled_reason = CASE WHEN p_disabled THEN left(trim(p_note), 500) END,
      updated_at = now()
  WHERE id = p_user;
  INSERT INTO stocks.admin_audit (admin_user_id, action, target_type, target_id, detail)
  VALUES (p_admin, CASE WHEN p_disabled THEN 'disable_user' ELSE 'enable_user' END, 'user', p_user::text,
          jsonb_build_object('note', left(trim(p_note), 500), 'disabled_before', before));
END;
$$;

-- Give or take the super admin role. Never your own, so one always remains.
CREATE OR REPLACE FUNCTION stocks.admin_set_platform_admin(p_admin UUID, p_user UUID, p_admin_role BOOLEAN, p_note TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
BEGIN
  PERFORM stocks.assert_platform_admin(p_admin);
  PERFORM stocks.assert_admin_note(p_note);
  IF p_user = p_admin THEN
    RAISE EXCEPTION 'you can''t change your own admin role' USING ERRCODE = 'SS400';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('stocks.platform_admins'));
  IF NOT EXISTS (SELECT 1 FROM stocks.profiles WHERE id = p_user) THEN
    RAISE EXCEPTION 'unknown user' USING ERRCODE = 'SS404';
  END IF;
  IF p_admin_role THEN
    IF EXISTS (SELECT 1 FROM stocks.profiles WHERE id = p_user AND disabled_at IS NOT NULL) THEN
      RAISE EXCEPTION 'enable the account before making it an admin' USING ERRCODE = 'SS400';
    END IF;
    INSERT INTO stocks.platform_admins (user_id) VALUES (p_user) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM stocks.platform_admins WHERE user_id = p_user;
  END IF;
  INSERT INTO stocks.admin_audit (admin_user_id, action, target_type, target_id, detail)
  VALUES (p_admin, CASE WHEN p_admin_role THEN 'grant_admin' ELSE 'revoke_admin' END, 'user', p_user::text,
          jsonb_build_object('note', left(trim(p_note), 500)));
END;
$$;

-- Remove a Stock Studio account: its profile, admin role, memberships, and
-- the workspaces only this user belongs to (studies, watchlist, journal,
-- ledger…). The login itself stays, since it may be used by another app; if
-- they sign in again they start over as a new account. Accounts with payment
-- records can't be removed (Stripe history would go with them): disable them.
-- p_confirm_email must match the account's email.
CREATE OR REPLACE FUNCTION stocks.admin_remove_user(p_admin UUID, p_user UUID, p_confirm_email TEXT, p_note TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
DECLARE
  addr TEXT;
  owned UUID[];
  counts JSONB;
BEGIN
  PERFORM stocks.assert_platform_admin(p_admin);
  PERFORM stocks.assert_admin_note(p_note);
  IF p_user = p_admin THEN
    RAISE EXCEPTION 'you can''t remove your own account' USING ERRCODE = 'SS400';
  END IF;
  PERFORM 1 FROM stocks.profiles WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown user' USING ERRCODE = 'SS404';
  END IF;
  SELECT lower(email) INTO addr FROM auth.users WHERE id = p_user;
  IF addr IS NULL OR addr <> lower(trim(coalesce(p_confirm_email, ''))) THEN
    RAISE EXCEPTION 'type the account''s email to confirm' USING ERRCODE = 'SS400';
  END IF;
  IF EXISTS (SELECT 1 FROM stocks.platform_admins WHERE user_id = p_user) THEN
    RAISE EXCEPTION 'remove the admin role first' USING ERRCODE = 'SS400';
  END IF;

  SELECT coalesce(array_agg(m.workspace_id), '{}') INTO owned
  FROM stocks.workspace_members m
  WHERE m.user_id = p_user
    AND NOT EXISTS (SELECT 1 FROM stocks.workspace_members o WHERE o.workspace_id = m.workspace_id AND o.user_id <> p_user);
  IF EXISTS (SELECT 1 FROM stocks.payments WHERE user_id = p_user OR workspace_id = ANY (owned)) THEN
    RAISE EXCEPTION 'this account has payment records, so it can''t be removed; disable it instead' USING ERRCODE = 'SS400';
  END IF;

  SELECT jsonb_build_object(
    'workspaces', cardinality(owned),
    'studies', (SELECT count(*) FROM stocks.case_studies WHERE workspace_id = ANY (owned)),
    'watchlist', (SELECT count(*) FROM stocks.watchlist WHERE workspace_id = ANY (owned)),
    'balance', (SELECT coalesce(sum(delta), 0) FROM stocks.credits_ledger WHERE workspace_id = ANY (owned))
  ) INTO counts;

  -- Audit first: the row outlives the account (target ids are text).
  INSERT INTO stocks.admin_audit (admin_user_id, action, target_type, target_id, detail)
  VALUES (p_admin, 'remove_user', 'user', p_user::text,
          jsonb_build_object('email', addr, 'note', left(trim(p_note), 500), 'workspace_ids', to_jsonb(owned)) || counts);

  DELETE FROM stocks.profiles WHERE id = p_user;
  DELETE FROM stocks.workspace_members WHERE user_id = p_user;
  DELETE FROM stocks.workspaces WHERE id = ANY (owned);
  -- A later signup with this email shouldn't pick up an old invite.
  UPDATE stocks.admin_invites SET revoked_at = now() WHERE email = addr AND claimed_at IS NULL AND revoked_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION stocks.assert_admin_note(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stocks.admin_create_user(UUID, TEXT, INT, INT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stocks.admin_revoke_invite(UUID, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stocks.admin_set_disabled(UUID, UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stocks.admin_set_platform_admin(UUID, UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stocks.admin_remove_user(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stocks.admin_create_user(UUID, TEXT, INT, INT, BOOLEAN, TEXT) TO stocks_admin;
GRANT EXECUTE ON FUNCTION stocks.admin_revoke_invite(UUID, BIGINT, TEXT) TO stocks_admin;
GRANT EXECUTE ON FUNCTION stocks.admin_set_disabled(UUID, UUID, BOOLEAN, TEXT) TO stocks_admin;
GRANT EXECUTE ON FUNCTION stocks.admin_set_platform_admin(UUID, UUID, BOOLEAN, TEXT) TO stocks_admin;
GRANT EXECUTE ON FUNCTION stocks.admin_remove_user(UUID, UUID, TEXT, TEXT) TO stocks_admin;
