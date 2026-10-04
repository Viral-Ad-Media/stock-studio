-- Trade signals: the program trader's BUY/SELL/EXIT/CLOSE/ALERT calls, posted
-- from a private Discord channel by the signal bot (scripts/signal-bot.ts),
-- reposted to members, and kept here as the track record.
--
-- The track record is append-only and tamper-evident:
--   * UPDATE, DELETE and TRUNCATE are rejected by triggers, for every role.
--   * posted_at is stamped by the database, so a signal can't be backdated.
--   * Each row stores sha256(previous row's hash + its own fields), so editing
--     or removing any row after the fact breaks the chain from that row on.
--     stocks.verify_signal_chain() re-computes it.
-- Deliveries (the Discord message a signal became) are a separate insert-only
-- table, so recording a delivery never needs an UPDATE of the signal.
--
-- Program-wide data, not tenant data: like setup_scans, no workspace_id. The
-- app shows it to paying members (profiles.access_granted) and admins.

CREATE TABLE IF NOT EXISTS stocks.signals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL', 'EXIT', 'CLOSE', 'ALERT')),
  ticker TEXT NOT NULL CHECK (ticker ~ '^[A-Z][A-Z0-9]{0,5}([.-][A-Z0-9]{1,4})?$'),
  instrument TEXT CHECK (instrument IN ('CALL', 'PUT')),
  entry NUMERIC(14, 4) CHECK (entry > 0),
  target NUMERIC(14, 4) CHECK (target > 0),
  stop NUMERIC(14, 4) CHECK (stop > 0),
  detail TEXT NOT NULL DEFAULT '' CHECK (length(detail) <= 1000),
  author_discord_id TEXT NOT NULL CHECK (author_discord_id ~ '^[0-9]{5,25}$'),
  author_name TEXT CHECK (length(author_name) <= 100),
  source_message_id TEXT NOT NULL UNIQUE CHECK (source_message_id ~ '^[0-9]{5,25}$'),
  prev_hash TEXT,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS signals_posted_idx ON stocks.signals (posted_at DESC);

CREATE TABLE IF NOT EXISTS stocks.signal_deliveries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  signal_id BIGINT NOT NULL REFERENCES stocks.signals(id),
  channel TEXT NOT NULL CHECK (channel IN ('discord', 'sms')),
  destination TEXT NOT NULL,
  external_id TEXT,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signal_deliveries_signal_idx ON stocks.signal_deliveries (signal_id);

-- One canonical text form per row; the hash covers exactly this.
CREATE OR REPLACE FUNCTION stocks.signal_canonical(s stocks.signals)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = stocks, public
AS $$
  SELECT concat_ws('|',
    coalesce(s.prev_hash, 'GENESIS'),
    s.id::text,
    to_char(s.posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    s.action, s.ticker, coalesce(s.instrument, ''),
    coalesce(s.entry::text, ''), coalesce(s.target::text, ''), coalesce(s.stop::text, ''),
    s.detail, s.author_discord_id, s.source_message_id)
$$;

-- Stamps time and chains the hash. SECURITY DEFINER so the bot role can read
-- the previous hash without SELECT on the whole table mattering.
CREATE OR REPLACE FUNCTION stocks.signals_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = stocks, public
AS $$
BEGIN
  -- Serialize inserts so two signals can't chain off the same parent.
  PERFORM pg_advisory_xact_lock(hashtext('stocks.signals.chain'));
  NEW.posted_at := now();
  SELECT hash INTO NEW.prev_hash FROM stocks.signals ORDER BY id DESC LIMIT 1;
  NEW.hash := encode(sha256(convert_to(stocks.signal_canonical(NEW), 'UTF8')), 'hex');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION stocks.signals_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = stocks, public
AS $$
BEGIN
  RAISE EXCEPTION 'the signal track record is append-only (% refused on %)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'SS403';
END;
$$;

DROP TRIGGER IF EXISTS signals_chain ON stocks.signals;
CREATE TRIGGER signals_chain BEFORE INSERT ON stocks.signals
  FOR EACH ROW EXECUTE FUNCTION stocks.signals_before_insert();
DROP TRIGGER IF EXISTS signals_no_change ON stocks.signals;
CREATE TRIGGER signals_no_change BEFORE UPDATE OR DELETE ON stocks.signals
  FOR EACH ROW EXECUTE FUNCTION stocks.signals_append_only();
DROP TRIGGER IF EXISTS signals_no_truncate ON stocks.signals;
CREATE TRIGGER signals_no_truncate BEFORE TRUNCATE ON stocks.signals
  FOR EACH STATEMENT EXECUTE FUNCTION stocks.signals_append_only();
DROP TRIGGER IF EXISTS signal_deliveries_no_change ON stocks.signal_deliveries;
CREATE TRIGGER signal_deliveries_no_change BEFORE UPDATE OR DELETE ON stocks.signal_deliveries
  FOR EACH ROW EXECUTE FUNCTION stocks.signals_append_only();
DROP TRIGGER IF EXISTS signal_deliveries_no_truncate ON stocks.signal_deliveries;
CREATE TRIGGER signal_deliveries_no_truncate BEFORE TRUNCATE ON stocks.signal_deliveries
  FOR EACH STATEMENT EXECUTE FUNCTION stocks.signals_append_only();

-- First row whose stored prev_hash or hash doesn't match a recomputation, or
-- no rows when the whole chain is intact.
CREATE OR REPLACE FUNCTION stocks.verify_signal_chain()
RETURNS TABLE (broken_at BIGINT, checked BIGINT)
LANGUAGE sql
STABLE
SET search_path = stocks, public
AS $$
  WITH ordered AS (
    SELECT s AS r, lag(s.hash) OVER (ORDER BY s.id) AS expected_prev FROM stocks.signals s
  )
  SELECT
    (SELECT min((o.r).id) FROM ordered o
      WHERE (o.r).prev_hash IS DISTINCT FROM o.expected_prev
         OR (o.r).hash <> encode(sha256(convert_to(stocks.signal_canonical(o.r), 'UTF8')), 'hex')),
    (SELECT count(*) FROM stocks.signals)
$$;

-- RLS on as defense in depth. The app role bypasses RLS and gets SELECT only.
ALTER TABLE stocks.signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocks.signal_deliveries ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON stocks.signals, stocks.signal_deliveries TO stocks_app;
GRANT EXECUTE ON FUNCTION stocks.verify_signal_chain() TO stocks_app;

-- The bot's own login: insert + read signals and deliveries, nothing else.
-- No password here: set one out of band, then use it in SIGNALS_DATABASE_URL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stocks_signals') THEN
    CREATE ROLE stocks_signals LOGIN NOINHERIT;
  END IF;
END $$;
GRANT USAGE ON SCHEMA stocks TO stocks_signals;
GRANT SELECT, INSERT ON stocks.signals, stocks.signal_deliveries TO stocks_signals;
DROP POLICY IF EXISTS signals_bot_read ON stocks.signals;
CREATE POLICY signals_bot_read ON stocks.signals FOR SELECT TO stocks_signals USING (true);
DROP POLICY IF EXISTS signals_bot_insert ON stocks.signals;
CREATE POLICY signals_bot_insert ON stocks.signals FOR INSERT TO stocks_signals WITH CHECK (true);
DROP POLICY IF EXISTS signal_deliveries_bot_read ON stocks.signal_deliveries;
CREATE POLICY signal_deliveries_bot_read ON stocks.signal_deliveries FOR SELECT TO stocks_signals USING (true);
DROP POLICY IF EXISTS signal_deliveries_bot_insert ON stocks.signal_deliveries;
CREATE POLICY signal_deliveries_bot_insert ON stocks.signal_deliveries FOR INSERT TO stocks_signals WITH CHECK (true);

REVOKE ALL ON FUNCTION stocks.signals_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stocks.signals_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stocks.verify_signal_chain() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION stocks.signal_canonical(stocks.signals) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION stocks.signal_canonical(stocks.signals) TO stocks_app;

-- The schema's default privileges hand stocks_app full DML on new tables; the
-- web app only ever reads signals, so it must not be able to insert (forge)
-- one either. Only stocks_signals writes.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON stocks.signals, stocks.signal_deliveries FROM stocks_app;
