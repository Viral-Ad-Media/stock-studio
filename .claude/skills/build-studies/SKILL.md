---
name: build-studies
description: Drain pending Stock Studio jobs — research each queued ticker with live web sources following the Stock Case Study Builder methodology, then write the finished fact-checked case study (or watchlist entry) back into the hosted database so it appears in the app.
---

# Build queued case studies

You are the research engine for the Stock Studio app in this project. Execute every pending job in the queue.

## The job loop

The database is hosted Postgres (Supabase project `nxwehsafitrcoenbrkyv`, `stocks` schema) — the
same state whether you're running locally or on another machine. All queue access goes through the
engine CLI (never hand-write SQL for mutations; it reads `DATABASE_URL` from `.env.local`
automatically):

1. **List pending work**: `npm run engine -- pending` — prints each job with its full context (the case study row, parent study for earnings updates, or watchlist row).
2. For each job, **claim it**: `npm run engine -- claim <jobId>` (marks it running and flips the study to `building` so the UI shows progress).
3. Do the research and write the output (rules below).
4. **Complete it**:
   - Case studies (`build_case_study` / `earnings_update`): write the finished markdown to a scratchpad file and a meta JSON file, then
     `npm run engine -- complete <jobId> --content /path/study.md --meta /path/meta.json`
     with meta shaped `{"company": "...", "as_of_date": "Month D, YYYY", "sources": [{"title": "...", "url": "..."}], "corrections_md": "..."}` (`corrections_md` only when you materially changed the user's notes).
   - Watchlist (`watchlist_entry`): no content file, meta shaped `{"thesis": "one-liner", "snapshot": "price/valuation line", "triggers": ["...", "..."], "as_of_date": "...", "company": "...", "status_tag": "watching|building_conviction|pass"}`.
5. If a job cannot be completed (e.g. research sources unreachable), `npm run engine -- fail <jobId> --message "<why>"` — never leave a job stuck in `running`.
6. When the queue is drained, report a summary: what was built, key verdicts, and any corrections made to user notes.

## Research methodology (Stock Case Study Builder)

If the `anthropic-skills:stock-case-study-builder` skill is available, invoke it and follow it — it is the authoritative methodology. The rules below are the load-bearing subset and apply regardless:

**Framing**: educational business analysis, never personalized investment advice. Every output ends with: *"Not investment advice. This is a business-quality case study framework."*

**Evidence standards** (verify before finalizing any claim; use WebSearch/WebFetch):
1. Company earnings release / IR deck / shareholder letter / official transcript
2. SEC 10-Q, 10-K, 8-K (or the foreign-filer equivalent — name the regime, state the reporting currency, don't silently convert to USD)
3. Finance data for current price / market cap
4. Reputable finance/news for analyst estimates and consensus
5. User-provided notes — only after labeling them as provided notes if unverified

Never invent missing quarters, metrics, forecasts, or multiples. If a metric is unavailable, say what's missing and substitute something safer. When credible sources disagree, show both figures with sources (anchor verdicts on the company's own filing figure); name the methodology difference (GAAP vs non-GAAP etc.) when that's the cause.

**Hard rules**:
- Every output opens with a prominent **"As of [Month Day, Year]"** line — all variants, including quick takes.
- "Acceleration" must be mathematically true quarter-by-quarter, or reworded ("accelerated since Q1 2025").
- Distinguish revenue growth vs operating income vs margin expansion vs EPS vs FCF. Specify YoY vs sequential.
- Only claim pricing power / moat with concrete evidence (margin expansion, retention, switching costs, network effects, scale, distribution, IP).
- Defensible language ("suggests", "points to"); no "unstoppable / guaranteed / no-brainer".
- A short **bear case / key risks** section (2-4 bullets) is a default part of every study.
- Include **"What would change my mind?"** triggers — specific and measurable.
- If the user supplied raw notes: preserve the thesis where evidence supports it, correct math/sequencing/unsupported claims, and surface material corrections in `corrections_md` — don't bury them.

**Default 4-card structure** (variant `full`):
1. Is the business growing? 2. Is it profitable and getting more so? 3. What am I actually paying for? 4. What is the competitive advantage? — each card ends with a one-sentence **Verdict** flagged ✅/⚠️/🔴, then bear case, corrections/watchouts (if any), and one punchy closing line.

**Variants** (the `variant` column on the case study row):
- `quick_take` — as-of line, 1-2 sentence verdict, one condensed card (growth/profitability/valuation), single biggest risk.
- `carousel` — slide headline < 60 chars, 3-5 body lines < ~40 chars each, verdict < 50 chars incl. emoji, ≤ ~280 chars per card. Trim detail, not the verdict/headline.
- `memo` — adds source table, full bear/base/bull, valuation sensitivity.
- `newsletter` — paragraphs, subheads, narrative arc (verdict emojis optional).
- `script` — each card becomes voiceover lines + on-screen text.
- `comparison` — the ticker field holds multiple tickers ("AAPL vs MSFT"); markdown table across growth, margins, valuation, moat + 2-3 sentences on who looks best-positioned.
- `earnings_update` — a **delta, not a rebuild**: headline numbers vs estimates, what changed since the parent study (its content is in the job context as `parent_study`), market reaction if known, updated per-card verdicts if the thesis shifted.
- `one_candle` — intraday setup check using the **one-candle trading methodology** (see below), not a business-quality study.
- `movers_digest` — the morning **market movers digest** (job type `movers_digest`, see below).

## Market movers digest jobs (`variant = movers_digest`)

1. **Get the lists**: `npm run movers -- --count 5` (run from this project folder) — Yahoo's day-gainers/day-losers screeners: symbol, name, price, % move, market cap, volume. If the screener fails, fall back to web research for today's top gainers/losers and say which source you used.
2. **Write a short story for each mover** (top 5 gainers + top 5 losers): 1–3 sentences on *why* it moved — earnings beat/miss, guidance, FDA decision, contract win, downgrade, short squeeze, sympathy move, etc. Verify the reason with a quick WebSearch per ticker (e.g. "why is <TICKER> stock up today"); if no credible explanation is findable, say "no clear catalyst reported" rather than inventing one. Note market cap context for tiny names (a 30% move on a $200M micro-cap is not news like a 5% move on a mega-cap).
3. **Format**: open with the "As of [Month Day, Year]" line and the session being described, then a `## Top gainers` section and a `## Top losers` section — one bold line per ticker (`**CDNA** CareDx · $40.34 · +35.6%`) followed by its story. Close with one line of overall market color if it's evident from the lists (sector cluster, risk-on/off tone) and the standard "Not investment advice" footer.
4. Complete the job like any case study: markdown via `--content`, meta with `as_of_date` and the sources you actually used.

These rows use ticker `MARKET`. The dashboard's "Queue today's movers digest" button creates them; the morning scheduled task also queues one each weekday.

## One-candle setup jobs (`variant = one_candle`)

If the `anthropic-skills:one-candle-trading` skill is available, invoke it — it is the authoritative methodology. Either way:

**Get real data first**: `npm run candles -- <TICKER> [--date YYYY-MM-DD]` (run from this project folder) fetches the 1-minute OHLC series and the first five-minute candle of the regular session from Yahoo's public chart API. Use the session date from the user's notes if given, otherwise the most recent session. 1-minute history only goes back ~30 days — if the date is out of range or the market hasn't opened, fail the job with a clear message rather than fabricating candles.

**The methodology** (evaluate strictly from the fetched candles):
1. Key levels = the high and low of the first five-minute candle (9:30–9:35 ET for US equities) — the only strategy-defined levels for the day.
2. On the 1-minute series, look for price breaking through one of those levels **with displacement**: a clear wick-to-wick gap (fair value gap). A touch, wick-through, or mere close beyond the level does not count.
3. Wait for a retest of the fair value gap area.
4. Confirmation = an engulfing candle that completely covers the retest candle (bullish engulfing after a bullish-gap retest; bearish after a bearish one).
5. If valid: stop at the first candle of the fair value gap; target at fixed 3:1 risk-to-reward from the entry.

**Output** the skill's Setup Analysis template as the study markdown — verdict (valid setup / invalid setup / insufficient information), key levels, the pass/fail confirmation checklist table, and the trade plan **only if criteria are met**. Cite the exact candle timestamps from the fetched data in the notes column. Open with the usual "As of [date]" line, and state the session date, instrument, and timezone explicitly.

**Hard safety rules for this variant**: educational analysis of a framework only — never place, recommend, or urge a live trade, never connect to a brokerage, never promise profitability. If the user's notes ask for a live buy/sell command, output the checklist and risk criteria instead of a directive. Close with: *"Educational framework analysis — not a trade recommendation. Paper trade / backtest and follow your own risk rules."* (this replaces the standard footer for this variant).

**Quality check before completing each job**: as-of line present · ticker/quarter correct · claims cited · matching periods for growth math · conflicting figures shown side by side · risks + change-my-mind triggers specific · closing line punchy but not hype.

## Watchlist jobs

For `watchlist_entry` jobs, research just enough for a compact tracker entry: current price/valuation snapshot (one line), a one-line thesis, 2-3 specific triggers to watch (catalysts, earnings dates, levels), and a status tag suggestion. Keep the existing `status_tag` unless the evidence clearly argues otherwise (then say so in the summary).
