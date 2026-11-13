# Neon and Better Auth migration

This change replaces Supabase Auth with self-managed Better Auth 1.7.22 and
uses Neon Postgres for both application and identity records. It does not
perform a production cutover when merged. Coordinate configuration and a
fresh import before deploying the migration commit.

## Validated snapshot (November 12, 2026)

- Isolated Neon branch `migration-validation` in the `stock-studio` project.
- All 23 application tables matched the private source snapshot using typed
  row comparisons, not only counts: 35 studies, six identity users, six
  bcrypt credentials, and three workspace memberships.
- Existing UUIDs, workspace access, credits, administrators and signal history
  are retained. Historical imports run before provisioning/outbox triggers are
  attached, so they do not replay credits or Discord deliveries.
- The snapshot is a rehearsal. Export again during cutover; do not overwrite
  a live target with the old snapshot.

## Runtime configuration

Set the following as private environment variables on the web service:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon `stocks_app` connection; default search path `stocks,public` |
| `AUTH_DATABASE_URL` | Neon `stocks_auth` connection; search path `auth,stocks,public` |
| `ADMIN_DATABASE_URL` | Neon `stocks_admin` connection for admin writes |
| `BILLING_DATABASE_URL` | Neon `stocks_billing` connection for verified Stripe webhooks |
| `BETTER_AUTH_SECRET` | Persistent random secret, at least 32 characters |
| `BETTER_AUTH_URL` | `https://stock-studio.onrender.com` or the configured custom origin |
| `NEXT_PUBLIC_APP_URL` | Same public origin, available during build |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `AUTH_EMAIL_FROM` | Verified email sender for signup and password resets |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google OAuth credentials |
| `STOCKS_HOST_SCHEDULER=1` | Minute maintenance loop on a long-running host |
| `STOCKS_ENGINE_ENABLED` | Leave unset until paid research is ready; `1` enables it |
| `OPS_ALERT_WEBHOOK_URL` | Optional private operator Discord webhook |

Set `SIGNALS_DATABASE_URL` on the existing Vercel bot to a Neon
`stocks_signals` connection. Retain its other channel, poster and bot settings.
Neon usernames have no Supabase project suffix. Use TLS; URL-encode passwords.
Create random role passwords privately and enable `LOGIN` for the five runtime
roles after import. Keep the migration owner credential off runtime hosts.
The importer creates roles without login and never writes credentials.

Both the app and bot roles are denied access to password/account tables.
Only `stocks_auth` can manage sessions and credentials. Existing billing/admin
function permissions remain separate. Server app/bot RLS policies retain their
existing server access; routes must still scope all user data by workspace.

## Authentication behavior

Existing passwords work through a bcrypt verifier. New and reset passwords use
Better Auth's scrypt format. Existing sessions and outstanding Supabase reset
or verification links cannot transfer: users must sign in again or request a
new link. Signup and reset require working SMTP. Google callback changes to
`https://<origin>/api/auth/callback/google`; existing Google accounts require a
separate provider-ID migration before enabling that provider. Automatic account
linking is disabled. The validated source accounts all had bcrypt credentials.

## Import and cutover

1. Retain the current source and rollback configuration. Stop writes on the
   web app and pause the bot, research scheduler, source `pg_cron` jobs and
   incoming Stripe processing. Account for Discord input posted while offline
   before resuming the relay; reconnecting alone does not replay that input.
2. Take a consistent fresh catalog/data export: `schema.json` contains tables,
   columns, constraints, sequences, functions and ACLs, views, indexes, policies
   and triggers; `snapshot.json` contains `{name,rows}` for every application
   table plus `identity_users` with legacy password hashes and UUIDs. These
   private files must never enter git, Docker contexts or logs.
3. Use an empty Neon target, first on a disposable validation branch. Install
   required extensions (including `pgcrypto`) and ensure referenced extension
   functions retain their schema names. With a private **direct** owner
   connection in `NEON_DATABASE_URL`, run:

   ```bash
   node --import tsx scripts/import-neon.ts PRIVATE/snapshot.json PRIVATE/schema.json
   ```

   An optional fourth file argument emits private transaction SQL instead of
   connecting. It includes an empty-target guard and typed equality checks.
   A direct import refuses existing schemas, and a failed import may leave a
   partial target: investigate and use a fresh branch rather than retrying over
   it. Preserve the exported snapshot until validation and rollback close.
4. Verify exact rows again, identity UUIDs and credential counts, workspace
   membership and credit balances, admin permissions, and
   `stocks.verify_signal_chain()` (`broken_at` must be null). Validate sign-in,
   email verification/reset and protected cross-workspace queries using runtime
   roles. Provision runtime role logins and configuration from the table above.
5. Deploy the migration commit and configuration together on Render. Point the
   Vercel bot at the **same Neon target**, preserving a single instance. Do not
   run old and new writers against different databases. Replay held Stripe
   events and reconcile any missed Discord input once. Test a fresh input
   message and check its immutable history and delivery record.
6. Verify existing login, administrator access, dashboard studies, journal and
   LEAPS ownership, new signup/trial grant, reset and logout, and Stripe event
   idempotency before reopening writes. The old Supabase project remains intact
   for rollback; deletion is a separate operation after migration acceptance.

## Scheduling

Neon does not run the old Supabase Vault/`pg_net`/`pg_cron` integration. Imported
job-insert notifications become no-ops. On the existing long-running web host,
`instrumentation.ts` starts the opted-in minute scheduler. A transaction-scoped
advisory lock prevents concurrent maintenance across replicas and stays pinned
under pooling. It runs the engine only with `STOCKS_ENGINE_ENABLED=1`; that
includes setup scans and push dispatch handled by the worker. Operator alerts
use `OPS_ALERT_WEBHOOK_URL`, replacing Vault. The Vercel bot retains its own
delivery loop. A free web host sleeps while idle, so this is not an always-on
scheduler; use a persistent host or authenticated external calls to
`POST /api/engine/run` for that requirement. Do not enable this scheduler inside
serverless functions.

## Verification and rollback

`npm test`, `npm run build`, and `npm run typecheck` cover the application.
`tests/auth-migration.test.ts` exercises real Better Auth handlers: migrated
bcrypt login, wrong passwords, browser-session cookies, session revocation,
signup provisioning, email confirmation and single-use password resets.

Before writes reopen, rollback can restore the original commit and saved source
connections, keeping both writers on Supabase. After new writes on Neon,
reconcile them before rolling back; changing URLs alone would lose those writes.
