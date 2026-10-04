# Database installation and upgrades

The active migration directory contains a fresh baseline plus additive repairs for billing,
worker refunds and signal delivery. `archive/` preserves the previously checked-in historical
fragments, including a destructive cleanup of unrelated apps that is deliberately excluded
from fresh replay. Missing original foundation definitions could not be recovered; the baseline
is reconstructed from application queries, types and the available SQL, not an exact historical dump.

## Fresh local install

Use Supabase CLI 2.119.0 or later and Docker:

```bash
supabase start
supabase db reset
npm ci
npm test
npm run build
npm run typecheck
npm audit
```

The baseline creates the isolated `stocks` schema, tenancy, RLS, signup provisioning,
application roles, tables, worker claims and insert notification trigger. API roles have no
write access to billing or signals. Database credentials are configured out of band, never
in a migration. `npm test` replays every active migration in PGlite with a minimal Supabase Auth
fixture; CI also runs concurrent billing and signals checks in PostgreSQL 17.

Local worker automation is optional. Without pg_net/Vault or configured worker secrets the
insert trigger returns without sending a request; queue jobs are still usable through the CLI.
For hosted automation, enable pg_net/pg_cron, configure the two worker Vault secrets, then run
`worker-automation.sql` as the database owner to configure the minute backstop. The URL must
point to `/api/engine/run`, and the secret must equal `ENGINE_WEBHOOK_SECRET`.

## Existing database rollout

1. Take a database backup and use a staging clone first. Check that the existing `stocks`
   schema is complete and `SELECT * FROM stocks.verify_signal_chain()` has `broken_at = NULL`.
   The new insert trigger prevents future ordering corruption; it does not rewrite old hashes.
2. Run `supabase migration list --linked` and export the existing history. The deployed
   history uses full timestamps and includes migrations from formerly shared applications.
   Keep that history intact. Do not bulk mark historical versions reverted to silence a CLI
   mismatch; the archived fragments do not establish every remote migration's provenance.
3. Apply the three new files **in filename order** using the existing Supabase
   `apply_migration` workflow (or the owner SQL editor with your normal migration tracking).
   Review/apply them in a staging clone first, then repeat the reviewed rollout remotely.
   Record the resulting versions and names. The baseline skips an existing complete schema
   and deliberately fails for a partial schema. `supabase db push` against this legacy project
   can reject the differing local/remote histories; resolving that is a separate, reviewed
   baseline-adoption operation, not permission to reset or remove migration records.
4. Apply the SQL migrations before deploying the new signal bot. The old bot's direct INSERT
   permission is revoked; replace/restart it immediately after the migration. The new bot uses
   atomic recording/enqueueing RPCs. No historic signals are bulk resent.
5. Run `npm ci` and deploy/restart the app and bot. Verify a test signal, a completed/refunded
   checkout in Stripe test mode and a forced stale job in staging. Monitor outbox errors.

These repository changes do not execute migrations or change production history automatically.
Reconstructed foundation definitions must be compared with the staging clone before rollout.

For old dead-lettered jobs or refunds lost before this fix, reconciliation requires actual
Stripe/job records. The forward fix restores the refund-aware claim function and records future
refund tombstones; it does not invent past refund events. Replay verified signed refund events
from Stripe, or use the existing admin tools for confirmed adjustments. Do not assume every
historic error should receive another credit refund.
