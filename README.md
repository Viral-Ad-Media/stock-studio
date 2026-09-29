# Stock Studio

Fact-checked, source-cited stock case studies as a multi-tenant SaaS. A user queues a ticker, a
research engine builds the report, and the finished study appears in the app.

The output is **educational business analysis, never personalized investment advice**. Every study
opens with an "As of [date]" line and ends with a "Not investment advice" line.

- **App**: Next.js 16 (App Router, React 19), Tailwind. Runs locally on port 3200 and is deployed on Vercel or Render.
- **Database**: hosted Postgres on Supabase, in an isolated `stocks` schema.
- **Auth**: Supabase Auth. Each signup gets its own workspace.
- **Billing**: Stripe. A 30-day trial, then a one-time access fee, then per-report credits.
- **Research engine**: an automated Anthropic API worker, with a manual CLI fallback.
- **Market data**: unauthenticated Yahoo Finance endpoints (no API key).

---

## Contents

- [What it produces](#what-it-produces)
- [Insights: grades, thesis tracking, earnings, market context, setup bots, gamma](#insights-grades-thesis-tracking-earnings-market-context-setup-bots-gamma)
- [Trade signals](#trade-signals)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [The research engine](#the-research-engine)
- [Billing](#billing)
- [Accounts & sign-in](#accounts--sign-in)
- [Multi-tenancy & security](#multi-tenancy--security)
- [Database](#database)
- [CLI scripts](#cli-scripts)
- [Project structure](#project-structure)
- [Deployment](#deployment)
- [Content rules](#content-rules)
- [Troubleshooting](#troubleshooting)

---

## What it produces

| Format (`variant`) | What you get | Credits |
|---|---|---|
| `quick_take` | 1–2 sentence verdict plus one condensed card | 2 |
| `full` | 4-card study: growth, profitability, valuation, moat, plus a bear case | 5 |
| `carousel` | Tight copy sized for IG/TikTok/LinkedIn slides | 5 |
| `newsletter` | Newsletter section with paragraphs, subheads and a narrative arc | 5 |
| `script` | Video script: voiceover lines plus on-screen text per card | 5 |
| `memo` | Deep research memo: source table, bear/base/bull cases, valuation sensitivity | 8 |
| `comparison` | Two or more tickers side by side | 3 |
| `earnings_update` | Post-earnings changes against a prior study (from a study's page) | 3 |
| `one_candle` | One-candle intraday setup check (educational framework) | 2 |
| `davinci_model` | "Da Vinci" liquidity model check (educational framework) | 2 |
| `movers_digest` | Today's top 5 gainers and losers, each with a verified story (dashboard button) | 3 |
| watchlist entry | Tracker row: thesis, snapshot, 2–3 triggers, status tag | 3 |

Prices live in one place, `CREDIT_COSTS` in [`lib/shared.ts`](lib/shared.ts). The `/pricing`
page, the New Study form and the charge made at queue time all read from it, so change prices
there and nowhere else.

The **one_candle** and **davinci_model** variants are strictly educational framework analysis
built only from real fetched candles. They give no trade directives and make no profitability
claims, and each has its own required footer. See [`lib/engine/methodology.md`](lib/engine/methodology.md) for
the full methodology of each.

---

## Insights: grades, thesis tracking, earnings, market context, setup bots, gamma

These features are adapted from [QuantEdgeResearch](https://github.com/Maleek23/QuantEdgeResearch). Each one was
narrowed to fit Stock Studio's educational, no-advice framing for research features. Trade execution and
options-flow alerts were left out. Directional trade calls and Discord/SMS signal alerts are now a separate
feature, [Trade signals](#trade-signals), with its own rules.

- **Research grade and one-line summary.** Fundamental studies get a letter grade (A to F) built from four card
  scores: growth, profitability, valuation (higher means more reasonable) and moat.
  - The engine scores each card from the verified facts in the study.
  - [`lib/grades.ts`](lib/grades.ts) computes the letter from the average of the four scores, on bands that follow
    the scoring calibration: 70+ (✅ cards) is A to B-, 45–69 (⚠️, with 50 = unremarkable) is C+ to C-, and
    below 45 (🔴) is D+ to F (F only under 30). The letter is re-derived from the stored score when shown.
  - Each study also gets a one-sentence "what this means" line, shown on dashboard cards.
  - The grade is labelled a research-quality score, never a buy or sell rating.
- **Thesis tracker.** Every watchlist refresh judges the previous thesis as intact, weakening or broken, and cites
  the development that decided it.
  - Every version is kept (`watchlist_history`) and shown as a timeline.
  - Study pages show how the price has moved since the as-of date, next to SPY.
- **Earnings calendar.** Upcoming and just-reported earnings dates for your watchlist and studied tickers come from
  Nasdaq's public calendar. A just-reported ticker links to its study, where you can queue an earnings update.
- **Market context (`/market`).** Shows:
  - sector ETFs against SPY over 1 day, 5 days and 1 month;
  - large-cap breadth: the share above the 50- and 200-day averages, advancers and decliners, and names near
    52-week highs and lows;
  - today's biggest movers;
  - plain-English readings generated from those numbers.

  Market data is cached for about 30 minutes (Next's fetch cache).
- **Setup bots (`/setups`).** Five rule-based scanners check about 100 large caps after every close for published
  chart patterns: 52-week breakout, RSI(2) pullback in an uptrend, pullback to a rising 50-day average, unusual
  volume, and post-earnings gap.
  - A match lists the pattern's own reference and failure levels. It is never a buy/sell call.
  - One model call per scan writes descriptive "desk notes"; any note that reads like advice is dropped.
  - Every match is paper-tracked against SPY over the bot's horizon, and the page shows each bot's record.
  - The worker runs the scan once per completed session. `npm run engine -- scan-setups [--force]` runs it by hand.
- **Gamma exposure (`/gamma`).** A dealer-gamma model for SPY, SPX, QQQ, IWM or any optionable symbol, built from
  CBOE's free delayed chains. It shows net gamma per 1% move, the zero-gamma level, the largest call and put
  strikes, and a strike-by-strike chart, with the model's assumptions spelled out on the page.

---

## Trade signals

The program trader's own calls (BUY, SELL, EXIT, CLOSE, ALERT, with optional entry, target and stop),
reposted to members. This is the one feature that makes directional trade calls; the research features
above stay educational.

- **Posting.** The trader types one line in a private Discord channel, e.g.
  `BUY GOOGL CALL @12.40 tp 15 sl 11 breakout over 285`. The signal bot
  ([`scripts/signal-bot.ts`](scripts/signal-bot.ts), parser [`lib/signals.ts`](lib/signals.ts)) records it,
  then posts a formatted signal to the members' channel.
- **Who can post.** Only Discord user IDs listed in `SIGNAL_POSTER_IDS`. The bot refuses to start without
  at least one, and anyone else gets a ⛔ with nothing posted.
- **Track record.** `stocks.signals` in Postgres: append-only (updates, deletes and truncates are refused by
  triggers, for every role), timestamped by the database, and SHA-256 hash-chained row to row.
  `stocks.verify_signal_chain()` recomputes the chain; `/signals` shows the result. Deliveries go in the
  insert-only `stocks.signal_deliveries`. A signal is recorded before it's posted, and a message is
  recorded once even if processed twice.
- **Roles.** The bot connects as `stocks_signals` (`SIGNALS_DATABASE_URL`), which can only insert and read
  those two tables. The web app's role can only read them.
- **Who sees it.** `/signals` is for members with paid access (`profiles.access_granted`) and platform
  admins, not trial accounts. No credits are charged. Like setup scans, signals are program-wide data
  without a `workspace_id`.
- **Secrets.** The bot token lives only in a root-only env file on the bot host, loaded by systemd.
  Deploy steps: [`deploy/signal-bot/README.md`](deploy/signal-bot/README.md).
- **SMS.** The rules allow SMS alerts and `signal_deliveries` accepts an `sms` channel, but no SMS
  sender is built yet.

---

## Architecture

```
            ┌───────────────────────── Next.js app (Vercel) ──────────────────────────┐
 browser ──▶│ (marketing)  /  /pricing  /terms  /privacy          ← public            │
            │ (app)        /dashboard /new /watchlist /study/[id] /billing ← session  │
            │ api/         case-studies · watchlist · jobs         ← session          │
            │              billing/checkout                        ← session          │
            │              billing/webhook   ◀── Stripe            ← signature        │
            │              engine/run        ◀── Postgres          ← shared secret    │
            └───────┬─────────────────────────────────────────────────────▲──────────┘
                    │ postgres (stocks_app role)                          │ pg_net POST
            ┌───────▼─────────────── Supabase: schema "stocks" ───────────┴──────────┐
            │ jobs ──INSERT trigger──▶ notify_job_inserted()  +  pg_cron every minute │
            │ case_studies · watchlist · workspaces · profiles · credits_ledger ·    │
            │ payments · RPCs: claim_job, charge/refund_job_credits, fulfill_checkout │
            └─────────────────────────────────────────────────────────────────────────┘
                    ▲
                    │ npm run engine (CLI)  ← manual fallback
```

**Lifecycle of a report:**

1. A user submits `/new`. `POST /api/case-studies` checks access, then in **one transaction**
   inserts the `case_studies` row (status `queued`) and the `jobs` row, and charges credits.
2. The job INSERT fires a Postgres trigger that POSTs to `/api/engine/run`. A `pg_cron` job
   repeats that POST every minute as a backstop.
3. The worker claims the job (`claim_job()`, which marks the study `building`), fetches market
   data and/or researches, calls the Anthropic API, and writes the markdown back (`ready`).
4. On a permanent failure the job and study are set to `error` and the credits are refunded.
5. The dashboard refreshes itself while jobs are pending.

---

## Getting started

### Prerequisites

- Node 20+
- Access to the Supabase project that hosts the `stocks` schema, including a password for the
  `stocks_app` role
- (Optional) an Anthropic API key, and Stripe test-mode keys

### Install & run

```bash
npm install
cp .env.example .env.local      # then fill it in (see below)
npm run dev                     # http://localhost:3200
```

At minimum, local dev needs `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Without the Supabase auth vars, the auth gate is skipped in dev
and the app refuses to start in production (503).

### Build

```bash
npx next build
```

The build doesn't need `DATABASE_URL`; the database client connects lazily on the first query.

---

## Environment variables

All variables are listed in [`.env.example`](.env.example).

| Variable | Needed for | Notes |
|---|---|---|
| `DATABASE_URL` | everything | Supabase **transaction pooler**, `stocks_app` role (`stocks_app.<ref>` username). |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | auth | From Project Settings → API. |
| `SUPABASE_PROJECT_ID` | tooling | Project ref, for read-only inspection with the Supabase SQL tools. |
| `NEXT_PUBLIC_APP_URL` | login + Stripe redirects, canonical URLs, sitemap, social cards | **Set it in production, available at build time**, e.g. `https://app.example.com`. Behind a host's proxy the server sees itself as `0.0.0.0:$PORT`. Without it, `appOrigin()` falls back to the forwarded `Host` header and SEO URLs fall back to Render's/Vercel's own public URL. |
| `ANTHROPIC_API_KEY` | automated worker | |
| `ENGINE_WEBHOOK_SECRET` | automated worker | Must equal the Vault secret `engine_webhook_secret`. |
| `ENGINE_WEB_RESEARCH` | automated worker | `1` also automates web-research variants. Off by default ([why](#automated-worker)). |
| `ENGINE_INVOCATION_BUDGET_MS` / `ENGINE_MIN_CLAIM_MS` / `ENGINE_MAX_CALL_MS` | automated worker | Optional tuning: total budget per invocation, the minimum time left to start another job, and the cap on one model call. Defaults 280000 / 150000 / 170000 fit a 300 s serverless limit. On Render (no function limit) deep-research jobs need more, e.g. 720000 / 150000 / 600000. A running job's lock goes stale after the budget plus 2 minutes. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | billing | |
| `BILLING_DATABASE_URL` | billing (webhook only) | Pooler URL for the `stocks_billing` role, the only role allowed to grant access or credits. Set its password first in the Supabase SQL editor: `ALTER ROLE stocks_billing WITH PASSWORD '…';`. |
| `STRIPE_PRICE_ACCESS` | billing | Price id of the one-time access fee. |
| `STRIPE_PRICE_CREDIT_PACK` | billing | Price id of one credit pack. |
| `STRIPE_CREDITS_PER_PACK` | billing | Credits granted per pack. Default 10. |
| `DISCORD_TOKEN`, `INPUT_CHANNEL_ID`, `SIGNALS_CHANNEL_ID`, `SIGNAL_POSTER_IDS`, `SIGNALS_DATABASE_URL` | signal bot host only | Never on the web host. See [`deploy/signal-bot/env.example`](deploy/signal-bot/env.example); in production they live in a root-only env file. |

---

## The research engine

The engine runs in two modes that share one jobs queue and one methodology file:
[`lib/engine/methodology.md`](lib/engine/methodology.md).

### Automated worker

- **Entry point**: `POST /api/engine/run`, authenticated by the `x-engine-secret` header. It's
  called by the `on_job_inserted` trigger and by the `stocks-engine-drain-backstop` cron job,
  both using the URL and secret stored in Supabase Vault.
- **Claiming jobs**: `stocks.claim_job()` uses `FOR UPDATE SKIP LOCKED`, so concurrent
  invocations never take the same job.
  - A job counts as stale after 6 minutes, longer than any single invocation can run.
  - After 3 attempts a stale job is marked `error` and its credits are refunded.
- **Time budget**: each invocation has a 280s deadline, under the route's 300s `maxDuration`.
  - Every Anthropic call gets a timeout sized to what's left of that deadline (at most 170s,
    and 30s for the extraction call). Yahoo fetches time out after 15s.
  - The worker only starts another job if at least 150s remain.
  - So a job finishes or fails cleanly instead of being killed mid-run.
- **Anthropic client** ([`lib/engine/anthropic.ts`](lib/engine/anthropic.ts)):
  - `maxRetries: 0`, so the job's attempts counter is the only retry mechanism.
  - Only a response that ends naturally (`end_turn`) is published. Output cut off by the length
    limit, or a refusal, fails the job and refunds it. A paused web-search turn (`pause_turn`)
    is resumed.
  - **Cost controls**: each format has a web-search budget (`lib/engine/budgets.ts`: 5 for a quick
    take or script, 10 for a full study, 15 for a memo), enforced across continuations. The
    methodology system prompt and the job prompt are prompt-cached. Quick takes, scripts and
    watchlist refreshes run at `medium` effort; set `ENGINE_SHORT_FORMAT_EFFORT=high` to undo that.
  - **Spend tracking**: every model call's token usage and web searches are added to
    `jobs.usage_json`, with an estimated `jobs.cost_usd` at list price (`lib/engine/usage.ts`),
    after every attempt, failed ones included. The admin overview totals it and shows the average
    cost per finished report by format; the Jobs page shows it per job. A call that times out
    before responding reports no usage, so the figures can undercount; the Anthropic Console is
    the bill.
  - Account-level failures (missing or revoked key, an empty Anthropic credit balance, unknown
    model, rate limit, overload) put the job back in the queue without using an attempt and stop
    the invocation, so a drained account leaves reports `queued` instead of failing them all.
    `jobs.result` reads "waiting for the engine: …". Other bad-request errors fail the job
    immediately; timeouts and 5xx errors retry, up to 3 attempts.
  - The structured-field extraction runs without thinking and is validated. If it fails for a
    study, the "As of" date is read from the study itself rather than repeating the research.
- **Failures**: customers see "We couldn't build this report. Your credits have been refunded."
  The raw error goes to `jobs.result` for the operator.
- **Market data** ([`lib/marketdata.ts`](lib/marketdata.ts)) is real Yahoo Finance OHLC data and
  screener results. It's never fabricated; if the data isn't available, the job fails.

**Only `one_candle` and `davinci_model` are automated by default.** Those variants work purely
from fetched candles. The general research variants rely on Anthropic's hosted `web_search`
tool, whose output hasn't yet been validated against the manually researched bar. Until
`ENGINE_WEB_RESEARCH=1` is set, those jobs stay `pending` for the manual path.

### Manual fallback (engine CLI)

On any machine with `DATABASE_URL` in `.env.local`, jobs the worker doesn't take can be built by
hand through the engine CLI, following [`lib/engine/methodology.md`](lib/engine/methodology.md):

```bash
npm run engine -- pending                                  # pending job ids + labels
npm run engine -- claim <jobId>                            # mark running, print the job's context
npm run engine -- complete <jobId> --content s.md --meta m.json
npm run engine -- fail <jobId> --message "why"             # also refunds the job's credits
npm run engine -- watchlist                                # tracked tickers for a refresh sweep
npm run engine -- queue-refresh <watchlistId>              # free sweep-initiated refresh
npm run engine -- queue-earnings <caseStudyId>             # free sweep-initiated earnings update
```

Manual claims leave `locked_at` NULL, so the automated worker never takes them over. In the
other direction, the CLI refuses to claim a job the worker is holding.

---

## Billing

| Stage | How it works |
|---|---|
| **Trial** | Every signup gets 30 days plus 5 starter credits. The Postgres trigger `stocks.handle_new_user()` grants them server-side; nothing is read from client metadata. |
| **Access** | `hasAccess = access_granted OR trial_ends_at > now()`. After the trial, a one-time Stripe payment sets `access_granted`. |
| **Credits** | Charged **at queue time** in the same transaction as the job INSERT. If the balance is short the charge raises (SQLSTATE `SS402`) and the job never exists; the API returns 402. |
| **Refunds** | Failed jobs (worker or CLI `fail`) are refunded automatically and idempotently. Jobs can be removed from the queue, and refunded, only while still `pending`. Once running, a job can't be cancelled. |
| **Limits** | Per workspace, at most 10 reports in progress and 30 queued per hour (`lib/limits.ts`). |
| **Sweep jobs** | Refreshes and earnings updates queued by the watchlist sweep (`queue-refresh` / `queue-earnings`) are free, because the customer didn't ask for them. |
| **Purchases** | `/billing` opens a hosted Stripe Checkout, either the access fee or a credit pack. |

**The Stripe webhook is the only thing that grants access or purchased credits.** It connects as
its own database account, `stocks_billing` (`BILLING_DATABASE_URL`). That is the only account
allowed to execute the two grant functions; the app's own account can't.

- `POST /api/billing/webhook` verifies the Stripe signature and handles three events:
  - `checkout.session.completed` and `checkout.session.async_payment_succeeded` call
    `fulfill_checkout()`, which is keyed on the Checkout Session id, so a replayed event grants
    nothing.
  - `charge.refunded` (full refunds only) calls `refund_payment()`, which reverses exactly what
    that payment granted.
- The number of credits in a pack is stamped into the session metadata by our own server, never
  taken from the client.

**Testing locally with the Stripe CLI:**

```bash
stripe listen --forward-to localhost:3200/api/billing/webhook   # prints the whsec_… secret
stripe trigger checkout.session.completed                        # no Stock Studio metadata → acknowledged, ignored
```

For a real end-to-end test, sign in, open `/billing`, pay with card `4242 4242 4242 4242`, and
watch the balance update.

---

## Accounts & sign-in

- **Sign up** asks for first name, last name, email and a password (at least 8 characters,
  including a letter and a number). The names go into Supabase Auth user metadata and are used only
  for display; nothing security-relevant is read from them. Supabase sends a confirmation email,
  which can be re-sent from the "check your email" screen.
- **Log in** with email and password, or **Continue with Google**.
- **Remember me** is on by default, which keeps you signed in on that device. Unchecked, the
  login is kept only for the browser session: the `ss_remember=0` flag makes every auth cookie a
  session cookie (`lib/auth-cookies.ts`).
- **Forgot password**: `/forgot-password` sends a reset link. It shows the same response whether
  or not the account exists, so it can't be used to find registered emails. The link goes through
  `/auth/callback` to `/reset-password`, where the new password is set.
- The shared UI is in `components/auth/`: `AuthShell`, `PasswordInput` (show/hide toggle),
  `GoogleButton` and `OrDivider`.

## Multi-tenancy & security

- **Workspace scoping in app code**: every tenant table (`case_studies`, `jobs`, `watchlist`,
  `credits_ledger`, `payments`) carries `workspace_id`.
  - Every query filters on `currentWorkspaceId()` from [`lib/workspace.ts`](lib/workspace.ts).
  - That lookup is cached per request. Don't write the lookup inline anywhere else.
- **Row-level security**: RLS is on as defense-in-depth, using `is_workspace_member()`. The app
  itself connects as `stocks_app`, which bypasses RLS and filters explicitly. The anon and
  authenticated API roles have no grants on the `stocks` schema.
- **Billing state can't be written directly by the app**: `stocks_app` has no
  INSERT/UPDATE/DELETE on `credits_ledger` or `payments`, and no UPDATE on
  `profiles.access_granted` or `profiles.trial_ends_at`. All writes go through SECURITY DEFINER
  functions.
- **Function permissions**: every SECURITY DEFINER function revokes EXECUTE from PUBLIC, anon
  and authenticated **in the same migration that creates it**. New functions get PUBLIC EXECUTE
  by default in Postgres, so this step is easy to miss.
- **Proxy** ([`proxy.ts`](proxy.ts), Next 16's name for middleware) protects an explicit list of paths:
  - Session required: `/dashboard`, `/new`, `/watchlist`, `/study`, `/billing`, and the
    `case-studies`, `jobs`, `watchlist` and `billing/checkout` APIs.
  - Public: marketing pages, `/login`, `/signup` and `/auth/callback`.
  - Authenticated by other means: `/api/engine/run` (shared secret) and `/api/billing/webhook`
    (Stripe signature).
- **Checking user-supplied ids**: an id the user sends that points at another row (`parent_id`,
  `case_study_id`) is checked against the caller's workspace before it's used.
- **Untrusted content**: study markdown is AI output built from web pages and user notes.
  - It is always rendered through `renderMarkdown()` ([`lib/markdown.ts`](lib/markdown.ts)), a
    sanitize-html allowlist that removes raw HTML, scripts and non-http(s) links.
  - Source links go through `safeHttpUrl()`.
  - User notes reach prompts only as delimited data blocks.
  - The manual engine works one claimed job at a time; `pending` lists no customer text.
- **Input validation**: [`lib/validate.ts`](lib/validate.ts) enforces the ticker format, known
  variants, and length caps (notes up to 8,000 characters, company up to 200).
- **Headers**: [`next.config.mjs`](next.config.mjs) sets a CSP that allows scripts only from the
  app and network calls only to the app and Supabase, plus `frame-ancestors 'none'`,
  `X-Frame-Options`, `nosniff` and `Referrer-Policy`.

---

## Database

Supabase project `nxwehsafitrcoenbrkyv`, schema `stocks`. The project is used only by Stock Studio;
the `public` schema is intentionally empty.

| Table | Purpose |
|---|---|
| `workspaces`, `workspace_members` | Tenants and membership (owner role on signup) |
| `profiles` | 1:1 with `auth.users`: `active_workspace_id`, `trial_ends_at`, `access_granted` |
| `case_studies` | The output. `status`: queued → building → ready/error. `parent_id` links earnings updates to the original study. `sources_json` is JSONB. `corrections_md` holds corrections to the user's notes. |
| `jobs` | The queue. `type`, `payload` (JSONB), `status` (pending → running → done/error), `locked_at`, `attempts` |
| `watchlist` | Tracked tickers: thesis, snapshot, `triggers_json`, `status_tag`. Unique per `(workspace_id, ticker)`. |
| `credits_ledger` | Append-only; balance = `SUM(delta)`. Unique `(reason, ref)` makes charges, refunds and purchases idempotent. |
| `payments` | Stripe audit trail. Unique `stripe_session_id`. |
| `settings` | App settings |

**Migrations** are applied with the Supabase MCP `apply_migration`. The history so far:

- `stock_studio_schema` — the original schema.
- `stocks_multi_tenant_foundation` — workspaces, profiles, RLS.
- `stocks_automated_worker` — `claim_job`, the trigger, the cron job.
- `stocks_worker_hardening` — the claim fixes described above.
- `stocks_billing` — the billing tables and functions.
- `stocks_worker_billing_fixes` — refunds for jobs the worker gives up on, the one-open-job
  indexes, and the `stocks_billing` role.

The last three are also in [`supabase/migrations/`](supabase/migrations/) for review. Apply new
migrations the same way and add their SQL to that folder.

---

## CLI scripts

All scripts read `DATABASE_URL` from `.env.local`.

```bash
# Engine queue contract — the only way to mutate the queue by hand
npm run engine -- pending                                    # pending/running job ids + labels (no customer text)
npm run engine -- claim <jobId>                              # mark running; prints that one job's context
npm run engine -- complete <jobId> --content s.md --meta m.json
npm run engine -- fail <jobId> --message "why"              # also refunds the job's credits
npm run engine -- watchlist                                  # tracked tickers across workspaces (for the sweep)
npm run engine -- queue-refresh <watchlistId>                # free, sweep-initiated watchlist refresh
npm run engine -- queue-earnings <caseStudyId>               # free, sweep-initiated earnings update

# Market data (Yahoo Finance, no key)
npm run candles -- <TICKER> [--date YYYY-MM-DD]              # 1m OHLC + first 5-min candle (~30d history)
npm run history -- <TICKER> [--interval 1m|5m|15m|30m|60m|1d|1wk] [--range 1d|5d|1mo|3mo|6mo|1y|2y|5y]
npm run movers -- --count 5                                  # day gainers/losers screeners
npm run signal-bot                                           # Discord signal bot (see deploy/signal-bot)
```

`complete` metadata depends on the job type:

- **Case study jobs**: `--content` is required. `--meta` may set `company`, `as_of_date`,
  `sources` (`[{title,url}]`) and `corrections_md`.
- **Watchlist jobs**: `--meta` is required with `thesis`, `snapshot`, `triggers` and
  `as_of_date`.

Passing markdown and JSON through files avoids SQL escaping; never hand-write SQL to change the
queue.

---

## Project structure

```
app/
  (marketing)/          public site: landing, pricing, terms, privacy
  (app)/                authenticated app: dashboard, new, watchlist, study/[id], billing
  api/
    case-studies/       queue a study (access gate + credit charge); delete a study
    watchlist/          add / retag / requeue / remove tracked tickers
    jobs/               remove a job from the queue (refunds credits)
    billing/checkout/   start a hosted Stripe Checkout
    billing/webhook/    Stripe webhook — the only grant path
    engine/run/         automated worker entry point (shared secret)
  auth/callback/        Supabase PKCE code exchange
  login/ signup/
components/             Nav, QueuePanel, StudyActions, WatchlistClient, BillingActions, AutoRefresh
lib/
  db.ts                 lazy postgres client (stocks_app, transaction pooler, prepare: false)
  workspace.ts          currentUser(), currentWorkspaceId()
  access.ts             requireAppAccess() gate for paid routes
  billing.ts            billing state, charge/refund helpers
  stripe.ts             Stripe client + price lookup
  shared.ts             client-safe types, VARIANTS, CREDIT_COSTS
  marketdata.ts         Yahoo Finance candles/history/movers
  engine/               worker loop, Anthropic client, prompts, methodology.md
  supabase/             browser + server Supabase clients
scripts/                engine / candles / history / movers CLIs, signal bot
deploy/signal-bot/      systemd unit, env template and deploy steps for the signal bot
supabase/migrations/    SQL for recent migrations
```

---

## Deployment

1. **Host**: deploy the repo and set the env vars above.
   - **Vercel**: `next.config.mjs` adds `lib/engine/methodology.md` to the `/api/engine/run` bundle, since the
     worker reads it at runtime.
   - **Render** (or any host that assigns a port): build `npm install && npm run build`, start
     `npm run start`. The start script listens on `0.0.0.0:$PORT` (3200 when `PORT` is unset), so
     Render's port scan finds it. A hard-coded port fails the deploy with "failed to detect open
     port".
2. **Point the worker at the deploy**: in Supabase Vault, set `engine_webhook_url` to
   `https://<host>/api/engine/run`, and make `engine_webhook_secret` equal
   `ENGINE_WEBHOOK_SECRET`. Until then the trigger and cron POST to a placeholder and nothing is
   automated.
3. **Stripe**:
   - Create two one-time prices (access fee and credit pack) and set their ids.
   - Add a webhook endpoint at `https://<host>/api/billing/webhook` for
     `checkout.session.completed`, `checkout.session.async_payment_succeeded` and
     `charge.refunded`.
   - Set `STRIPE_WEBHOOK_SECRET`.
4. **Supabase Auth** (dashboard → Authentication):
   - **URL Configuration:** set the Site URL to your deploy URL, and add
     `https://<host>/auth/callback` (plus `http://localhost:3200/auth/callback` for dev) to the
     redirect allowlist. Email confirmation, password reset and Google all return through it.
   - **Google sign-in:** enable the Google provider with a Google Cloud OAuth client. Its
     authorized redirect URI is `https://nxwehsafitrcoenbrkyv.supabase.co/auth/v1/callback`.
     Until it's enabled, the Google button shows "Google sign-in isn't set up yet".
   - **Emails:** the confirm-signup and reset-password templates work as is. Set up custom SMTP
     before launch, because Supabase's built-in sender is heavily rate-limited.
5. **Smoke test**:
   - Sign up and confirm the trial credits appear.
   - Queue a `one_candle` study and confirm it builds with no manual engine running.
   - Run a test-mode checkout, then replay the webhook and confirm nothing is granted twice.

---

## Content rules

These rules are non-negotiable and apply to every study variant and both engine modes (trade signals
have their own rules, below):

1. Educational analysis, never personalized investment advice. Every study ends with the
   "Not investment advice" line.
2. Every output opens with a visible **"As of [Month Day, Year]"** line.
3. Never invent metrics, quarters, estimates or multiples. Verify against IR releases and SEC
   filings; when credible sources disagree, show both figures with their sources.
4. Only call something "acceleration" if it is mathematically true quarter over quarter;
   otherwise reword it.
5. Material corrections to the user's notes go in `corrections_md`, which the UI surfaces; they
   are never buried in the copy.
6. Never leave a job stuck in `running`. Complete it or fail it with a message.

Trade signals:

1. Directional calls with entries, targets and stops are allowed, from approved posters only
   (`SIGNAL_POSTER_IDS`), and are delivered to members through Discord (SMS allowed, not built).
2. Every signal goes into the append-only, hash-chained track record before it is posted. Never edit,
   delete or backdate a signal; corrections are new CLOSE or ALERT signals.
3. Signals are the trader's general calls to all members, never presented as personalized advice, and
   every surface that shows them carries the risk line.
4. Only call the record "verified" while `verify_signal_chain()` reports it intact.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Jobs sit in `pending` forever | Either `engine_webhook_url` in Vault is still the placeholder, or the job is a web-research variant and `ENGINE_WEB_RESEARCH` is off (build it through the engine CLI). |
| Study shows "We couldn't build this report" | The job failed and its credits were refunded. The real reason is in `jobs.result`: for example a refusal, output over the length limit, repeated timeouts, or invocations killed 3 times. For kills, check the host's function logs and keep `ENGINE_INVOCATION_BUDGET_MS` below the route's `maxDuration`. |
| Browser console shows a CSP violation | The page is calling an origin not in `connect-src` in `next.config.mjs`; add it there. |
| API returns 429 | The workspace hit a queue limit (`lib/limits.ts`): 10 reports in progress, or 30 queued in the last hour. The response says which one, with `Retry-After`. |
| API returns 402 | The trial has ended without an unlock (`code: no_access`) or the balance is too low (`code: no_credits`). Both are handled on `/billing`. |
| Webhook returns 500 `BILLING_DATABASE_URL is not set` (or a login failure) | The webhook's database account isn't configured. Set a password on `stocks_billing` and `BILLING_DATABASE_URL`. Stripe keeps retrying, so nothing is lost. |
| Paid, but no access or credits | The webhook isn't reaching the app. Check the Stripe dashboard's delivery log, `STRIPE_WEBHOOK_SECRET`, and that the event carries Stock Studio metadata. |
| Production returns 503 "Locked" | `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` aren't set. |
| `DATABASE_URL is not set` from a CLI | `.env.local` is missing from the repo root. |
| `npm run candles` returns no data | The market isn't open yet, or the date is beyond Yahoo's ~30-day 1-minute history. |

