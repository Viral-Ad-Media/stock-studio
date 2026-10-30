# Signal relay (Supabase Edge Function)

The relay does the signal bot's job in short passes instead of holding a Discord
connection open. pg_cron calls it once a minute. Each pass reads the latest 50
messages in the input channel, records approved calls with `stocks.record_signal`,
reacts to mark each message handled, and posts queued signals to the member
channels. The logic lives in [`lib/signal-relay.ts`](../../../lib/signal-relay.ts)
and is tested in `tests/signal-relay.test.ts`.

It replaces the Vercel daemon, which was billed for a reserved vCPU every hour it
was up. Edge Function calls fit in Supabase's free quota (about 45,000 a month).

Differences from the gateway bot ([`scripts/signal-bot.ts`](../../../scripts/signal-bot.ts)):

- A signal is posted within about a minute of being typed, not instantly.
- The bot's reaction is the "handled" mark (📥 queued, ❓ bad format, ⛔ not an
  approved poster, ⚠️ not saved). Don't remove the bot's reactions in the input
  channel, or that message is processed again. A replay is safe: the record and
  the posts are deduplicated in the database.
- Messages older than 24 hours are ignored.
- No reply when a poster edits a message. Edits still never change the record.

Both can run at the same time while you switch over. They share the database
leases and the same bot user, so a signal is still posted once.

## Setup

Run from the repository root with the [Supabase CLI](https://supabase.com/docs/guides/cli),
logged in to the account that owns the project:

```sh
supabase link --project-ref nxwehsafitrcoenbrkyv
# Pick a long random value for SIGNAL_RELAY_SECRET (for example `openssl rand -hex 32`).
supabase secrets set SIGNAL_RELAY_SECRET=... DISCORD_TOKEN=... SIGNALS_DATABASE_URL=... \
  INPUT_CHANNEL_ID=... SIGNALS_CHANNEL_ID=... SIGNAL_POSTER_IDS=...
# Optional, same values as the daemon used:
supabase secrets set GOLD_SIGNALS_CHANNEL_ID=... SILVER_SIGNALS_CHANNEL_ID=...
supabase functions deploy signal-relay --no-verify-jwt
```

Use the same values the Vercel daemon has. Type the secrets into your own
terminal; never commit them or paste them into chat. `--no-verify-jwt` is needed
because pg_cron authenticates with `x-relay-secret`, not a Supabase JWT.

Then, in the SQL editor, store the function URL and the same secret in Vault and
run [`supabase/signal-relay.sql`](../../signal-relay.sql), which schedules the
`stocks-signal-relay` cron job.

## Checking it

- Post `ALERT TEST testing the relay` from an approved account. Within a minute
  it gets 📥 and the embed appears in the member channel.
- Function logs: Supabase dashboard → Edge Functions → signal-relay → Logs.
- Each pass calls `stocks.signal_bot_heartbeat`, so the `signal_bot_down` ops
  alert still fires if passes stop for more than 5 minutes.
- To stop: `SELECT cron.unschedule('stocks-signal-relay');`
