# Decisions required for the complete detector

Status: unresolved. This document records questions, not an approved strategy.
Luqman's brief requires written approval for changes to Sections 2 and 5–7.
The follow-up worker/data work does not authorize silently choosing these rules.

1. **Exact levels in the examples:** META's supplied low/extreme conflicts with
   the downloaded tape. MU/WDC opened below their previous-session lows. Supply
   the intended level price, source candle/date and reclaim timestamp for each
   positive case. For TSLA, identify the 368.03 level's source.
2. **Order block:** What objectively qualifies as 5m consolidation? Specify
   number of candles or range/overlap criteria, maximum lookback, and whether t1
   uses the nearest edge, midpoint, open, or another exact price. Include a chart
   example with the block boundaries. No fixed-distance target will substitute.
3. **Opposing session level:** Does t2 use the previous-session high/low or the
   current session's opposite extreme known at the reclaim? If current, should
   the value freeze at the trigger? Future session extremes cannot be used.
4. **Velocity and time:** Specify the start price for the 0.40% move (open, close,
   or wick), the twenty-minute anchor, whether the extreme candle may reclaim,
   and whether it counts among the five candles. A wick-to-wick measurement on
   one OHLC bar does not reveal which extreme occurred first.
5. **Repeated extremes/levels:** Does a deeper wick restart the reclaim clock?
   Does an unsuccessful sweep consume the level for the day, or only an alert?
   Specify swing expiration/merging when multiple confirmed levels share a price.
6. **Trend edges:** How should equal swing highs/lows and insufficient confirmed
   structure be handled? Current primitives label insufficient history Unknown;
   they do not emit an A+ live alert based on that diagnostic state.
7. **Scoring/audit edges:** How should a bar reaching t1 and closing past the
   extreme be resolved? Should opening-event audit context include the previous
   session to provide all ten preceding candles? Missing data remains a data
   failure rather than an OPEN result.

An approved definition can be attached as a versioned method amendment, followed
by deterministic implementation and a complete candle-by-candle replay report.
No UI slider or environment variable bypasses this requirement.
