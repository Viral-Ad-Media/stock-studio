-- Additive storage only. Journal edits never change the immutable signal feed.
CREATE TABLE stocks.journal_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES stocks.workspaces ON DELETE CASCADE,
  ticker text NOT NULL CHECK(ticker ~ '^[A-Z][A-Z0-9.\-]{0,11}$'),
  asset text NOT NULL CHECK(asset IN ('stock','call','put')),
  side text NOT NULL CHECK(side IN ('long','short') AND (asset='stock' OR side='long')),
  quantity numeric(18,6) NOT NULL CHECK(quantity > 0 AND quantity <= 1000000 AND (asset='stock' OR (quantity=trunc(quantity) AND quantity<=10000))),
  entry_price numeric(18,6) NOT NULL CHECK(entry_price > 0 AND entry_price <= 1000000),
  exit_price numeric(18,6) CHECK(exit_price >= 0 AND exit_price <= 1000000),
  opened_on date NOT NULL, closed_on date,
  strike numeric(18,6), expiration date,
  fees numeric(18,6) NOT NULL DEFAULT 0 CHECK(fees >= 0 AND fees <= 1000000),
  initial_risk numeric(18,6) CHECK(initial_risk > 0 AND initial_risk <= 1000000),
  strategy text NOT NULL DEFAULT '' CHECK(length(strategy)<=100),
  thesis text NOT NULL DEFAULT '' CHECK(length(thesis)<=4000),
  review text NOT NULL DEFAULT '' CHECK(length(review)<=4000),
  case_study_id bigint REFERENCES stocks.case_studies ON DELETE SET NULL,
  source_ref text NOT NULL DEFAULT '' CHECK(length(source_ref)<=200),
  import_key text CHECK(length(import_key)<=64),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((closed_on IS NULL) = (exit_price IS NULL)),
  CHECK(closed_on IS NULL OR closed_on >= opened_on),
  CHECK((asset='stock' AND strike IS NULL AND expiration IS NULL) OR
    (asset!='stock' AND strike > 0 AND strike <= 1000000 AND strike IS NOT NULL AND expiration IS NOT NULL AND expiration >= opened_on))
);
CREATE INDEX journal_workspace_opened_idx ON stocks.journal_trades(workspace_id, opened_on DESC, id);
CREATE UNIQUE INDEX journal_import_key_idx ON stocks.journal_trades(workspace_id, import_key) WHERE import_key IS NOT NULL;
ALTER TABLE stocks.journal_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_rows ON stocks.journal_trades TO authenticated
  USING(stocks.is_workspace_member(workspace_id)) WITH CHECK(stocks.is_workspace_member(workspace_id));
REVOKE ALL ON stocks.journal_trades FROM PUBLIC, anon, authenticated, stocks_app;
GRANT SELECT, INSERT, UPDATE ON stocks.journal_trades TO stocks_app;

-- A journal can only link research in the same tenant, including direct SQL writes.
CREATE FUNCTION stocks.check_journal_study() RETURNS trigger LANGUAGE plpgsql
  SECURITY INVOKER SET search_path=stocks,pg_temp AS $$
BEGIN
  IF NEW.case_study_id IS NOT NULL AND NOT EXISTS (
    SELECT FROM stocks.case_studies WHERE id=NEW.case_study_id AND workspace_id=NEW.workspace_id
  ) THEN RAISE EXCEPTION 'Study is not in this workspace' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION stocks.check_journal_study() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER journal_study_scope BEFORE INSERT OR UPDATE OF case_study_id,workspace_id
  ON stocks.journal_trades FOR EACH ROW EXECUTE FUNCTION stocks.check_journal_study();

CREATE TABLE stocks.leaps_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES stocks.workspaces ON DELETE CASCADE,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  ticker text NOT NULL CHECK(ticker ~ '^[A-Z][A-Z0-9.\-]{0,11}$'),
  inputs jsonb NOT NULL CHECK(jsonb_typeof(inputs)='object' AND octet_length(inputs::text)<=20000),
  archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leaps_workspace_updated_idx ON stocks.leaps_plans(workspace_id,updated_at DESC,id);
ALTER TABLE stocks.leaps_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_rows ON stocks.leaps_plans TO authenticated
  USING(stocks.is_workspace_member(workspace_id)) WITH CHECK(stocks.is_workspace_member(workspace_id));
REVOKE ALL ON stocks.leaps_plans FROM PUBLIC, anon, authenticated, stocks_app;
GRANT SELECT, INSERT, UPDATE ON stocks.leaps_plans TO stocks_app;
