import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeGrade, parseStoredGrade, scoreToLetter } from "../lib/grades";
import {
  ENGINE_MODEL,
  buildExtractionRequest,
  supportsForcedToolWithDisabledThinking,
} from "../lib/engine/anthropic";
import {
  CASE_STUDY_META_TOOL,
  WATCHLIST_ENTRY_TOOL,
  buildCaseStudyPrompt,
  methodologyPromptHash,
  methodologyVersion,
  systemPromptFromDataOnly,
  systemPromptWithWebSearch,
} from "../lib/engine/prompts";
import {
  MAX_PRICE_AGE_DAYS,
  PRICE_VERIFIED_ON,
  UsageMeter,
  hasKnownPrice,
  priceVerificationAgeDays,
} from "../lib/engine/usage";
import { scrubPii } from "../lib/validate";
import {
  extractInlineCitedUrls,
  extractSetupPlan,
  isUrlCitedInline,
  resolveSetupStudyPlan,
  validateAsOfDate,
  validateOhlcStudyOutput,
  validateWebStudyOutput,
} from "../lib/engine/postcheck";
import { isParseError, parseSignal } from "../lib/signals";
import {
  barsThrough,
  botRecord,
  detectBreakout,
  detectEarningsGap,
  detectRsi2Pullback,
  detectTrendPullback,
  detectVolumeSurge,
  isBotUnderperforming,
  isDescriptiveNote,
  resolveOutcome,
  scanTicker,
} from "../lib/setups";
import { summarizeScanDataSource } from "../lib/setups-run";
import type { DailyBars } from "../lib/marketdata";
import {
  bsGamma,
  buildGexSnapshot,
  dollarGammaPer1Pct,
  findZeroGamma,
  parseCboeChain,
  parseOcc,
} from "../lib/gex";
import { cboeSourceAgeMinutes, isCboeSourceStale } from "../lib/data-freshness";
import {
  changeOver,
  computeBreadth,
  readBreadth,
  readDivergence,
  readRotation,
  sma,
} from "../lib/market-context";
import { evaluateGradeDriftWarning } from "../lib/model-monitoring";

test("SS-03: scoreToLetter and computeGrade enforce exact bands and card completeness", () => {
  assert.equal(scoreToLetter(95), "A");
  assert.equal(scoreToLetter(90), "A");
  assert.equal(scoreToLetter(89), "A-");
  assert.equal(scoreToLetter(85), "A-");
  assert.equal(scoreToLetter(80), "B+");
  assert.equal(scoreToLetter(75), "B");
  assert.equal(scoreToLetter(70), "B-");
  assert.equal(scoreToLetter(60), "C+");
  assert.equal(scoreToLetter(50), "C");
  assert.equal(scoreToLetter(45), "C-");
  assert.equal(scoreToLetter(40), "D+");
  assert.equal(scoreToLetter(35), "D");
  assert.equal(scoreToLetter(30), "D-");
  assert.equal(scoreToLetter(29), "F");

  const valid = computeGrade({
    growth: { score: 84, note: "Revenue +28% YoY in Q3 10-Q" },
    profitability: { score: 78, note: "Operating margin 31%" },
    valuation: { score: 62, note: "24x forward FCF — reasonable vs growth" },
    moat: { score: 80, note: "Net dollar retention 118%" },
  });
  assert.ok(valid);
  assert.equal(valid.score, 76);
  assert.equal(valid.overall, "B");
  assert.equal(valid.components.length, 4);

  // Missing card or out-of-bounds score returns null rather than a partial grade.
  assert.equal(computeGrade({ growth: { score: 80, note: "ok" } }), null);
  assert.equal(
    computeGrade({
      growth: { score: 101, note: "bad" },
      profitability: { score: 70, note: "ok" },
      valuation: { score: 70, note: "ok" },
      moat: { score: 70, note: "ok" },
    }),
    null
  );

  // parseStoredGrade re-derives overall letter from numeric score.
  const rederived = parseStoredGrade({ ...valid, overall: "A+" });
  assert.equal(rederived?.overall, "B");
});

test("R3 / SS-03: buildExtractionRequest adapts request shape across Sonnet model generations", () => {
  assert.equal(supportsForcedToolWithDisabledThinking("claude-sonnet-5"), true);
  assert.equal(supportsForcedToolWithDisabledThinking("claude-sonnet-5-5"), false);

  const reqLegacy = buildExtractionRequest(
    {
      researchedText: "As of November 10, 2026\nStudy text",
      instructions: CASE_STUDY_META_TOOL.instructions,
      toolName: CASE_STUDY_META_TOOL.toolName,
      schema: CASE_STUDY_META_TOOL.schema,
    },
    "claude-sonnet-5"
  );
  assert.deepEqual(reqLegacy.thinking, { type: "disabled" });
  assert.deepEqual(reqLegacy.tool_choice, { type: "tool", name: "record_case_study_meta" });

  const reqNext = buildExtractionRequest(
    {
      researchedText: "Watchlist text",
      instructions: WATCHLIST_ENTRY_TOOL.instructions,
      toolName: WATCHLIST_ENTRY_TOOL.toolName,
      schema: WATCHLIST_ENTRY_TOOL.schema,
    },
    "claude-sonnet-5-5"
  );
  assert.equal("thinking" in reqNext, false);
  assert.deepEqual(reqNext.tool_choice, { type: "auto" });
  const tool = (reqNext.tools as any[])[0];
  assert.equal(tool.strict, true);
  assert.equal(tool.input_schema.additionalProperties, false);
  // Original schema object was not mutated.
  assert.equal("additionalProperties" in WATCHLIST_ENTRY_TOOL.schema, false);
});

test("R9 / SS-11: Anthropic price verification date is current and ENGINE_MODEL is priced", () => {
  assert.equal(hasKnownPrice(ENGINE_MODEL), true);
  const refNow = new Date("2026-11-11T00:00:00Z");
  const age = priceVerificationAgeDays(refNow);
  assert.ok(Number.isFinite(age) && age >= 0 && age <= MAX_PRICE_AGE_DAYS, `PRICE_VERIFIED_ON=${PRICE_VERIFIED_ON} age=${age}`);
  assert.ok(priceVerificationAgeDays(new Date("2028-01-01T00:00:00Z")) > MAX_PRICE_AGE_DAYS);

  const meter = new UsageMeter("claude-sonnet-5");
  meter.add({ input_tokens: 100_000, output_tokens: 10_000, server_tool_use: { web_search_requests: 3 } });
  assert.ok(Math.abs((meter.costUsd() ?? 0) - 0.33) < 1e-9);
});

test("R11 & R12: worker prompts strip CLI blocks/external refs and scrub customer PII", () => {
  assert.equal(methodologyVersion(), "2.0.0");
  assert.match(methodologyPromptHash(), /^[0-9a-f]{12}$/);

  for (const sys of [systemPromptWithWebSearch(), systemPromptFromDataOnly()]) {
    assert.doesNotMatch(sys, /npm run engine/);
    assert.doesNotMatch(sys, /npm run candles/);
    assert.doesNotMatch(sys, /npm run history/);
    assert.doesNotMatch(sys, /anthropic-skills:/);
    assert.doesNotMatch(sys, /nxwehsafitrcoenbrkyv/);
  }

  const scrubbed = scrubPii(
    "Check NVDA Q3 ($35.1B rev, 2026-11-10) for jane.doe@example.com, SSN 123-45-6789, card 4111 2222 3333 4444, tel (415) 555-0199."
  );
  assert.match(scrubbed, /NVDA Q3 \(\$35\.1B rev, 2026-11-10\)/);
  assert.doesNotMatch(scrubbed, /jane\.doe@example\.com/);
  assert.doesNotMatch(scrubbed, /123-45-6789/);
  assert.doesNotMatch(scrubbed, /4111 2222/);
  assert.doesNotMatch(scrubbed, /555-0199/);
  assert.match(scrubbed, /\[EMAIL REDACTED\]/);
  assert.match(scrubbed, /\[SSN REDACTED\]/);
  assert.match(scrubbed, /\[CARD REDACTED\]/);
  assert.match(scrubbed, /\[PHONE REDACTED\]/);

  const built = buildCaseStudyPrompt({
    ticker: "NVDA",
    variant: "full",
    company: "NVIDIA",
    notes: "Email me at founder@acme.io or call +1 650-555-1234 about Q3 margins.",
  });
  assert.doesNotMatch(built, /founder@acme\.io/);
  assert.doesNotMatch(built, /650-555-1234/);
});

test("R1 & R2: deterministic web and OHLC study post-checks + setup plan resolution", () => {
  const now = new Date("2026-11-11T15:00:00Z");
  assert.equal(validateAsOfDate("November 10, 2026", now).ok, true);
  assert.equal(validateAsOfDate("November 25, 2026", now).ok, false, "future date rejected");
  assert.equal(validateAsOfDate("January 1, 2020", now).ok, false, "stale date rejected");

  const validStudy = [
    "**As of November 10, 2026**",
    "",
    "Revenue grew 22% YoY to $12.4B per the [Q3 2026 10-Q](https://www.sec.gov/Archives/edgar/data/1/q3.htm).",
    "",
    "*Not investment advice. This is a business-quality case study framework.*",
  ].join("\n");
  const webOk = validateWebStudyOutput({
    content: validStudy,
    variant: "full",
    sources: [
      { title: "SEC Q3 10-Q", url: "https://www.sec.gov/Archives/edgar/data/1/q3.htm" },
      { title: "Background news", url: "https://finance.example.com/news" },
    ],
    asOfDate: "November 10, 2026",
    now,
  });
  assert.equal(webOk.ok, true);
  const cited = extractInlineCitedUrls(validStudy);
  assert.equal(isUrlCitedInline("https://www.sec.gov/Archives/edgar/data/1/q3.htm", cited), true);
  assert.equal(isUrlCitedInline("https://finance.example.com/news", cited), false);

  assert.equal(
    validateWebStudyOutput({
      content: validStudy.replace(/Not investment advice.*/i, "Buy now!"),
      variant: "full",
      sources: [{ title: "SEC", url: "https://www.sec.gov/q3" }],
      now,
    }).ok,
    false
  );
  assert.equal(
    validateWebStudyOutput({ content: validStudy, variant: "full", sources: [], now }).ok,
    false
  );

  // One-candle setup post-checks.
  const candles = [
    { t: "11/10/2026, 09:30", o: 100.0, h: 101.0, l: 99.5, c: 100.8 },
    { t: "11/10/2026, 09:31", o: 100.8, h: 101.2, l: 100.4, c: 101.0 },
    { t: "11/10/2026, 09:35", o: 101.0, h: 102.4, l: 100.9, c: 102.2 },
    { t: "11/10/2026, 09:38", o: 101.6, h: 102.8, l: 101.5, c: 102.6 },
  ];
  const openingRange = { start: "11/10/2026, 09:30", end: "11/10/2026, 09:35", open: 100.0, high: 101.2, low: 99.5, close: 101.0 };

  const validOneCandle = [
    "**As of November 10, 2026** — AAPL (America/New_York, 2026-11-10)",
    "Opening 5-minute range (09:30–09:35): High $101.20, Low $99.50.",
    "Displacement candle at 09:35, bullish engulfing confirmation at 09:38.",
    "**Verdict**: Valid setup",
    "### Trade Plan",
    "- **Entry**: $102.00",
    "- **Stop**: $101.00",
    "- **Target**: $105.00",
    "",
    "*Educational framework analysis — not a trade recommendation. Paper trade / backtest and follow your own risk rules.*",
  ].join("\n");

  const ohlcOk = validateOhlcStudyOutput({
    content: validOneCandle,
    variant: "one_candle",
    candles,
    openingRange,
    now,
  });
  assert.equal(ohlcOk.ok, true);
  if (ohlcOk.ok) {
    assert.deepEqual(ohlcOk.plan, { direction: "long", entry: 102, stop: 101, target: 105 });
  }

  // Fabricated timestamp 10:42 rejected.
  const badTime = validateOhlcStudyOutput({
    content: validOneCandle.replace("09:38", "10:42"),
    variant: "one_candle",
    candles,
    openingRange,
    now,
  });
  assert.equal(badTime.ok, false);

  // Invalid verdict that still emits a trade plan is rejected.
  const contradictory = validateOhlcStudyOutput({
    content: validOneCandle.replace("Valid setup", "Invalid setup"),
    variant: "one_candle",
    candles,
    openingRange,
    now,
  });
  assert.equal(contradictory.ok, false);
  assert.equal(extractSetupPlan(validOneCandle.replace("Valid setup", "Invalid setup")), null);

  // Plan outcome resolution handles targets, stops, and ambiguous same-day bars.
  const planBase = {
    sessionDate: "2026-11-10",
    direction: "long" as const,
    entryPrice: 102,
    stopPrice: 101,
    targetPrice: 105,
    horizonSessions: 3,
  };
  assert.deepEqual(
    resolveSetupStudyPlan(planBase, {
      dates: ["2026-11-10", "2026-11-11", "2026-11-12"],
      highs: [103, 104, 105.5],
      lows: [99.5, 101.4, 103],
      closes: [102, 103.5, 105.2],
      adjCloses: [102, 103.5, 105.2],
    }),
    { outcome: "target", exitDate: "2026-11-12" }
  );
  assert.deepEqual(
    resolveSetupStudyPlan(planBase, {
      dates: ["2026-11-10", "2026-11-11"],
      highs: [103, 106],
      lows: [99.5, 100.5],
      closes: [102, 104],
      adjCloses: [102, 104],
    }),
    { outcome: "ambiguous", exitDate: "2026-11-11" }
  );
});

test("R5 / SS-09: parseSignal enforces directional ordering and magnitude sanity", () => {
  assert.equal(isParseError(parseSignal("BUY GOOGL CALL @12.40 tp 15 sl 11 breakout")), false);
  assert.equal(isParseError(parseSignal("BUY AAPL @180 tp 195 sl 172")), false);
  assert.equal(isParseError(parseSignal("SELL TSLA @250 tp 220 sl 265")), false);
  assert.equal(isParseError(parseSignal("BUY QQQ PUT @8.50 tp 12 sl 6.50")), false);
  assert.equal(isParseError(parseSignal("BUY QQQ PUT @490 tp 475 sl 498")), false);
  assert.equal(isParseError(parseSignal("EXIT NVDA @142.50")), false);
  assert.equal(isParseError(parseSignal("BUY MSFT")), false);

  // Missing @entry when tp/sl supplied
  assert.equal(isParseError(parseSignal("BUY AAPL tp 195 sl 172")), true);
  // Inverted BUY stock levels
  assert.equal(isParseError(parseSignal("BUY AAPL @180 tp 170 sl 190")), true);
  // Inverted SELL stock levels
  assert.equal(isParseError(parseSignal("SELL TSLA @250 tp 270 sl 230")), true);
  // Missing-decimal typo on PUT stop (`sl 110` instead of `11.0`)
  assert.equal(isParseError(parseSignal("BUY GOOGL PUT @12.40 tp 15 sl 110")), true);
  // Missing-decimal typo on stock target (`tp 1950` on `@180`)
  assert.equal(isParseError(parseSignal("BUY AAPL @180 tp 1950 sl 172")), true);
  // EXIT cannot set new tp/sl
  assert.equal(isParseError(parseSignal("EXIT AAPL @185 tp 200")), true);
});

function makeSyntheticBars(n: number, overrides?: Partial<DailyBars>): DailyBars {
  const dates: string[] = [];
  const opens: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const closes: number[] = [];
  const adjCloses: number[] = [];
  const volumes: number[] = [];
  const startMs = Date.parse("2025-01-01T00:00:00Z");
  for (let i = 0; i < n; i++) {
    dates.push(new Date(startMs + i * 86_400_000).toISOString().slice(0, 10));
    const p = 100 + i * 0.1;
    opens.push(p);
    highs.push(p + 1);
    lows.push(p - 1);
    closes.push(p);
    adjCloses.push(p);
    volumes.push(1_000_000);
  }
  return { symbol: "TEST", dates, opens, highs, lows, closes, adjCloses, volumes, source: "yahoo", ...overrides };
}

test("R6 / SS-07: setup detectors, split normalization, Alpaca IEX skip, and bot underperformance", () => {
  // 1. 52-week breakout on Yahoo consolidated volume
  const brkBars = makeSyntheticBars(260);
  const last = 259;
  brkBars.closes[last] = 135;
  brkBars.adjCloses[last] = 135;
  brkBars.highs[last] = 136;
  brkBars.volumes[last] = 2_000_000;
  assert.equal(detectBreakout(brkBars)?.bot, "breakout_52w");

  // Skipping volume-dependent bots when source === "alpaca" (preserved across barsThrough)
  const alpacaClipped = barsThrough({ ...brkBars, source: "alpaca" }, brkBars.dates[last]);
  assert.equal(alpacaClipped.source, "alpaca");
  assert.deepEqual(
    scanTicker(alpacaClipped).map((m) => m.bot),
    []
  );
  assert.equal(summarizeScanDataSource([brkBars, alpacaClipped]), "mixed");

  // 2. Reverse-split inside lookback does NOT trigger a false 52-week breakout
  const revSplit = makeSyntheticBars(260);
  for (let k = 0; k < 200; k++) {
    // Pre 1-for-10 reverse split: raw close was $12, split-adjusted is $120.
    revSplit.closes[k] = 12;
    revSplit.adjCloses[k] = 120;
  }
  for (let k = 200; k < 260; k++) {
    revSplit.closes[k] = 100;
    revSplit.adjCloses[k] = 100;
  }
  revSplit.closes[last] = 110; // Below true prior split-adjusted high of $120!
  revSplit.adjCloses[last] = 110;
  revSplit.volumes[last] = 2_500_000;
  assert.equal(detectBreakout(revSplit), null, "reverse split must not manufacture a fake breakout");

  // 3. Forward 10-for-1 split after a signal does NOT falsely invalidate resolveOutcome
  const splitFwd = makeSyntheticBars(10);
  splitFwd.closes = [1000, 1020, 104, 106, 108, 110, 110, 110, 110, 110];
  splitFwd.adjCloses = [100, 102, 104, 106, 108, 110, 110, 110, 110, 110];
  const outcome = resolveOutcome(
    {
      sessionDate: splitFwd.dates[0],
      adjClose: 100,
      horizon: 5,
      invalidation: { value: 950, when: "close_below" },
    },
    splitFwd,
    null,
    null
  );
  assert.ok(outcome);
  assert.equal(outcome.invalidated, false, "10-for-1 split to $104 raw ($1040 pre-split) did not breach $950");

  // 4. RSI(2) pullback, Volume Surge, Trend Pullback, Earnings Gap
  const rsiBars = makeSyntheticBars(220);
  for (let k = 200; k <= 216; k++) {
    rsiBars.closes[k] = 130;
    rsiBars.adjCloses[k] = 130;
  }
  rsiBars.closes[217] = 128;
  rsiBars.adjCloses[217] = 128;
  rsiBars.closes[218] = 125;
  rsiBars.adjCloses[218] = 125;
  rsiBars.closes[219] = 121;
  rsiBars.adjCloses[219] = 121;
  assert.equal(detectRsi2Pullback(rsiBars)?.bot, "rsi2_pullback");

  const surgeBars = makeSyntheticBars(60);
  surgeBars.closes[59] = surgeBars.closes[58] * 1.06;
  surgeBars.adjCloses[59] = surgeBars.closes[59];
  surgeBars.highs[59] = surgeBars.closes[59] + 1;
  surgeBars.volumes[59] = 4_000_000;
  assert.equal(detectVolumeSurge(surgeBars)?.bot, "volume_surge");

  const trendBars = makeSyntheticBars(230);
  for (let k = 0; k < 230; k++) {
    const p = 100 + k * 0.4;
    trendBars.closes[k] = p;
    trendBars.adjCloses[k] = p;
    trendBars.lows[k] = p - 0.5;
  }
  // Spike >5% above 50-DMA 5 sessions ago, then pull back to touch 50-DMA today
  trendBars.closes[224] = 210;
  trendBars.adjCloses[224] = 210;
  const approx50 = trendBars.closes.slice(180, 229).reduce((a, b) => a + b, 0) / 49;
  trendBars.lows[229] = approx50 * 0.998;
  trendBars.closes[229] = approx50 * 1.005;
  trendBars.adjCloses[229] = trendBars.closes[229];
  assert.equal(detectTrendPullback(trendBars)?.bot, "trend_pullback_50");

  const gapBars = makeSyntheticBars(20);
  const repDate = gapBars.dates[17];
  for (let k = 18; k < 20; k++) {
    gapBars.opens[k] = 112;
    gapBars.lows[k] = 111;
    gapBars.highs[k] = 115;
    gapBars.closes[k] = 114;
    gapBars.adjCloses[k] = 114;
  }
  assert.equal(
    detectEarningsGap(gapBars, {
      last: {
        symbol: "TEST",
        company: "Test Corp",
        date: repDate,
        session: "post",
        epsForecast: 1.8,
        fiscalQuarter: "Dec 2026",
      },
      next: null,
    })?.bot,
    "earnings_gap"
  );

  // 5. Bot record & trailing-60 underperformance check
  const weakRows = Array.from({ length: 60 }, (_, idx) => ({
    direction: "up" as const,
    fwd_return: idx < 24 ? 0.03 : -0.02,
    spy_return: 0.01,
    invalidated: idx >= 24,
  }));
  const rec = botRecord(weakRows);
  assert.equal(rec.resolved, 60);
  assert.equal(rec.followedThrough, 40);
  assert.equal(isBotUnderperforming(rec), true);
  assert.equal(isDescriptiveNote("Semiconductor names accounted for four of the six breakouts today."), true);
  assert.equal(isDescriptiveNote("Investors should buy this breakout with a stop-loss at $110."), false);
});

test("SS-06 & R10: GEX maths, OCC parsing, zero-gamma interpolation, and CBOE freshness", () => {
  assert.deepEqual(parseOcc("SPXW261218C05850000"), {
    root: "SPXW",
    expiration: "2026-12-18",
    type: "call",
    strike: 5850,
  });
  assert.equal(parseOcc("BADSYMBOL"), null);

  const g = bsGamma(500, 500, 0.25, 0.2);
  assert.ok(g > 0.005 && g < 0.02);
  assert.ok(Math.abs(dollarGammaPer1Pct(0.01, 500, 1000) - 2_500_000) < 1e-6);

  // Put below spot + Call above spot creates a clear zero-gamma crossing between strikes.
  const contracts = [
    { type: "put" as const, strike: 95, years: 30 / 365, iv: 0.25, oi: 5000, gamma: 0 },
    { type: "call" as const, strike: 105, years: 30 / 365, iv: 0.25, oi: 5000, gamma: 0 },
  ];
  const zg = findZeroGamma(contracts, 100);
  assert.ok(zg !== null && zg > 98 && zg < 102, `expected crossing near 100, got ${zg}`);
  const snap = buildGexSnapshot("SPY", 100, contracts, 1, "2026-11-10T20:45:00Z");
  assert.ok(snap);
  assert.equal(snap.callWall, 105);
  assert.equal(snap.putWall, 95);
  assert.match(snap.reading, /Modeled net dealer gamma for SPY/);

  const nowMs = Date.parse("2026-11-10T21:00:00Z");
  const chain = parseCboeChain(
    "SPY",
    {
      timestamp: "2026-11-10T20:45:00Z",
      data: {
        current_price: 580,
        options: [{ option: "SPY261218C00585000", open_interest: 1200, iv: 0.18, gamma: 0.01 }],
      },
    },
    nowMs
  );
  assert.equal(chain?.sourceAt, "2026-11-10T20:45:00.000Z");
  assert.equal(cboeSourceAgeMinutes(chain?.sourceAt, nowMs), 15);
  assert.equal(isCboeSourceStale(chain?.sourceAt, 90, nowMs), false);
  assert.equal(isCboeSourceStale("2026-11-10T18:00:00Z", 90, nowMs), true);
});

test("SS-08 & R7: market-context breadth/rotation/divergence and grade drift alerts", () => {
  assert.equal(sma([10, 20, 30, 40, 50], 5), 30);
  assert.equal(changeOver({ symbol: "SPY", dates: ["d1", "d2"], closes: [100, 102.5] }, 1), 2.5);

  const series = Array.from({ length: 12 }, (_, idx) => ({
    symbol: `S${idx}`,
    dates: Array.from({ length: 210 }, (__, d) => `d${d}`),
    closes: Array.from({ length: 210 }, (__, d) => (idx < 4 ? 100 + d * 0.2 : 150 - d * 0.2)),
  }));
  const breadth = computeBreadth(series);
  assert.ok(breadth);
  assert.equal(breadth.sampled, 12);
  assert.equal(breadth.pctAbove50, 33);
  assert.match(readBreadth(breadth), /Participation is narrow/);

  const div = readDivergence({ change1d: 0.4, change5d: 1.2, change1m: 3.5, pctFrom52wHigh: -1.0 }, breadth);
  assert.ok(div && /concentrated in fewer names/.test(div));

  const rot = readRotation([
    { symbol: "XLU", name: "Utilities", change1d: 1, change5d: 2, change1m: 5, relative1m: 4.0 },
    { symbol: "XLP", name: "Consumer Staples", change1d: 0.8, change5d: 1.5, change1m: 4, relative1m: 3.0 },
    { symbol: "XLV", name: "Health Care", change1d: 0.5, change5d: 1.0, change1m: 3, relative1m: 2.0 },
    { symbol: "XLK", name: "Technology", change1d: -1, change5d: -2, change1m: -2, relative1m: -3.0 },
  ]);
  assert.match(rot, /Defensive sectors are leading/);

  assert.match(
    evaluateGradeDriftWarning([
      { bucket: "A", studies: 16, meanScore: 89, tracked: 10, avgExcessVsSpyPct: 2.1 },
      { bucket: "B", studies: 4, meanScore: 76, tracked: 3, avgExcessVsSpyPct: 0.5 },
      { bucket: "C", studies: 2, meanScore: 55, tracked: 1, avgExcessVsSpyPct: -1.2 },
      { bucket: "D/F", studies: 0, meanScore: null, tracked: 0, avgExcessVsSpyPct: null },
    ]) ?? "",
    /Grade inflation alert/
  );
});

test("R4 & R2 DB migration: daily spend warning/cap alerts and setup_study_plans ACLs", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb, created_at timestamptz DEFAULT now(), last_sign_in_at timestamptz);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
    `);
    for (const name of (await readdir("supabase/migrations")).filter((n) => n.endsWith(".sql")).sort()) {
      await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    }
    await db.query("INSERT INTO auth.users(id, email) VALUES('00000000-0000-0000-0000-000000000099', 'mrm@example.test')");
    const ws = (await db.query<{ ws: string }>("SELECT active_workspace_id AS ws FROM stocks.profiles LIMIT 1")).rows[0].ws;

    // ACL check on setup_study_plans
    for (const role of ["anon", "authenticated", "stocks_signals"]) {
      const ok = (
        await db.query<{ ok: boolean }>(
          "SELECT has_table_privilege($1, 'stocks.setup_study_plans', 'INSERT') AS ok",
          [role]
        )
      ).rows[0].ok;
      assert.equal(ok, false, `${role} must not write setup_study_plans`);
    }
    assert.equal(
      (await db.query<{ ok: boolean }>("SELECT has_table_privilege('stocks_app', 'stocks.setup_study_plans', 'INSERT') AS ok"))
        .rows[0].ok,
      true
    );

    // Log a setup study plan
    await db.query(
      "INSERT INTO stocks.case_studies(workspace_id, ticker, variant, data_source) VALUES($1, 'AAPL', 'one_candle', 'yahoo')",
      [ws]
    );
    await db.query(
      `INSERT INTO stocks.setup_study_plans(case_study_id, workspace_id, ticker, variant, session_date, direction, entry_price, stop_price, target_price)
       VALUES(1, $1, 'AAPL', 'one_candle', '2026-11-10', 'long', 220, 218, 226)`,
      [ws]
    );

    // Heartbeat with $20 daily cap: $15 job spend -> 75% warning; + $6 scan spend -> $21 >= $20 critical cap!
    await db.exec(`SELECT stocks.engine_heartbeat('{"web_research":false,"daily_spend_cap_usd":20}')`);
    await db.query(
      "INSERT INTO stocks.jobs(workspace_id, type, payload, status, cost_usd, updated_at) VALUES($1, 'build_case_study', '{\"case_study_id\":1}', 'done', 15.0, now())",
      [ws]
    );
    let found = Object.fromEntries(
      (await db.query<{ key: string; severity: string; summary: string }>("SELECT * FROM stocks.ops_health_issues()")).rows.map((r) => [
        r.key,
        r,
      ])
    );
    assert.equal(found.daily_spend_warning?.severity, "warning");
    assert.match(found.daily_spend_warning?.summary ?? "", /75% of the \$20\.00 UTC cap/);

    await db.exec(
      "INSERT INTO stocks.setup_scans(session_date, status, data_source, cost_usd, finished_at) VALUES('2026-11-10', 'done', 'yahoo', 6.0, now())"
    );
    found = Object.fromEntries(
      (await db.query<{ key: string; severity: string; summary: string }>("SELECT * FROM stocks.ops_health_issues()")).rows.map((r) => [
        r.key,
        r,
      ])
    );
    assert.equal(found.daily_spend_warning, undefined);
    assert.equal(found.daily_spend_cap?.severity, "critical");
    assert.match(found.daily_spend_cap?.summary ?? "", /\$21\.00 of the \$20\.00 UTC cap/);
  } finally {
    await db.close();
  }
});
