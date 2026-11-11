# Stock Studio — Vendor Change & Model Incident Runbook

- **Effective date**: 2026-11-11
- **Applies to**: Risk Register items `R1`, `R2`, `R3`, `R4`, `R5`, `R6`, `R10`

---

## 1. Market Data Vendor Degradation (`R6`, `R10`)

### 1.1 Yahoo Finance (`query1` / `query2.finance.yahoo.com`)
- **Symptoms**: HTTP `429` or `5xx` on chart/screener endpoints; `/admin/system` shows rising **Alpaca fallback scans (30d)** percentage.
- **Automatic Behavior**:
  1. `lib/marketdata.ts` retries alternating `query1` and `query2`, then sets a 10-minute `yahooCooldownUntil` window and falls back to Alpaca (`ALPACA_KEY_ID` / `ALPACA_SECRET_KEY`) when configured.
  2. `lib/setups.ts` (`scanTicker`) automatically skips `breakout_52w` and `volume_surge` on Alpaca IEX bars so partial single-exchange volume never triggers false breakouts, and `/setups` displays an IEX fallback banner.
- **Operator Action if Yahoo Schema Changes or Blocks Host Permanently**:
  1. Verify `ALPACA_KEY_ID` and `ALPACA_SECRET_KEY` are set on `/admin/system`.
  2. If consolidated volume is required while Yahoo remains blocked, upgrade the Alpaca feed configuration in `lib/alpaca.ts` from `feed=iex` to `feed=sip` (requires paid Alpaca Market Data SIP subscription) and update `meta.dataSource` to `"alpaca-sip"` only after verifying consolidated volume parity against NYSE/Nasdaq tape.

### 1.2 CBOE Delayed Option Chains (`cdn.cboe.com`)
- **Symptoms**: `/leaps` chain lookup returns `"Options unavailable"` or `/gamma` shows stale `sourceAt` (`isCboeSourceStale(sourceAt, 90)` during regular trading hours).
- **Automatic Behavior**: `parseCboeChain()` (`lib/gex.ts`) and `lib/leaps-chain.ts` fail closed (`null` / HTTP error) without fabricating timestamps (`sourceTimestamp()` rejects timezone-less strings).
- **Operator Action**:
  1. Fetch a sample payload (`https://cdn.cboe.com/api/global/delayed_quotes/options/SPY.json`) and inspect whether CBOE moved fields between `data`, `data.quote`, and `data.options`.
  2. Update `parseCboeChain()` in `lib/gex.ts` and `lib/leaps-chain.ts`, add a fixture regression test in `tests/sr11-7-models.test.ts`, and redeploy.

---

## 2. Anthropic Model Upgrade & Deprecation (`R3`, `R9`)

Before changing `ENGINE_MODEL` in `lib/engine/anthropic.ts` (for example from `claude-sonnet-5` to `claude-sonnet-5-5` or successor):

1. **Pricing Table**: Add the target model's input, output, 5-minute cache write (`1.25x`), cache read (`0.1x`), and `perSearch` USD rates to `PRICES` in `lib/engine/usage.ts`, and update `PRICE_VERIFIED_ON`. (`hasKnownPrice(ENGINE_MODEL)` in `tests/sr11-7-models.test.ts` fails CI if omitted.)
2. **Extraction Request Shape**: Verify `buildExtractionRequest(opts, newModel)` in `lib/engine/anthropic.ts`. Models newer than `claude-sonnet-5` reject `thinking: { type: "disabled" }` and forced `tool_choice: { type: "tool" }` with HTTP 400; `buildExtractionRequest` automatically uses `tool_choice: { type: "auto" }` + recursive `strict: true` schemas (`additionalProperties: false`).
3. **Calibration Check**: Run 10 representative case studies + 5 watchlist refreshes on staging:
   - Confirm `extraction_fallback` rate is `<= 5%`.
   - Confirm mean composite grade score stays within `±5` points of the `claude-sonnet-5` baseline on the same parent studies.

---

## 3. Daily Anthropic Spend Cap Tripped (`R4`)

- **Alert**: `daily_spend_warning` (Warning at 70% of `ENGINE_DAILY_SPEND_CAP_USD`) or `daily_spend_cap` (Critical at 100%) in Discord ops channel and `/admin/system`.
- **Automatic Behavior**: `runWorkerLoop()` stops claiming queued jobs and skips LLM `deskNotes()` while still draining live signal Web Pushes and running rule-based setup scans. Queued customer jobs remain safely in `pending` (no lost credits).
- **Operator Action**:
  1. Open `/admin` and `/admin/jobs` to inspect whether spend came from legitimate paid volume or repeated retries/unbuilt reports (`unbuilt30`).
  2. If legitimate customer demand caused the spike, raise `ENGINE_DAILY_SPEND_CAP_USD` in the Render environment and trigger `/api/engine/run` (or wait for the next cron tick).
  3. If caused by a failing upstream dependency or runaway retry pattern, fix the root cause before raising the cap.

---

## 4. Material Wrong Figure or Mistyped Signal Incident (`R1`, `R5`)

### 4.1 Material Factual Error Reported in a Delivered Study (`SS-01` / `SS-02`)
1. Locate the study row (`case_studies.id`) and inspect `sources_json`, `content_md`, and `jobs.usage_json` (`prompt_version`, `prompt_hash`).
2. Mark the study `error` (or append an operator correction banner in `corrections_md`) and issue a full credit adjustment via `/admin/users/[id]` (`admin_adjust_credits`).
3. Add the failure case to the golden-set regression corpus and tighten `lib/engine/postcheck.ts` or `lib/engine/methodology.md` (bumping `methodology-version`).

### 4.2 Mistyped Trade Signal Published (`SS-09`)
- `validateSignalLevels()` (`lib/signals.ts`) blocks missing `@entry`, inverted `tp`/`sl`, and magnitude typos before `record_signal` runs.
- Because `stocks.signals` is append-only and SHA-256 hash-chained (`verify_signal_chain()`), **never** attempt to `UPDATE` or `DELETE` a recorded row. Instead, the approved trader immediately posts a corrective `ALERT <TICKER> correction: ...` or `CLOSE <TICKER> ...` message in the Discord input channel so the correction is recorded transparently in the same hash chain and relayed to all entitled tiers.
