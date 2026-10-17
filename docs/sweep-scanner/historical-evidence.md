# Historical source reconciliation — 2026-10-17

Six Yahoo Finance tapes are committed under tests/fixtures/sweep/historical.
Each has 390 consecutive, completed regular-session 1m bars, the previous daily
OHLC, five previous complete 15m sessions, retrieval metadata, and a SHA-256
checksum. Regression tests check the tape and context boundaries and checksums.
These snapshots preserve the prices returned on acquisition; they do not prove
that Yahoo's data is correct relative to another chart provider.

The acquisition-report.json and config/sweep/historical-evidence.json contain
unrounded machine-readable evidence. Prices below are rounded for readability.

| Case | Session open | Prior-session low | Brief extreme found? | Finding |
|---|---:|---:|---|---|
| META 2026-10-16 | 736.70 | 715.58 | No: 733.89 absent | Brief says prior low 734.29. Reconcile source/date/level and extreme. |
| MU 2026-10-15 | 871.58 | 913.56 | Yes: 858.00 | Open is already below previous-session low. That level is excluded; identify the intended older/swing low. |
| WDC 2026-10-15 | 345.33 | 362.50 | Yes: 336.00 | Same previous-session gap-through conflict. Identify the intended level. |
| MU 2026-10-12 | 1002.41 | 1017.00 | Not specified | Opening gap through the supplied 1017 level is confirmed. The exclusion primitive rejects it. |
| TSLA 2026-10-14 | 371.15 | 371.30 | Not specified | Supplied 368.03 is not this prior-session low; its swing/source identity must be specified for full replay. |
| BAC 2026-10-14 | 49.83 | 53.64 | Not specified | Opening below the previous low is observable. The earnings/news cause and percentage claim were not independently verified. |

"Found" means a minute-bar directional extreme is within $0.011 of the stated
price. It is a source-comparison tolerance, NOT a detector threshold. Detection
continues to use unrounded prices and the original 0.40%/0.05% rules.

The positive MU/WDC cases could still reference another eligible historical
level. This report does not declare them impossible or pick a replacement level
after seeing the outcome. It flags the previous-session-low interpretation and
requests exact level provenance.

## Acceptance status

The MU October 12 GAP_THROUGH invariant is now exercised against real data.
The full six-case strategy acceptance battery remains BLOCKED_METHOD: target
calculation and exact timing/level semantics have not been approved. Neither
the two observed positive extremes nor the matching MU trap establishes a full
acceptance pass. No rule was loosened and no example price was silently changed.

## Commands

```sh
npm run sweep-scanner -- --history .sweep-data/historical
npm run sweep-scanner -- --replay tests/fixtures/sweep/historical
```

History acquisition is sequential, date-bounded and resumable. Existing fixtures
are validated and reused, not overwritten with revised vendor data. Acquisition
fails visibly if Yahoo no longer retains a requested date. The replay command
currently exits 2 with BLOCKED_METHOD and includes the acquired price evidence.
Keep any replacement dataset separately with provenance if reconciliation is
needed; do not edit the committed prices to match labels.
