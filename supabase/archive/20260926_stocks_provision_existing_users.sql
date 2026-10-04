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
