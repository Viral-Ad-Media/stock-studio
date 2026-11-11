# Stock Studio — SR 11-7 Model Cards (`SS-01` – `SS-12`)

- **Last updated**: 2026-11-11
- **Methodology version**: `2.0.0` (`lib/engine/methodology.md`)

---

## `SS-01` — Web-Research Case Study Engine
- **Tier**: 1 | **Type**: Vendor LLM (`claude-sonnet-5`) + hosted `web_search_20260209`
- **Code**: `lib/engine/anthropic.ts` (`researchWithWebSearch`), `lib/engine/prompts.ts`, `lib/engine/methodology.md`, `lib/engine/worker.ts`, `lib/engine/postcheck.ts`
- **Purpose & Decision**: Generates dated educational business-analysis studies (`full`, `quick_take`, `memo`, `newsletter`, `script`, `carousel`, `comparison`, `earnings_update`, `movers_digest`) queued by members.
- **Inputs**: Validated ticker(s), format variant, optional company name, PII-scrubbed customer notes (`scrubPii`), optional parent study markdown (`earnings_update`), and Yahoo/Alpaca movers list (`movers_digest`).
- **Assumptions & Limitations**: Relies on public web search retrieval within a bounded search budget (`lib/engine/budgets.ts`). LLM synthesis can misread GAAP vs. non-GAAP tables or secondary commentary if primary filings are not retrieved first.
- **Controls**: `ENGINE_WEB_RESEARCH` off by default pending 20-study golden-set sign-off; CLI instructions stripped from worker prompt; customer PII scrubbed; `validateWebStudyOutput()` enforces `"As of"` date validity, closing `"Not investment advice"` footer, non-empty sources, and safe markdown; UI labels links **"Pages searched & referenced"** with inline **`Cited in text`** badges.
- **Monitoring**: 30-day `postcheck_failed` count, daily USD spend ceiling (`$25` UTC), and `data_source` provenance on `/admin/system`.

---

## `SS-02` — Intraday & Swing OHLC Setup Study Engine (`one_candle`, `davinci_model`)
- **Tier**: 1 | **Type**: Vendor LLM (`claude-sonnet-5`) grounded on fetched OHLC JSON (no web search)
- **Code**: `lib/engine/anthropic.ts` (`writeFromData`), `lib/marketdata.ts` (`fetchOpeningCandle`, `fetchHistory`), `lib/engine/postcheck.ts` (`validateOhlcStudyOutput`, `resolveSetupStudyPlan`)
- **Purpose & Decision**: Evaluates whether fetched 1-minute or 5-minute OHLC bars satisfy the taught One-Candle or Da Vinci framework checklist and outputs an educational breakdown.
- **Inputs**: Exchange-local OHLC candles from Yahoo Finance (or Alpaca IEX fallback) plus PII-scrubbed session/timeframe notes.
- **Assumptions & Limitations**: Neither framework is an independently verified trading edge; 1-minute Yahoo history covers ~30 days; Alpaca fallback reflects IEX trades only.
- **Controls**: `validateOhlcStudyOutput()` verifies required variant disclaimers, source attribution (`davinci_model`), opening-range prices (`one_candle`), every quoted `HH:MM` timestamp against fetched bars, directional level ordering, session price bounds, and fixed 3:1 R:R (`one_candle`), and blocks trade plans when verdict is `invalid`/`insufficient` (refunding credits on failure).
- **Monitoring**: Valid plans are persisted to `stocks.setup_study_plans` and resolved (`target`, `stop`, `expired`, `ambiguous`) over subsequent daily sessions; hit/stop counts appear on `/admin/system`.

---

## `SS-03` — Structured Metadata Extraction & Research-Quality Grade
- **Tier**: 2 | **Type**: Vendor LLM structured tool extraction + deterministic banding
- **Code**: `lib/engine/anthropic.ts` (`buildExtractionRequest`, `extractStructured`), `lib/grades.ts` (`computeGrade`, `scoreToLetter`)
- **Purpose & Decision**: Extracts `as_of_date`, `summary_line`, `corrections_md`, and four 0–100 card scores (`growth`, `profitability`, `valuation` [higher = more reasonable], `moat`) from a finished study; deterministically computes the equal-weighted composite score and A–F letter.
- **Assumptions & Limitations**: Card scores reflect the LLM's reading of its own study text, not forward return predictions.
- **Controls**: Overall letter is never accepted from the LLM (`computeGrade`); model-aware `buildExtractionRequest()` prevents HTTP 400 breakage on `claude-sonnet-5-5`+; `GRADE_DISCLAIMER` clarifies non-advice framing.
- **Monitoring**: 30-day extraction fallback rate, 90-day A/B/C/D-F score distribution + drift alert (`>60%` concentration), and realized excess return vs. SPY per band on `/admin/system`.

---

## `SS-04` — Watchlist Thesis & Status Classifier (`intact` / `weakening` / `broken`)
- **Tier**: 2 | **Type**: Vendor LLM (`claude-sonnet-5`) + `web_search` + `extractStructuredOrFail`
- **Code**: `lib/engine/worker.ts` (`processWatchlistEntry`), `lib/engine/prompts.ts` (`WATCHLIST_ENTRY_TOOL`), `lib/grades.ts` (`parseThesisStatus`)
- **Purpose & Decision**: Produces compact tracker entries and classifies prior theses on refresh as `intact`, `weakening`, or `broken` with a one-sentence evidence note, preserving history in `stocks.watchlist_history`.
- **Assumptions & Limitations**: Single-pass web search may miss intra-quarter developments not yet reflected in indexed filings/releases.
- **Controls**: First entries are forced to `unknown`; `as_of_date` is validated; `thesis` (`<=500` chars), `snapshot` (`<=300` chars), and `triggers` (`<=5` items) are length-capped; `/watchlist` displays an explicit research-hypothesis disclaimer.
- **Monitoring**: Status counts and realized excess return vs. SPY by `thesis_status` on `/admin/system`.

---

## `SS-05` — LEAPS Option Pricing & Scenario Workspace
- **Tier**: 1 | **Type**: Closed-form European Black-Scholes with continuous dividend yield
- **Code**: `lib/leaps.ts` (`normalCdf`, `optionModel`, `leapsAnalysis`), `lib/leaps-discovery.ts`, `lib/leaps-chain.ts`, `components/leaps/LeapsClient.tsx`
- **Purpose & Decision**: Computes theoretical option price, Greeks (`delta`, `gamma`, `theta`, `vega`), breakeven, time-decay table, and exit-scenario P&L grid; discovers delayed CBOE LEAPS contracts.
- **Assumptions & Limitations**: European exercise only (does not price American early-exercise premium on deep-ITM puts or high-dividend calls); constant IV and flat risk-free rate (default `4.0%`/yr US T-bill convention; `30%` placeholder IV before loading a contract); CBOE quotes are ~15-minute delayed.
- **Controls**: Strict input range validation (`validateLeaps`), explicit model-limitations card in `LeapsClient.tsx`, put-call parity and boundary unit tests.
- **Monitoring**: CBOE `sourceAt` age helper (`cboeSourceAgeMinutes`) and user-facing `DataStamp` freshness indicator.

---

## `SS-06` — Dealer Gamma Exposure (GEX) Model
- **Tier**: 2 | **Type**: Closed-form Black-Scholes gamma + heuristic dealer-positioning sign convention
- **Code**: `lib/gex.ts` (`parseOcc`, `bsGamma`, `dollarGammaPer1Pct`, `findZeroGamma`, `buildGexSnapshot`, `readGex`)
- **Purpose & Decision**: Estimates net dollar gamma per 1% underlying move, call/put walls, and zero-gamma crossing within `±15%` of spot from CBOE delayed option chains (`/gamma`).
- **Assumptions & Limitations**: Assumes dealers are net long calls and net short puts across open interest — an unobservable market convention that can invert for single-stock call buying. Excludes contracts >365 DTE or outside `±25%` of spot.
- **Controls**: Descriptive framing (`"In this model, dealers hedging..."`), explicit `sourceAt` timestamp parsing (`sourceTimestamp`), deterministic unit tests on OCC parsing, gamma symmetry, and zero-gamma interpolation.
- **Monitoring**: CBOE delayed-quote timestamp freshness (`lib/data-freshness.ts`).

---

## `SS-07` — Daily Rule-Based Setup Bots & Desk Notes
- **Tier**: 2 | **Type**: Deterministic technical rules + constrained LLM descriptive summary
- **Code**: `lib/setups.ts`, `lib/setups-run.ts`, `app/(app)/setups/page.tsx`
- **Purpose & Decision**: Scans `SETUP_UNIVERSE` (~96 liquid large caps) after market close across 5 published chart rules (`breakout_52w`, `rsi2_pullback`, `trend_pullback_50`, `volume_surge`, `earnings_gap`) and paper-tracks forward excess returns vs. SPY.
- **Assumptions & Limitations**: Close-to-close hypothetical returns ignore commissions, spreads, and taxes; Nasdaq earnings calendar misses suppress `earnings_gap`.
- **Controls**: `splitNormalizedCloses()` prevents stock splits from causing false breakouts, distorted SMAs, or false invalidations; `scanTicker()` skips `breakout_52w` and `volume_surge` on Alpaca IEX fallback bars; `isDescriptiveNote()` drops directive desk notes; bots with `<50%` follow-through over their trailing 60 resolved matches carry a warning badge on `/setups`.
- **Monitoring**: Per-bot resolved follow-through rate on `/setups`, plus 30-day Alpaca fallback scan share and `setup_scans.cost_usd` on `/admin/system`.

---

## `SS-08` — Market Context (Sector Rotation & Large-Cap Breadth)
- **Tier**: 3 | **Type**: Deterministic descriptive statistics
- **Code**: `lib/market-context.ts` (`changeOver`, `sma`, `computeBreadth`, `readRotation`, `readBreadth`, `readDivergence`)
- **Purpose & Decision**: Summarizes 11 SPDR sector ETFs vs. SPY and 50/200-DMA participation across a 59-stock large-cap sample (`/market`, `/today`).
- **Assumptions & Limitations**: Sample of 59 large caps is a bounded proxy, not the full S&P 500; equal-weighted breadth can diverge from cap-weighted SPY.
- **Controls**: Requires `>= 10` loaded series before reporting breadth and `>= 3` sectors for rotation prose; never caches empty responses; covered by deterministic unit tests.
- **Monitoring**: `missing` symbol list returned in `MarketContext`.

---

## `SS-09` — Trade Signal Parser, Sanity Validator & Durable Relay
- **Tier**: 1 | **Type**: Deterministic regex parser + numeric level validator + SHA-256 hash-chained ledger
- **Code**: `lib/signals.ts` (`parseSignal`, `validateSignalLevels`), `lib/signal-relay.ts`, `supabase/migrations/20261004152454_stock_studio_baseline.sql`
- **Purpose & Decision**: Parses approved human trader calls (`BUY`, `SELL`, `EXIT`, `CLOSE`, `ALERT`), validates entry/target/stop levels, appends to immutable `stocks.signals`, and relays to plan-entitled Discord channels and Web Push subscribers.
- **Assumptions & Limitations**: Human discretionary calls; PUT calls may quote option premiums (`stop < entry < target`) or underlying levels (`target < entry < stop`).
- **Controls**: Approved Discord poster allowlist (`parsePosterIds`); `validateSignalLevels()` blocks missing `@entry`, inverted levels, `tp`/`sl` on `EXIT`/`CLOSE`, and magnitude typos (`❓` reply before `record_signal`); DB triggers enforce append-only SHA-256 chain (`verify_signal_chain()`).
- **Monitoring**: `signal_delivery_delayed` and `signal_bot_down` alerts in `stocks.ops_health_issues()`.

---

## `SS-10` — Intraday Sweep Scanner (Preview — Capture Only)
- **Tier**: 1 (when active) / Preview | **Type**: Rule-based intraday capture (`lib/sweep/*`)
- **Code**: `lib/sweep/dashboard.ts`, `lib/sweep/core.mjs`, `app/(app)/sweeps/page.tsx`
- **Purpose & Decision**: Operational telemetry preview of intraday bar capture (`CAPTURE_ONLY`).
- **Controls**: Hard-gated in `readSweepCapture()` (`raw.mode === "CAPTURE_ONLY" && raw.alertsEnabled === false`); zero member trade alerts or scores are exposed until Tier-1 walk-forward validation passes.

---

## `SS-11` — Anthropic Token & Cost Metering (`UsageMeter`)
- **Tier**: 3 | **Type**: Deterministic list-price accounting
- **Code**: `lib/engine/usage.ts`, `lib/engine/worker.ts`, `lib/setups-run.ts`
- **Purpose & Decision**: Tracks token/search consumption across `jobs` and `setup_scans`, enforces `DAILY_SPEND_CAP_USD`, and populates `/admin` spend reporting.
- **Controls**: `PRICE_VERIFIED_ON = "2026-11-10"` with automated 365-day staleness test; `hasKnownPrice(ENGINE_MODEL)` test; `daily_spend_warning` (70%) and `daily_spend_cap` (100%) DB alerts; monthly invoice reconciliation SOP.

---

## `SS-12` — Trading Journal Realized P&L & Decision Analytics
- **Tier**: 3 | **Type**: Deterministic trade accounting
- **Code**: `lib/journal.ts` (`realizedPnl`, `journalSummary`), `lib/journal-analysis.ts` (`decisionAnalysis`)
- **Purpose & Decision**: Computes net realized P&L (including `100x` contract multiplier on options and fees), win rate, drawdown, holding-period expectancy, and thesis-linked attribution from user-logged trades.
- **Assumptions & Limitations**: Self-reported fills only; open positions are excluded from realized expectancy until closed.
- **Controls**: Strict numeric/date validation (`validateTrade`), CSV round-trip tests (`tests/journal.test.ts`), and offline outbox idempotency.
