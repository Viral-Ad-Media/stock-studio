// Parameterized read-only queries. Private rows always take the workspace
// resolved from the server session; never a workspace supplied by the browser.
export const TODAY_RESEARCH_SQL = `
  SELECT id, ticker, variant, as_of_date, updated_at, summary_line, grade_json
  FROM case_studies WHERE workspace_id = $1 AND status = 'ready'
  ORDER BY updated_at DESC, id DESC LIMIT 6`;

export const TODAY_THESIS_SQL = `
  SELECT id, ticker, thesis_status, thesis_status_note, as_of_date, updated_at
  FROM watchlist WHERE workspace_id = $1 AND thesis_status IN ('weakening', 'broken')
  ORDER BY CASE WHEN thesis_status = 'broken' THEN 0 ELSE 1 END, updated_at DESC, id DESC LIMIT 6`;

// A DISTINCT ON subquery avoids limiting the earnings universe to the six
// research cards. Comparisons and MARKET digests are not earnings tickers.
export const TODAY_EARNINGS_SQL = `
  SELECT ticker, max(study_id) AS study_id FROM (
    SELECT ticker, NULL::bigint AS study_id FROM watchlist WHERE workspace_id = $1
    UNION ALL
    SELECT ticker, id AS study_id FROM (
      SELECT DISTINCT ON (ticker) ticker, id FROM case_studies
      WHERE workspace_id = $1 AND status = 'ready' AND variant != 'movers_digest'
        AND ticker ~ '^[A-Z][A-Z0-9.\\-]{0,9}$'
      ORDER BY ticker, updated_at DESC, id DESC
    ) newest
  ) followed WHERE ticker ~ '^[A-Z][A-Z0-9.\\-]{0,9}$'
  GROUP BY ticker ORDER BY ticker`;

export const TODAY_SETUP_SQL = `
  SELECT s.session_date, s.universe_size,
    (SELECT count(*)::int FROM setup_matches m WHERE m.scan_id = s.id) AS matches
  FROM setup_scans s WHERE s.status = 'done' ORDER BY s.session_date DESC LIMIT 1`;

export function canReadSignals(accessGranted: boolean, admin: boolean): boolean {
  return accessGranted || admin;
}
