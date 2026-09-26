-- Study grades, interpreting sentences, and thesis tracking (features adapted
-- from QuantEdgeResearch, kept inside Stock Studio's educational framing).
-- Purely additive: code deployed before this migration ignores the new columns.

-- A research-quality grade per study: per-card scores the engine records from
-- the study it just wrote, plus the overall letter computed from them in code
-- (lib/grades.ts). Not a buy/sell rating. Shape:
--   { "overall": "B+", "score": 78, "components": [{ "key", "label", "score", "note" }] }
ALTER TABLE stocks.case_studies
  ADD COLUMN IF NOT EXISTS grade_json JSONB,
  -- One plain-English "what this study says" line for dashboard cards.
  ADD COLUMN IF NOT EXISTS summary_line TEXT;

-- Whether the thesis still holds, as of the entry's last engine refresh.
ALTER TABLE stocks.watchlist
  ADD COLUMN IF NOT EXISTS thesis_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (thesis_status IN ('intact', 'weakening', 'broken', 'unknown')),
  ADD COLUMN IF NOT EXISTS thesis_status_note TEXT;

-- Every thesis the engine has written for a row — the thesis timeline. Filled
-- by the trigger below, so the worker and the manual CLI can't diverge.
CREATE TABLE IF NOT EXISTS stocks.watchlist_history (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES stocks.workspaces(id) ON DELETE CASCADE,
  watchlist_id BIGINT NOT NULL REFERENCES stocks.watchlist(id) ON DELETE CASCADE,
  as_of_date TEXT,
  thesis TEXT NOT NULL,
  snapshot TEXT,
  thesis_status TEXT NOT NULL,
  thesis_status_note TEXT,
  status_tag TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS watchlist_history_row_idx ON stocks.watchlist_history (watchlist_id, id DESC);

ALTER TABLE stocks.watchlist_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members read" ON stocks.watchlist_history FOR SELECT
  USING (stocks.is_workspace_member(workspace_id));

GRANT SELECT, INSERT ON stocks.watchlist_history TO stocks_app;
GRANT USAGE ON SEQUENCE stocks.watchlist_history_id_seq TO stocks_app;

-- SECURITY INVOKER: runs as whoever updated the watchlist row (stocks_app).
CREATE OR REPLACE FUNCTION stocks.record_watchlist_history() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = stocks AS $$
BEGIN
  INSERT INTO stocks.watchlist_history
    (workspace_id, watchlist_id, as_of_date, thesis, snapshot, thesis_status, thesis_status_note, status_tag)
  VALUES
    (NEW.workspace_id, NEW.id, NEW.as_of_date, NEW.thesis, NEW.snapshot, NEW.thesis_status, NEW.thesis_status_note, NEW.status_tag);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION stocks.record_watchlist_history() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS watchlist_history_on_update ON stocks.watchlist;
CREATE TRIGGER watchlist_history_on_update
  AFTER UPDATE OF thesis, thesis_status, as_of_date ON stocks.watchlist
  FOR EACH ROW
  WHEN (NEW.thesis IS NOT NULL AND (
    NEW.thesis IS DISTINCT FROM OLD.thesis
    OR NEW.thesis_status IS DISTINCT FROM OLD.thesis_status
    OR NEW.as_of_date IS DISTINCT FROM OLD.as_of_date))
  EXECUTE FUNCTION stocks.record_watchlist_history();

-- Seed the timeline with each row's current thesis.
INSERT INTO stocks.watchlist_history
  (workspace_id, watchlist_id, as_of_date, thesis, snapshot, thesis_status, thesis_status_note, status_tag, created_at)
SELECT w.workspace_id, w.id, w.as_of_date, w.thesis, w.snapshot, w.thesis_status, w.thesis_status_note, w.status_tag, w.updated_at
FROM stocks.watchlist w
WHERE w.thesis IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM stocks.watchlist_history h WHERE h.watchlist_id = w.id);
