-- Self-managed Better Auth identity. UUIDs preserve existing application FKs.
CREATE SCHEMA auth;
REVOKE ALL ON SCHEMA auth FROM PUBLIC;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '', email_verified boolean NOT NULL DEFAULT false,
  image text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}',
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}',
  last_sign_in_at timestamptz
);
-- Compatibility for historical policies. There is no browser-facing SQL API;
-- request identity is validated by Better Auth, and route queries scope by ws.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
REVOKE ALL ON FUNCTION auth.uid() FROM PUBLIC;
