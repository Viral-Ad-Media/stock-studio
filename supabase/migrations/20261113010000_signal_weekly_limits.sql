-- Signals per tier: Diamond (and Founding) see every call live. Gold sees the
-- first 5 BUY calls of each week live and Silver the first 3 (New York time),
-- and both see every follow-up (SELL/EXIT/CLOSE/ALERT) on a ticker whose
-- latest BUY was one of their picks. Every other call reaches them in the
-- track record after the delay in lib/plans.ts.
--
-- stocks.signal_live_tiers() stays the one definition of the rule: the web
-- feed, push delivery and the bot's Gold/Silver Discord channels read it.
-- The limits here must match SIGNALS_PER_WEEK in lib/plans.ts.
CREATE OR REPLACE FUNCTION stocks.signal_live_tiers()
RETURNS TABLE (id BIGINT, gold BOOLEAN, silver BOOLEAN)
LANGUAGE sql
STABLE
SET search_path = stocks, public
AS $$
  WITH buys AS (
    SELECT s.id,
      row_number() OVER (PARTITION BY date_trunc('week', s.posted_at AT TIME ZONE 'America/New_York') ORDER BY s.id) AS week_n
    FROM stocks.signals s WHERE s.action = 'BUY'
  ), opened AS (
    -- The latest BUY on the same ticker at or before each signal: a BUY is
    -- its own opener, a follow-up inherits its opener's pick status.
    SELECT s.id, max(s.id) FILTER (WHERE s.action = 'BUY') OVER (PARTITION BY s.ticker ORDER BY s.id) AS opener
    FROM stocks.signals s
  )
  SELECT o.id, coalesce(b.week_n <= 5, false), coalesce(b.week_n <= 3, false)
  FROM opened o LEFT JOIN buys b ON b.id = o.opener
$$;
REVOKE ALL ON FUNCTION stocks.signal_live_tiers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stocks.signal_live_tiers() TO stocks_app, stocks_signals, service_role;
