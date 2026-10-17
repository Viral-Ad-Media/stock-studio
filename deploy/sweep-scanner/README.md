# Capture worker deployment

This opt-in worker collects tape and writes local scorecards. It does not enable
live detections, place trades, send messages, or turn capture-only zero counts
into shadow performance. No service is created by merging this change.

## One-host Docker installation

From the repository root:

```sh
docker compose --env-file .env.local -f docker-compose.yml -f deploy/sweep-scanner/compose.yml --profile sweeps build
docker compose --env-file .env.local -f docker-compose.yml -f deploy/sweep-scanner/compose.yml --profile sweeps up -d
```

The non-root worker and web app share a named persistent volume; the web mount
is read-only. This resolves the original same-host capture-health transport gap.
Back up the volume. Separate hosts still require a database/object-store transport.
Both containers must run with the image's node UID (1000). If an existing volume
has different ownership, fix ownership before starting; do not run as root to
work around it. The worker needs no database or AI-provider credentials.

Before starting scheduled captures, put the complete, current GICS catalog at
`/data/sweep/catalog.json` on the volume and run inside the worker image:

```sh
node scripts/sweep-acquire-universe.mjs /data/sweep/catalog.json /data/sweep/universe
```

Catalog schema: `{scope:"US_EQUITIES",classification:"GICS",complete:true,
asOf:"YYYY-MM-DD",provenance:"source/version",rows:[{ticker,sector}]}`. Supply
the complete eligible US-equity catalog; do not label an index subset complete.
All 30 daily sessions are fetched sequentially and cached. A single failed
candidate prevents publication of a READY ranking. Existing output is replaced
only after every candidate succeeds. The existing universe is still subject to
the capture command's quarterly freshness gate. A current catalog source remains
an operator input, not a fabricated default bundled in this PR.

## Schedule

`npm run sweep-worker` is a long-lived process that polls every 15 seconds and
executes each eligible slot once. `npm run sweep-worker -- --once` checks just
the current slot. Dates/times use America/Chicago; DST is not hard-coded.

- Capture slots: every five minutes from 08:30 through the equity close.
- The 08:30 pass waits for a completed candle rather than reporting a failure.
- Early closes end capture at 12:00 CT; no weekend/holiday captures.
- Scorecard: 15:05 CT on weekdays, including holiday/zero-alert days.
- Calendar coverage: 2026–2027, based on NYSE's published schedule. Unknown years
  and conflicting Yahoo session metadata fail closed. Update for exceptional
  closures before using the worker.

`scheduler-state.json` records the current attempted slot before spawning.
`scheduler-events.jsonl` records completion/failure and bounded command output.
The separate scheduler lock prevents competing worker processes; the scanner
lock prevents overlapping capture/history/replay/score operations. Command
failures are visible; a skipped invocation is not historical alert evidence.
Failed or interrupted slots are not automatically replayed after restart;
review the failure then run the appropriate one-shot command manually.

SIGTERM stops the loop after the active bounded command completes. Allow six
minutes for shutdown. A 330-second child timeout terminates a hung command and
can leave scanner.lock. Verify that the old process is stopped before clearing
that file. Never use timeout-based lock stealing while the owner might run.

## Daily output and remaining activation work

Scorecards are saved as YYYY-MM-DD-scorecard.json and latest-scorecard.json,
with capture-only/blocked status. No notification destination is configured and
no messages are sent. Target definitions, full detection/audit state, delivery
outbox, and successful historical acceptance remain prerequisites for live alerts.
