# Initial delivery report — 2026-10-16

## Implemented

- Deterministic numerical rule primitives and an explicitly hypothetical replay
  evaluator. No AI/model calls.
- Gap-through, penetration, velocity, reclaim-window, duplicate-alert input,
  lookback and sustained-breakdown checks with named rejection reasons.
- Completed-candle validation, regular-session resampling, confirmed swings and
  trend priority. Unknown history never becomes A+.
- Yahoo-only sequential capture, per-ticker error isolation, daily context cache,
  persistent-file lock and pass-health logs.
- CLI replay manifest preserving all six cases, standalone scoring, exact alert
  text formatter, audit JSONL primitives and a clearly synthetic example.
- Deterministic GICS/30-session dollar-volume universe builder from supplied data.
- Protected /sweeps screen and admin-only capture-health integration.

## Verification

The pure arithmetic/data parser/universe tests were executed in an isolated
JavaScript harness during authoring. Full Node filesystem tests, Next build,
and TypeScript validation are assigned to the repository's existing PR CI.
See the PR for actual CI status. No live Yahoo capture or historical acceptance
replay was performed during authoring; the local execution server was unavailable.

## Historical acceptance battery

| Case | Required | Current result |
|---|---|---|
| META 2026-10-16 | CALL alert | NOT VERIFIED — historical tape absent |
| MU 2026-10-15 | CALL alert | NOT VERIFIED — historical tape absent |
| WDC 2026-10-15 | CALL alert | NOT VERIFIED — historical tape absent |
| MU 2026-10-12 | No alert: gap/breakdown | NOT VERIFIED — historical tape absent |
| TSLA 2026-10-14 | No alert: no reclaim | NOT VERIFIED — historical tape absent |
| BAC 2026-10-14 | No alert: earnings gap | NOT VERIFIED — historical tape absent |

No case is represented as passed. Missing tape is not a detector rejection.
Synthetic tests exercise corresponding trap mechanics but do not validate these
historical events. Replay output distinguishes missing/invalid input from
specific rule diagnostics; final acceptance remains BLOCKED_METHOD.

## Not delivered / not activated

Approved target calculation, complete live scanner, ranked real universe,
scheduled deployment, live notification delivery, daily scheduled scorecard,
six-case acceptance results and measured shadow performance remain outstanding.
The provided sample is synthetic; t1/t2 and trend are illustrative fields,
not outputs of an approved order-block algorithm.

See README.md for exact method ambiguities and remaining release work.
