-- Live market data on finished studies and watchlist rows. A refresh stores a
-- read-only quote snapshot (price, day move, 52-week range, move since the
-- as-of date) beside the row. The fact-checked study text is never rewritten.
ALTER TABLE stocks.case_studies
  ADD COLUMN IF NOT EXISTS live_json JSONB,
  ADD COLUMN IF NOT EXISTS live_refreshed_at TIMESTAMPTZ;
ALTER TABLE stocks.watchlist
  ADD COLUMN IF NOT EXISTS live_json JSONB,
  ADD COLUMN IF NOT EXISTS live_refreshed_at TIMESTAMPTZ;
