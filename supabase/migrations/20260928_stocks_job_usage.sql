-- Per-job model spend. The worker adds each attempt's token usage and its
-- estimated cost (list prices, lib/engine/pricing.ts) after every attempt,
-- successful or not, so failed and retried jobs are counted too. Estimates:
-- a call that times out before responding reports no usage.
ALTER TABLE stocks.jobs
  ADD COLUMN IF NOT EXISTS usage_json JSONB,
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10, 4);

CREATE INDEX IF NOT EXISTS idx_jobs_cost_updated ON stocks.jobs (updated_at) WHERE cost_usd IS NOT NULL;
