# Stock Studio

Stock case-study studio, hosted so it's reachable from anywhere. The Next.js app (local dev on
port 3200, deployed on Vercel) is the visual cockpit; the database is hosted Postgres (Supabase,
isolated `stocks` schema — same shared project as Facebook Ads Studio's `fbads` schema, different
app, different role). **Claude Code is the research engine** — running on any machine with
`DATABASE_URL` in `.env.local`, it drains the `jobs` queue using live web research
(WebSearch/WebFetch) and the Stock Case Study Builder methodology
(`anthropic-skills:stock-case-study-builder` — invoke it when available; `/build-studies` embeds
the load-bearing rules as a fallback).

## The two skills

| Skill | Trigger | What it does |
|---|---|---|
| `/build-studies` | after queuing a study/watchlist entry in the app | drains pending `build_case_study`, `earnings_update`, and `watchlist_entry` jobs — researches the ticker, writes the fact-checked markdown study back into the DB |
| `/refresh-watchlist` | on a schedule or on demand | sweeps tracked tickers for earnings/material news since their as-of date, requeues stale entries, queues earnings-reaction updates, then drains them |

## Database

Hosted Postgres — a Supabase project (`nxwehsafitrcoenbrkyv`, same project as Facebook Ads
Studio) with an isolated schema **`stocks`** (created by migration `stock_studio_schema`). One
shared DB means the web app (local or Vercel) and the Claude Code engine on any machine see the
same state.

- **From skills / Claude Code**: prefer the engine CLI below; for read-only inspection or the
  watchlist sweep, the Supabase MCP tool `execute_sql` also works — always qualify tables as
  `stocks.<table>` when using it directly.
- **From the app / scripts**: `lib/db.ts` connects via `DATABASE_URL` (dedicated `stocks_app` role
  with search_path=stocks, Supabase transaction pooler → `prepare: false`). Local dev needs
  `.env.local` (see `.env.example`).

Tables: `case_studies` (the output; `parent_id` links earnings updates to the original study;
`sources_json`/`corrections_md` are JSONB/text), `jobs` (the queue: pending → running →
done/error; `payload` is JSONB), `watchlist` (`triggers_json` is JSONB), `settings`. The `stocks`
schema is revoked from the anon/authenticated API roles — only `stocks_app` and admin roles can
touch it.

**Engine contract — always use the CLI, never hand-write SQL for queue mutations:**

```bash
npm run engine -- pending                                   # list pending jobs + context (JSON)
npm run engine -- claim <jobId>                             # mark running (UI shows "building")
npm run engine -- complete <jobId> --content s.md --meta m.json
npm run engine -- fail <jobId> --message "why"
```

Markdown goes through `--content` files (scratchpad), metadata through `--meta` JSON — this avoids
SQL-escaping entirely. The CLI reads `DATABASE_URL` from `.env.local` automatically.

## One-candle setup checks

The `one_candle` study variant runs the **one-candle trading methodology**
(`anthropic-skills:one-candle-trading` — invoke it when available; `/build-studies` embeds the
rules): first 5-minute candle high/low as the day's only key levels → displacement break with a
wick-to-wick fair value gap → FVG retest → engulfing confirmation → stop at the FVG's first
candle, fixed 3:1 target. Real intraday data comes from:

```bash
npm run candles -- <TICKER> [--date YYYY-MM-DD]   # 1m OHLC + first 5-min candle (Yahoo, ~30d history)
```

Never fabricate candles — if data is unavailable, fail the job. This variant is strictly
educational framework analysis: no live trade directives, no brokerage connections, no
profitability promises; its footer is "Educational framework analysis — not a trade
recommendation."

## Market movers digest

The `movers_digest` variant (ticker `MARKET`, job type `movers_digest`) is a morning digest of
the day's top 5 gainers and top 5 losers with a 1–3 sentence verified story on each mover:

```bash
npm run movers -- --count 5    # Yahoo day-gainers/day-losers screeners (no API key)
```

Queued from the dashboard button or by the weekday-morning scheduled task. Never invent a
catalyst — "no clear catalyst reported" is a valid story.

## Queue hygiene

Jobs can be removed from the queue in the dashboard (X button) — that deletes the job and its
unbuilt placeholder study. Ready studies are never deleted this way. The engine must still
`complete` or `fail` every job it claims; a job that disappears mid-run was deleted by the user,
so just move on.

## Content rules (non-negotiable)

1. Educational business analysis, **never personalized investment advice** — every study ends with
   the "Not investment advice" line.
2. Every output opens with a visible **"As of [Month Day, Year]"** line — all variants.
3. Never invent metrics, quarters, estimates, or multiples. Verify against IR releases / SEC
   filings first; when credible sources disagree, show both figures with sources.
4. "Acceleration" must be mathematically true quarter-over-quarter or reworded.
5. Material corrections to user-provided notes go in `corrections_md` — surfaced by the UI, never
   buried in the copy.
6. Never leave a job stuck in `running` — complete it or fail it with a message.

## Dev & hosting

```bash
npm run dev        # app on http://localhost:3200 (needs DATABASE_URL in .env.local)
```

Hosted on Vercel (project `stock-studio`). The deployment is gated by a shared password
(`ADMIN_PASSWORD` env; middleware sets a `stocks_key` cookie) — set it in the Vercel dashboard and
redeploy to lock it down; unset, the app is open (fine for local dev, not for production). No
other external services or API keys — all research happens through Claude Code's own web tools
(WebSearch/WebFetch) plus the unauthenticated Yahoo Finance endpoints used by `npm run candles`
and `npm run movers`.
