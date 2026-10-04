-- Setup bots (lib/setups.ts): one market-wide scan per completed session, its
-- pattern matches, and each match's paper-tracked outcome. Market data shown
-- identically to every user, so these two tables deliberately have no
-- workspace_id; only stocks_app (and admin roles) can touch them.

CREATE TABLE IF NOT EXISTS stocks.setup_scans (
  id BIGSERIAL PRIMARY KEY,
  session_date TEXT NOT NULL UNIQUE CHECK (session_date ~ '^\d{4}-\d{2}-\d{2}$'),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'error')),
  universe_size INT,
  -- { "<bot key>": "descriptive AI desk note" }; absent when no model call was made.
  notes_json JSONB,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stocks.setup_matches (
  id BIGSERIAL PRIMARY KEY,
  scan_id BIGINT NOT NULL REFERENCES stocks.setup_scans(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL,
  bot TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
  close NUMERIC NOT NULL,
  adj_close NUMERIC NOT NULL,
  spy_adj_close NUMERIC,
  levels_json JSONB NOT NULL,
  invalidation_json JSONB,
  detail TEXT NOT NULL,
  horizon_sessions INT NOT NULL CHECK (horizon_sessions > 0),
  -- Paper tracking, filled once horizon_sessions have passed.
  resolved_at TIMESTAMPTZ,
  exit_date TEXT,
  fwd_return NUMERIC,
  spy_return NUMERIC,
  invalidated BOOLEAN,
  UNIQUE (session_date, bot, symbol)
);
CREATE INDEX IF NOT EXISTS setup_matches_open_idx ON stocks.setup_matches (session_date) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS setup_matches_bot_idx ON stocks.setup_matches (bot, session_date DESC);

-- Defense in depth: RLS on with no policies — the API roles see nothing.
ALTER TABLE stocks.setup_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocks.setup_matches ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON stocks.setup_scans, stocks.setup_matches TO stocks_app;
GRANT DELETE ON stocks.setup_matches TO stocks_app; -- a re-run replaces its own session's matches
GRANT USAGE ON SEQUENCE stocks.setup_scans_id_seq, stocks.setup_matches_id_seq TO stocks_app;
