---
name: refresh-watchlist
description: Scheduled sweep of the Stock Studio watchlist — check each tracked ticker for earnings or material news since its as-of date, refresh stale entries, and queue earnings-reaction updates for tickers that just reported.
---

# Refresh the watchlist

Designed to run on a schedule (or on demand). Sweeps every tracked ticker for staleness and material events.

## Steps

1. **Read the watchlist** (hosted Postgres, project `nxwehsafitrcoenbrkyv`, `stocks` schema — read-only queries are fine for listing, via the Supabase MCP tool `execute_sql` or `psql "$DATABASE_URL"`):
   ```sql
   SELECT id, ticker, company, status_tag, as_of_date, case_study_id FROM stocks.watchlist
   ```
2. For each ticker, use WebSearch to check what has happened since its `as_of_date`:
   - **Reported earnings since then?** → if the ticker has a linked `case_study_id`, queue an earnings update: POST to the app if running (`curl -s -X POST localhost:3200/api/case-studies -H 'Content-Type: application/json' -d '{"ticker":"XYZ","variant":"earnings_update","parent_id":<id>}'`), or insert directly via `execute_sql` mirroring `app/api/case-studies/route.ts` (schema-qualify as `stocks.case_studies` / `stocks.jobs`) if the app isn't running.
   - **Entry older than ~30 days or a material event** (guidance change, major product/regulatory news, >15% price move)? → requeue the entry: insert a `watchlist_entry` job with payload `{"watchlist_id": <id>}` (skip if one is already pending).
   - Nothing material → leave it alone.
3. **Drain what you queued** by following the `/build-studies` skill for the new jobs.
4. Report: tickers checked, what was refreshed, what reported earnings, anything that looks thesis-breaking (call those out loudly — that's the point of the watchlist).

Do not change a row's `status_tag` silently; recommend changes in the report and let the user flip them in the UI (or confirm in chat first).
