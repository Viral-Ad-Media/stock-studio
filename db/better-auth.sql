-- Better Auth 1.7.22 core schema (getSchema(auth.options)); user fields are
-- mapped to auth.users by lib/auth.ts. Never expose this schema to clients.
CREATE TABLE auth.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "expiresAt" timestamptz NOT NULL,
  token text NOT NULL UNIQUE, "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL, "ipAddress" text, "userAgent" text,
  "userId" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX sessions_user_idx ON auth.sessions("userId");
CREATE TABLE auth.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "accountId" text NOT NULL,
  "providerId" text NOT NULL, "userId" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
  scope text, password text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
  UNIQUE("providerId", "accountId")
);
CREATE INDEX accounts_user_idx ON auth.accounts("userId");
CREATE TABLE auth.verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identifier text NOT NULL,
  value text NOT NULL, "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
);
CREATE INDEX verifications_identifier_idx ON auth.verifications(identifier);
CREATE TABLE auth."rateLimit" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL UNIQUE,
  count integer NOT NULL, "lastRequest" bigint NOT NULL
);
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM PUBLIC;
