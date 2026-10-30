# Discord relay on Vercel Daemons

> Retired 2026-10-30. A daemon is billed for its reserved vCPU every hour it
> runs (1 GiB, the smallest size, always reserves 1 vCPU), and on Hobby a
> nonstop instance passes the 420 GB-hour monthly memory quota around the
> 18th. The signal relay now runs as a Supabase Edge Function once a minute:
> see [supabase/functions/signal-relay](../../supabase/functions/signal-relay/README.md).
> `vercel.json` keeps the daemon defined with zero instances.

Use a dedicated Vercel project for the relay. Leave the existing Stock Studio web
deployment unchanged. Daemons are a public beta; check the current limits and
pricing at https://vercel.com/docs/daemons/limits before enabling an instance.

## Deployment

Keep the Vercel project's Root Directory at the repository root. The container
build needs the root package lock, scripts and library files. The daemon has no
inbound HTTP listener; the static page is project information, not a health check.

Copy `deploy/signal-bot/vercel.json` to the repository root as `vercel.json` in
a separate deployment checkout. All paths in the configuration are relative to
that repository root. Link that checkout to the dedicated relay project:

```sh
cp deploy/signal-bot/vercel.json vercel.json
vercel link --scope viral-ad-tech --project stock-studio-signals
vercel --prod --scope viral-ad-tech
```

The template starts with **zero instances**. Deploy it, add the environment
variables below for Production, and redeploy to capture those variables. Then
set the daemon's instance count to **one in iad1** in the Vercel dashboard.
Do not run a second copy on another host. Preview deployments do not run daemons.

## Production environment variables

| Name | Value |
| --- | --- |
| `DISCORD_TOKEN` | Bot token; enter directly in Vercel as a sensitive variable |
| `SIGNALS_DATABASE_URL` | TLS Supabase transaction-pooler URL for `stocks_signals`; enter directly as a sensitive variable |
| `INPUT_CHANNEL_ID` | Private signal input channel ID |
| `SIGNALS_CHANNEL_ID` | Diamond (every call) signals channel ID |
| `GOLD_SIGNALS_CHANNEL_ID` | Optional: Gold channel ID (weekly picks and their follow-ups) |
| `SILVER_SIGNALS_CHANNEL_ID` | Optional: Silver channel ID (monthly pick and its follow-ups) |
| `SIGNAL_POSTER_IDS` | Comma-separated numeric IDs of approved posters |

Optional: `SIGNAL_FOOTER` and `SIGNAL_DISCLAIMER`. Keep tokens and database
credentials out of Git, build arguments in the Dockerfile, and chat. The image
copies only the runtime files and never reads deployment secrets during build.
The image installs only the bot's runtime dependencies (discord.js, postgres,
dotenv and `tsx`, the bot launcher) from `deploy/signal-bot/package-lock.json`,
not the web app's. Keep those versions in step with the root lock.

## Build size

Every production build pushes a new image to Vercel Container Registry, and the
registry keeps old images until they are deleted. `ignoreCommand` runs
`deploy/signal-bot/ignore-build.sh`, which skips preview branches (they never
run daemons) and skips `main` commits that don't touch the bot's files. To
clear old images, list them with `vercel vcr image ls daemon.signal-bot
--project stock-studio-signals` and remove all but the running one with
`vercel vcr image rm`.

## Verification and stopping

Check Logs for `signal-bot: logged in as ...`. From an approved Discord account,
post `ALERT TEST testing the bot` in the input channel. This creates a permanent
test record and posts a test embed to the member channel. Confirm the queued
reaction, the embed, and the record in Stock Studio's `/signals` page. An
unapproved account must not publish. See [README.md](README.md) for retries and
the append-only record guarantees.

To stop, scale the daemon to zero. Environment changes require a new production
deployment. On Hobby, the CPU quota can stop the daemon until the next month;
on Pro, CPU and provisioned memory are billed. Monitor usage and delivery logs.
