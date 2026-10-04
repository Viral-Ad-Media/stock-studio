-- Allocate the final identity under the chain lock. Identity defaults may be
-- allocated before BEFORE INSERT executes, so their order is not reliable.
CREATE OR REPLACE FUNCTION stocks.signals_before_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=stocks,public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('stocks.signals.chain'));
 NEW.id := nextval(pg_get_serial_sequence('stocks.signals','id'));
 NEW.posted_at := clock_timestamp();
 SELECT hash INTO NEW.prev_hash FROM stocks.signals ORDER BY id DESC LIMIT 1;
 NEW.hash := encode(sha256(convert_to(stocks.signal_canonical(NEW),'UTF8')),'hex');
 RETURN NEW;
END $$;
-- No old hashes are rewritten; check existing integrity before rollout.
SELECT setval(pg_get_serial_sequence('stocks.signals','id'),
 greatest(coalesce((SELECT max(id) FROM stocks.signals),1),
 (SELECT last_value FROM stocks.signals_id_seq)),true);

CREATE TABLE stocks.signal_outbox (
 signal_id bigint PRIMARY KEY REFERENCES stocks.signals(id),
 destination text NOT NULL CHECK(destination ~ '^[0-9]{5,25}$'),
 attempts int NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid,
 locked_at timestamptz,
 delivered_at timestamptz,
 external_id text,
 last_error text
);
CREATE INDEX signal_outbox_pending ON stocks.signal_outbox(next_attempt_at) WHERE delivered_at IS NULL;
ALTER TABLE stocks.signal_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stocks.signal_outbox FROM PUBLIC,anon,authenticated,stocks_app,stocks_signals;
REVOKE INSERT ON stocks.signals,stocks.signal_deliveries FROM stocks_signals;

CREATE FUNCTION stocks.record_signal(p_signal jsonb,p_author_id text,p_author_name text,p_source_id text,p_destination text)
RETURNS stocks.signals LANGUAGE plpgsql SECURITY DEFINER SET search_path=stocks,public AS $$
DECLARE recorded stocks.signals;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('stocks.signals.chain'));
 INSERT INTO stocks.signals(action,ticker,instrument,entry,target,stop,detail,author_discord_id,author_name,source_message_id)
 VALUES(p_signal->>'action',p_signal->>'ticker',p_signal->>'instrument',
 (p_signal->>'entry')::numeric,(p_signal->>'target')::numeric,(p_signal->>'stop')::numeric,
 coalesce(p_signal->>'detail',''),p_author_id,p_author_name,p_source_id)
 ON CONFLICT(source_message_id) DO NOTHING RETURNING * INTO recorded;
 IF recorded.id IS NULL THEN
  SELECT * INTO recorded FROM stocks.signals WHERE source_message_id=p_source_id;
 END IF;
 -- A replay also repairs a pre-migration recorded-but-undelivered message.
 -- Already logged deliveries are never resent; old rows aren't bulk backfilled.
 IF NOT EXISTS(SELECT FROM stocks.signal_deliveries WHERE signal_id=recorded.id AND channel='discord' AND destination=p_destination) THEN
  INSERT INTO stocks.signal_outbox(signal_id,destination) VALUES(recorded.id,p_destination) ON CONFLICT DO NOTHING;
 END IF;
 RETURN recorded;
END $$;

CREATE FUNCTION stocks.claim_signal_delivery(p_destination text)
RETURNS TABLE(signal jsonb,destination text,attempts int,lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=stocks,public AS $$
DECLARE item stocks.signal_outbox;
BEGIN
 SELECT o.* INTO item FROM stocks.signal_outbox o
 WHERE o.destination=p_destination AND o.delivered_at IS NULL AND o.next_attempt_at<=now()
 AND (o.locked_at IS NULL OR o.locked_at<now()-interval '90 seconds')
 ORDER BY o.signal_id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF item.signal_id IS NULL THEN RETURN; END IF;
 UPDATE stocks.signal_outbox o SET attempts=o.attempts+1,lease_token=gen_random_uuid(),locked_at=now()
 WHERE o.signal_id=item.signal_id RETURNING o.* INTO item;
 RETURN QUERY SELECT to_jsonb(s),item.destination,item.attempts,item.lease_token FROM stocks.signals s WHERE s.id=item.signal_id;
END $$;

CREATE FUNCTION stocks.finish_signal_delivery(p_id bigint,p_lease uuid,p_external text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=stocks,public AS $$
DECLARE item stocks.signal_outbox;
BEGIN
 UPDATE stocks.signal_outbox SET delivered_at=now(),external_id=p_external,locked_at=NULL,lease_token=NULL,last_error=NULL
 WHERE signal_id=p_id AND lease_token=p_lease AND delivered_at IS NULL RETURNING * INTO item;
 IF item.signal_id IS NULL THEN RETURN false; END IF;
 INSERT INTO stocks.signal_deliveries(signal_id,channel,destination,external_id)
 VALUES(p_id,'discord',item.destination,p_external);
 RETURN true;
END $$;
CREATE FUNCTION stocks.retry_signal_delivery(p_id bigint,p_lease uuid,p_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=stocks,public AS $$
 UPDATE stocks.signal_outbox SET locked_at=NULL,lease_token=NULL,last_error=left(p_error,1000),
 next_attempt_at=now()+make_interval(secs=>least(900,5*power(2,least(attempts,8)))::int)
 WHERE signal_id=p_id AND lease_token=p_lease AND delivered_at IS NULL;
$$;
REVOKE ALL ON FUNCTION stocks.record_signal(jsonb,text,text,text,text),stocks.claim_signal_delivery(text),stocks.finish_signal_delivery(bigint,uuid,text),stocks.retry_signal_delivery(bigint,uuid,text) FROM PUBLIC,anon,authenticated,stocks_app;
GRANT EXECUTE ON FUNCTION stocks.record_signal(jsonb,text,text,text,text),stocks.claim_signal_delivery(text),stocks.finish_signal_delivery(bigint,uuid,text),stocks.retry_signal_delivery(bigint,uuid,text) TO stocks_signals;
