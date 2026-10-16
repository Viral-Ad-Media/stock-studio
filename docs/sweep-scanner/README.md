# Sweep Scanner — implementation foundation

Source: Luqman's fixed build brief, 2026-10-16. Strategy version: luqman-2026-10-16.

## Release state

**Capture and replay foundation only. Not a production detector, not deployed,
no live notifications, and no active five-minute or scorecard schedule.**
No LLM is used by this module. The existing AI setup bots are unchanged.

The app exposes /sweeps behind session authentication. Capture details are
super-admin only. Members see an honest development state, never invented
alerts, mock performance or zero counts presented as successful scanning.

## Commands

Node 22 and the existing npm dependencies are sufficient.

    npm ci
    npm test
    npm run sweep-scanner -- --help
    SWEEP_DATA_DIR=/persistent/sweep npm run sweep-scanner -- --capture
    SWEEP_DATA_DIR=/persistent/sweep npm run sweep-scanner -- --replay /path/to/tapes
    SWEEP_DATA_DIR=/persistent/sweep npm run sweep-scanner -- --score 2026-10-16

--capture refuses an empty, malformed or out-of-quarter universe. Calls are
sequential and Yahoo-only, with ten-second HTTP timeouts and a 240-second
between-ticker pass budget. A ticker already started may finish after that
budget; remaining tickers are explicitly NOT_SCANNED. Each ticker failure is
isolated. Proxy variables are removed only in the dedicated capture process,
never the web process. Complete session timestamps come from Yahoo metadata;
missing periods, missing opening bars, invalid OHLC and incomplete historical
sessions fail closed. Today's unfinished candles are excluded.

Daily context (prior daily OHLC and five complete prior 15m sessions) is cached
once successfully per date/ticker. Failed fetches may retry on a later pass.
Local current-session bars are resampled to 5m/15m on session-open boundaries.
There is no quote-source fallback. Split-adjustment consistency still needs
validation against the real historical fixtures before release.

--replay reads the six names in config/sweep/acceptance-cases.json and writes
acceptance-report.json. It always exits 2 while the complete method is blocked.
Missing files are MISSING_TAPE, never a passing negative case. A replay fixture
has the inspectSweep input shape: ticker, direction, bars, session, asOf, level
(price/name/knownAt), and explicit semantics. Bars are {t,o,h,l,c}, UTC epoch
seconds at candle open. Test hypotheses are not approved strategy defaults.

--score reads shadow_audit.jsonl and saved same-date ticker tapes. It does not
fetch missing future candles or send messages. Re-run after fresh captures to
resolve incomplete data; the date's output is replaced atomically. The audit
is never rewritten. PENDING/UNRESOLVED outcomes remain visibly separate from
OPEN. Capture-only zero counts explicitly say that no valid shadow session
has occurred. This first version rescans all records for the date; incremental
scoring and automatic daily delivery are follow-up work.

## Universe

The committed scan_universe.json is intentionally empty until a ranked source
is supplied. It is not a fabricated list of 110 "leading" companies.

    npm run sweep-universe -- verified-source.json /persistent/sweep/scan_universe.json

Set SWEEP_UNIVERSE_PATH to the generated file. Rebuild quarterly.
Output creation uses exclusive write: review and deliberately change the output
path for a new version instead of silently overwriting the prior universe.

Input:
- asOf: rebuild date, YYYY-MM-DD
- provenance: identifiable source/version of a complete US equity GICS catalog
- rows: ticker, canonical sector, sessions: 30 {date,close,volume} observations

All symbols must use identical completed sessions, in ascending order. The
builder calculates mean(close * volume), sorts by liquidity with a ticker
tie-break, takes ten per each of the eleven GICS sectors, and adds Mag 7 pins.
Both GOOG and GOOGL are retained (seven companies, eight securities); total
count may exceed 110. Catalog completeness, actual exchange session dates and
source freshness must be verified by the operator. This tool validates the
supplied observations, not the truth/completeness of an external catalog.
A sector membership/data acquisition adapter is still required for unattended
quarterly rebuilds.

## Persistence and app connection

SWEEP_DATA_DIR must be durable and writable by a **single runner host**:
- scanner.lock: exclusive lock; overlapping invocations exit immediately
- passes.jsonl: capture pass history, including failures/not-scanned tickers
- latest-pass.json: atomic capture-health snapshot read by the app
- YYYY-MM-DD/TICKER-context.json: daily context
- YYYY-MM-DD/TICKER-tape.json: latest complete tape and resampled bars
- acceptance-report.json: historical fixture diagnostics
- shadow_audit.jsonl: reserved for approved live detection records
- YYYY-MM-DD-scorecard.json: score results and explicit readiness notice

Configure the same SWEEP_DATA_DIR on the Next.js server only if both processes
can access the same persistent volume. Separate hosts need a database/object
storage transport before the preview can show worker results. There is no
automatic cross-host sync in this change. Never use ephemeral deployment disk
for live audit retention. Crash-left locks require verifying the old process is
stopped before removing scanner.lock; do not auto-steal locks.

The file append primitive and full synthetic example define the future audit
contract. Capture-only mode does not append pretend detections to the audit.

## Rules and approval boundaries

Numerical thresholds live in lib/sweep/core.mjs: 0.40% in at most five bars,
0.05% penetration, five reclaim candles, twenty-minute lookback, thirty-minute
breakdown exclusion. They are immutable defaults copied from the brief.
Changing them requires Luqman's written approval, a new strategy version and
the full replay battery. Do not offer runtime threshold sliders.

The following must be resolved before production detection:
1. Velocity origin/endpoints and lookback anchor.
2. Whether the extreme candle can reclaim; counting and deeper-extreme reset.
3. Whether any failed wick consumes a level or only a completed alert does.
4. Equal swing handling, active-level lifecycle, insufficient trend history.
5. Exact 5m consolidation recognition, lookback and target price within the OB.
6. Prior versus current opposing session level for t2.
7. Same-bar scoring tie and previous-session audit context for opening sweeps.

inspectSweep supports ONE explicit family of replay hypotheses (open/close/wick
velocity origin; include/following reclaim; first-breach extreme and consumption;
extreme-anchored lookback). It returns CANDIDATE_ONLY, never a live alert.
A deeper extreme returns BLOCKED instead of silently resetting. Strict pivots
are a testable primitive requiring an explicit tie-policy argument, not an
approved lifecycle policy. Insufficient structure yields Unknown, not A+.
The final detector, target resolver and production level-consumption state are
intentionally not supplied with invented definitions.

## Required follow-up for go-live

- Resolve the method definitions with written approval.
- Obtain actual six historical 1m tapes plus daily/15m level evidence; verify
  ticker/date/price scale and split handling.
- Implement the approved target/level policies and end-to-end detector.
- Materialize the real ranked universe and prove pass-time/data freshness.
- Add durable per-day ticker/level/direction detection state, complete audit
  evidence, notification outbox and delivery retry handling.
- Deploy the worker with an exchange calendar and DST-aware America/Chicago
  scheduling: five-minute passes 08:30–15:00; scorecard at 15:05, including
  visible zero days. Holidays/early closes must have explicit handling.
- Capture final session bars and score only data after each trigger, with
  deterministic approved tie resolution and missing-data reporting.
- Complete the measured shadow week before enabling member alerts.
- Connect approved detection IDs/levels to scenarios and journal records;
  preserve underlying price versus actual option fills.

The current PR does not satisfy the full definition of done. See delivery-report.md.
