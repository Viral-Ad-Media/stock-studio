# Discord relay on Vercel Daemons

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
| `SIGNALS_CHANNEL_ID` | Member trade signals channel ID |
| `SIGNAL_POSTER_IDS` | Comma-separated numeric IDs of approved posters |

Optional: `SIGNAL_FOOTER` and `SIGNAL_DISCLAIMER`. Keep tokens and database
credentials out of Git, build arguments in the Dockerfile, and chat. The image
copies only the runtime files and never reads deployment secrets during build.
The runtime installs development dependencies because `tsx` is the bot launcher.

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
