# Stock Studio — SR 11-7 Model Validation & Remediation Record

- **Effective date**: 2026-11-11
- **Baseline validation date**: 2026-11-10
- **Scope**: Models `SS-01` through `SS-12` across research generation, structured grading, watchlist thesis classification, options/gamma analytics, rule-based market scanners, signal relay parsing, cost metering, and journal analytics.
- **Companion artefacts**:
  - Model Cards (`SS-01`–`SS-12`): [`docs/model-risk/model-cards.md`](./model-cards.md)
  - Vendor Change & Incident Runbook: [`docs/model-risk/vendor-and-incident-runbook.md`](./vendor-and-incident-runbook.md)

---

## 1. Governance & Tiering Policy

Models are tiered by customer decision impact and financial exposure under Federal Reserve SR 11-7 principles (conceptual soundness, process verification, ongoing monitoring & outcomes analysis, and governance):

| Tier | Definition | Stock Studio Models | Governance Requirement |
|---|---|---|---|
| **Tier 1 (High)** | Directly shapes a paid report body, setup trade plan, options position sizing, or directional member alert | `SS-01`, `SS-02`, `SS-05`, `SS-09`, `SS-10` (gated) | Deterministic input/output post-checks, automated unit test suite, documented model card, outcome tracking or closed-form verification, and pre-release golden-set gate |
| **Tier 2 (Moderate)** | Summarizes or classifies existing research/chains into scores, badges, or market structure readings | `SS-03`, `SS-04`, `SS-06`, `SS-07` | Schema/boundary validation, data-source provenance tracking, non-advice UI framing, and quarterly distribution/outcomes calibration |
| **Tier 3 (Low)** | Descriptive market summaries, internal operator spend estimation, and self-reported trade accounting | `SS-08`, `SS-11`, `SS-12` | Unit-tested formulas, dated vendor pricing constants, and monthly operator reconciliation |

---

## 2. Remediated Risk Register (`R1`–`R12`)

| ID | Risk Description | Initial Level | Control & Code Remediation | Residual Status |
|---|---|---|---|---|
| **R1** | Web-research study states an unsupported figure; `"Sources"` panel previously listed every searched URL as if cited | Critical | `ENGINE_WEB_RESEARCH` remains off by default (`lib/engine/worker.ts`); UI relabeled to **"Pages searched & referenced"** with inline **`Cited in text`** tags (`app/(app)/study/[id]/page.tsx`, `components/pwa/OfflineWorkspace.tsx`); `validateWebStudyOutput()` enforces opening `"As of"` date, valid calendar bounds, non-empty sources, and closing disclaimer with automatic refund on failure (`lib/engine/postcheck.ts`); `README.md` qualified; manual operator checklist added to `lib/engine/methodology.md` | **Mitigated (Gated on Golden Set)** |
| **R2** | `one_candle` / `davinci_model` cite candle times or levels absent from fetched OHLC data, omit variant disclaimers, or emit a trade plan on an invalid setup | High | `validateOhlcStudyOutput()` deterministically checks variant-specific footers, verifies every quoted `HH:MM` timestamp against fetched candles/opening range, verifies price levels and 3:1 R:R bounds, rejects trade plans on `invalid`/`insufficient` verdicts, and refunds on failure (`lib/engine/postcheck.ts`); valid plans are logged in `stocks.setup_study_plans` and resolved against subsequent daily bars (`lib/setups-run.ts`) | **Closed** |
| **R3** | Bumping `ENGINE_MODEL` to `claude-sonnet-5-5`+ breaks `extractStructured` (`thinking: disabled` + forced `tool_choice` return HTTP 400) | High | `buildExtractionRequest()` in `lib/engine/anthropic.ts` documents and branches by model capability: `claude-sonnet-5` retains disabled thinking + forced tool choice, while newer models automatically switch to `tool_choice: { type: "auto" }` + recursive `strict: true` schemas; pinned by unit tests (`tests/sr11-7-models.test.ts`) | **Closed** |
| **R4** | Operator Anthropic spend had no daily USD ceiling | Medium | `DAILY_SPEND_CAP_USD` (`ENGINE_DAILY_SPEND_CAP_USD`, default `$25.00`/UTC day) in `lib/engine/worker.ts` holds automated claims and skips LLM desk notes when reached; `stocks.ops_health_issues()` raises `daily_spend_warning` at 70% and `daily_spend_cap` at 100% (`supabase/migrations/20261111010000_sr11_7_model_risk_controls.sql`) | **Closed** |
| **R5** | Trader typo in `entry`/`tp`/`sl` is recorded permanently in the append-only signal chain and broadcast to paying members | Medium | `validateSignalLevels()` in `lib/signals.ts` enforces `@entry` presence whenever `tp`/`sl` are given, directional ordering (`stop < entry < target` on long stock/CALL, `target < entry < stop` on short stock, strict betweenness on PUT), and magnitude ratio bands before `record_signal` runs — replying with `❓` and reason on mismatch | **Closed** |
| **R6** | Setup-bot volume rules run on Alpaca IEX single-exchange volume (~2–3% of consolidated) during Yahoo rate-limits | Medium | `barsThrough()` preserves `source`; `scanTicker()` skips `breakout_52w` and `volume_surge` when `b.source === "alpaca"`; `splitNormalizedCloses()` normalizes historical lookbacks and invalidations across stock splits; `setup_scans.data_source` is recorded and surfaced on `/setups` and `/admin/system` | **Closed** |
| **R7** | Self-graded A–F research score drifts across silent vendor model updates without calibration tracking | Medium | `loadModelMonitoring()` (`lib/model-monitoring.ts`) computes 90-day grade band counts, mean scores, grade-inflation drift alerts (`>60%` in A or D/F), and realized forward excess return vs. SPY from `live_json`, surfaced live on `/admin/system` | **Closed** |
| **R8** | Watchlist `"Thesis broken / intact"` badge lacked page-level non-advice framing, field length bounds, and outcome tracking | Medium | Explicit research-hypothesis disclaimer added to `/watchlist` (`app/(app)/watchlist/page.tsx`); `thesis` (`<=500` chars), `snapshot` (`<=300` chars), `triggers` (`<=5` items), and `as_of_date` validated in `worker.ts` and `scripts/engine.ts`; status-vs-excess-return table surfaced on `/admin/system` | **Closed** |
| **R9** | Anthropic list prices undated; setup-scan `deskNotes` LLM calls unmetered; `.env.example` pack default mismatch | Low | `PRICE_VERIFIED_ON = "2026-11-10"` + `MAX_PRICE_AGE_DAYS = 365` + `hasKnownPrice(ENGINE_MODEL)` enforced by unit tests (`lib/engine/usage.ts`); `deskNotes()` metered into `setup_scans.usage_json` and `setup_scans.cost_usd` and included in `/admin` spend totals; `.env.example` `STRIPE_CREDITS_PER_PACK` aligned to default `10` | **Closed** |
| **R10** | Yahoo Finance or CBOE delayed feed schema change or staleness degrades pages silently | Low | `cboeSourceAgeMinutes()` / `isCboeSourceStale()` added in `lib/data-freshness.ts`; LEAPS 4%/yr risk-free rate and 30% IV baseline documented in `lib/leaps.ts` and `LeapsClient.tsx`; vendor runbook published (`docs/model-risk/vendor-and-incident-runbook.md`) | **Closed** |
| **R11** | External skills (`anthropic-skills:*`) and interactive CLI instructions leaked into the API worker system prompt; prompt unversioned | Low | `lib/engine/methodology.md` stamped `v2.0.0`, external skill references and hardcoded project ref removed, CLI-only sections wrapped in `BEGIN_MANUAL_CLI_ONLY` markers and stripped by `stripManualCliSections()` (`lib/engine/prompts.ts`), and `prompt_version` + SHA-256 `prompt_hash` recorded on `jobs.usage_json` and heartbeats | **Closed** |
| **R12** | Customer notes (up to 8,000 chars) sent verbatim to Anthropic could carry PII | Low | `scrubPii()` (`lib/validate.ts`) redacts emails, SSNs, payment card numbers, and phone numbers before prompt assembly in `lib/engine/prompts.ts`; third-party AI processing and no-PII rule disclosed in `/terms` (`app/(marketing)/terms/page.tsx`) | **Closed** |

---

## 3. Pre-Activation Gate for Automated Web Research (`ENGINE_WEB_RESEARCH=1`)

`ENGINE_WEB_RESEARCH` **must remain unset (`false`)** in production until the following golden-set traceability gate passes and is signed off in git:

1. **Golden Set Composition**: 20 tickers spanning US mega-caps (4), US mid/small-caps (4), recent earnings reporters within 7 days (4), foreign private issuers reporting in non-USD currencies (4), and unprofitable / complex GAAP-vs-non-GAAP issuers (4), across `full`, `memo`, `quick_take`, `earnings_update`, and `watchlist_entry`.
2. **Traceability Audit Criteria**:
   - **0 fabricated figures**: 100% of headline revenue, operating income, EPS, FCF, and guidance numbers match the primary SEC filing or company IR release for the named period.
   - **Currency & basis accuracy**: 100% of foreign-filer studies state the reporting currency without silent USD conversion; GAAP vs. non-GAAP distinctions are explicit.
   - **Inline citation coverage**: >= 90% of quantitative card claims carry an inline `https://` citation matching an authoritative source.
   - **Post-check pass rate**: >= 95% first-pass completion without `postcheck_failed` rejection.

---

## 4. Tier-1 Gate for Sweep Scanner (`SS-10`)

The Sweep Scanner (`lib/sweep/*`, `/sweeps`) is locked to **`CAPTURE_ONLY`** with **`alertsEnabled: false`** (`lib/sweep/dashboard.ts:25`). Promoting `SS-10` to live scoring or member alerts is classified as a **Tier-1 model launch** and requires:
1. Out-of-sample walk-forward validation across >= 250 historical sessions with transaction-cost assumptions.
2. Independent review of scoring thresholds in `lib/sweep/core.mjs`.
3. Dedicated outcome-tracking table and non-advice UI disclosures matching `/setups`.

---

## 5. Change Control & Monthly Reconciliation SOP

### 5.1 Prompt & Formula Change Control
- Any edit to `lib/engine/methodology.md`, `lib/engine/prompts.ts`, `lib/grades.ts`, `lib/leaps.ts`, `lib/gex.ts`, `lib/setups.ts`, or `lib/signals.ts` **must**:
  1. Increment `methodology-version` in `lib/engine/methodology.md` when prompt instructions or scoring rubrics change.
  2. Update the corresponding entry in [`docs/model-risk/model-cards.md`](./model-cards.md).
  3. Pass `npm run typecheck` and `npm test` (including `tests/sr11-7-models.test.ts`).
  4. Receive review from a second reviewer (or independent validation pass) before merging to `main`.

### 5.2 Monthly Anthropic Invoice Reconciliation (`SS-11`)
Within 5 business days of each monthly Anthropic invoice:
1. Compare billed USD on the Anthropic Console invoice against `SUM(jobs.cost_usd) + SUM(setup_scans.cost_usd)` for the calendar month UTC.
2. Investigate any variance exceeding **10%** (checking unbilled retries, cache TTL hit differences, or list-price changes).
3. Re-verify `PRICES` and refresh `PRICE_VERIFIED_ON` in `lib/engine/usage.ts` at least annually (enforced by automated test `MAX_PRICE_AGE_DAYS = 365`).
