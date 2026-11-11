// Deterministic output post-checks and setup-plan extraction/resolution for
// SR 11-7 remediation (R1, R2, SS-01..SS-04). Pure TypeScript — safe to import
// from both worker/CLI scripts and React components.

export type PostcheckResult =
  | {
      ok: true;
      asOfIso: string;
      inlineCitedCount: number;
      verdict?: "valid" | "invalid" | "insufficient";
      plan?: ExtractedSetupPlan | null;
    }
  | { ok: false; reason: string };

export type ExtractedSetupPlan = {
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
};

export function normalizeUrlForCitationMatch(raw: string): string {
  const trimmed = String(raw ?? "")
    .trim()
    .replace(/[)\].,;:!?'"`]+$/g, "");
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    u.hash = "";
    const pathname = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : u.pathname;
    return `${u.protocol}//${u.host.toLowerCase()}${pathname}${u.search}`;
  } catch {
    return "";
  }
}

// Extracts every http(s) URL referenced directly inside study markdown so the
// UI can distinguish inline-cited sources from background pages searched (R1).
export function extractInlineCitedUrls(markdown: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!markdown) return out;
  const re = /https?:\/\/[^\s<>()[\]"'`]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const norm = normalizeUrlForCitationMatch(m[0]);
    if (norm) out.add(norm);
  }
  return out;
}

export function isUrlCitedInline(url: string, citedUrls: Set<string>): boolean {
  const norm = normalizeUrlForCitationMatch(url);
  return norm.length > 0 && citedUrls.has(norm);
}

// Validates an "As of" date string (e.g. "November 10, 2026" or "2026-11-10")
// against calendar validity, future drift (> +36h), and staleness (> maxPastDays).
export function validateAsOfDate(
  raw: string | null | undefined,
  now = new Date(),
  maxPastDays = 400
): { ok: true; isoDate: string } | { ok: false; reason: string } {
  const cleaned = String(raw ?? "")
    .replace(/\*\*/g, "")
    .replace(/^as of\s*:?\s*/i, "")
    .trim();
  if (!cleaned) {
    return { ok: false, reason: "postcheck_failed: missing As-of date" };
  }
  const isoExact = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleaned);
  let parsedMs: number;
  let isoDate: string;
  if (isoExact) {
    parsedMs = Date.parse(`${cleaned}T12:00:00Z`);
    if (!Number.isFinite(parsedMs) || new Date(parsedMs).toISOString().slice(0, 10) !== cleaned) {
      return { ok: false, reason: `postcheck_failed: invalid calendar date "${cleaned}"` };
    }
    isoDate = cleaned;
  } else {
    // Normalize abbreviated months like "Nov. 10, 2026" -> "Nov 10, 2026"
    const normalized = cleaned.replace(/\b([A-Za-z]{3,4})\.\s+/g, "$1 ");
    parsedMs = Date.parse(`${normalized} UTC`);
    if (!Number.isFinite(parsedMs)) {
      parsedMs = Date.parse(normalized);
    }
    if (!Number.isFinite(parsedMs)) {
      return { ok: false, reason: `postcheck_failed: unparseable As-of date "${cleaned}"` };
    }
    isoDate = new Date(parsedMs).toISOString().slice(0, 10);
  }

  const maxFutureMs = now.getTime() + 36 * 3_600_000;
  if (parsedMs > maxFutureMs) {
    return { ok: false, reason: `postcheck_failed: As-of date "${cleaned}" is in the future` };
  }
  const ageDays = (now.getTime() - parsedMs) / 86_400_000;
  if (ageDays > maxPastDays) {
    return {
      ok: false,
      reason: `postcheck_failed: As-of date "${cleaned}" is older than ${maxPastDays} days`,
    };
  }
  return { ok: true, isoDate };
}

export function extractHeaderAsOfDate(markdown: string): string | null {
  const head = markdown.slice(0, 800);
  const m =
    head.match(/As of\s*\*{0,2}:?\*{0,2}\s*\*{0,2}([A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4}|\d{4}-\d{2}-\d{2})/i) ??
    head.match(/\bAs of\s+([^\n|*—–•]{4,32})/i);
  if (!m) return null;
  return m[1].replace(/\*+/g, "").trim();
}

export function validateWebStudyOutput(opts: {
  content: string;
  variant: string;
  sources: { title: string; url: string }[];
  asOfDate?: string | null;
  now?: Date;
  requireSources?: boolean;
}): PostcheckResult {
  const text = String(opts.content ?? "").trim();
  if (text.length < 80) {
    return { ok: false, reason: "postcheck_failed: study body is empty or truncated" };
  }
  if (/<script\b/i.test(text) || /\bjavascript:/i.test(text)) {
    return { ok: false, reason: "postcheck_failed: unsafe markup or script URI in study output" };
  }

  const headerAsOf = extractHeaderAsOfDate(text);
  if (!headerAsOf) {
    return { ok: false, reason: 'postcheck_failed: missing opening "As of [Month Day, Year]" line' };
  }
  const headerCheck = validateAsOfDate(headerAsOf, opts.now);
  if (!headerCheck.ok) return headerCheck;

  if (opts.asOfDate) {
    const metaCheck = validateAsOfDate(opts.asOfDate, opts.now);
    if (!metaCheck.ok) return metaCheck;
  }

  const tail = text.slice(-800);
  if (!/\bnot investment advice\b/i.test(tail)) {
    return { ok: false, reason: 'postcheck_failed: missing closing "Not investment advice" disclaimer' };
  }

  if (opts.requireSources !== false && (!Array.isArray(opts.sources) || opts.sources.length === 0)) {
    return { ok: false, reason: "postcheck_failed: web-research study recorded zero source URLs" };
  }

  const cited = extractInlineCitedUrls(text);
  return {
    ok: true,
    asOfIso: headerCheck.isoDate,
    inlineCitedCount: cited.size,
  };
}

export function extractSetupVerdict(markdown: string): "valid" | "invalid" | "insufficient" | "unknown" {
  const lower = markdown.toLowerCase();
  // Check explicit negative/insufficient verdicts first so "invalid setup" never matches "valid setup".
  if (
    /\binsufficient\s+(?:information|data)\b/.test(lower) ||
    /\bverdict\b[^\n]{0,60}\binsufficient\b/.test(lower)
  ) {
    return "insufficient";
  }
  if (
    /\binvalid\s+setup\b/.test(lower) ||
    /\bno\s+valid\s+setup\b/.test(lower) ||
    /\bsetup\s+is\s+(?:not\s+valid|invalid|not\s+active)\b/.test(lower) ||
    /\bmodel\s+is\s+not\s+active\b/.test(lower) ||
    /\bverdict\b[^\n]{0,60}\b(?:invalid|no\s+setup|not\s+met|failed)\b/.test(lower)
  ) {
    return "invalid";
  }
  if (
    /\bvalid\s+setup\b/.test(lower) ||
    /\bverdict\b[^\n]{0,60}\bvalid\b/.test(lower)
  ) {
    return "valid";
  }
  return "unknown";
}

function matchLabeledPrice(section: string, labelPattern: string): number | null {
  const patterns = [
    // Bullet or bold line: "- **Entry**: $185.40" or "Entry price: 185.40"
    new RegExp(
      String.raw`(?:^|[\n*|\s])\*?\*?${labelPattern}\*?\*?(?:\s*\([^)\n]{0,40}\))?\s*(?:[:—–-]|\|)\s*\*?\*?\$?\s*(\d{1,7}(?:\.\d{1,4})?)\b`,
      "im"
    ),
  ];
  for (const re of patterns) {
    const m = section.match(re);
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return null;
}

// Isolates the trade-plan portion when headings exist, or falls back to the
// text after Key Levels / Checklist so step-1 key-level descriptions aren't
// mistaken for an actionable trade plan.
function parseRawTradePlanLevels(markdown: string): { entry: number; stop: number; target: number } | null {
  const planHeaderMatch = markdown.match(/#{1,4}\s*[^\n]*\btrade\s+plan\b[^\n]*/i);
  const scope = planHeaderMatch && planHeaderMatch.index != null
    ? markdown.slice(planHeaderMatch.index)
    : markdown;

  const entry = matchLabeledPrice(scope, String.raw`entry(?:\s+(?:price|level|zone))?`);
  const stop = matchLabeledPrice(scope, String.raw`stop(?:\s*[- ]?loss|\s+(?:price|level))?`);
  const target = matchLabeledPrice(
    scope,
    String.raw`(?:target|take[- ]profit|profit\s+target)(?:\s+(?:price|level))?`
  );
  if (entry == null || stop == null || target == null) return null;
  return { entry, stop, target };
}

export function extractSetupPlan(markdown: string): ExtractedSetupPlan | null {
  if (extractSetupVerdict(markdown) !== "valid") return null;
  const raw = parseRawTradePlanLevels(markdown);
  if (!raw) return null;
  if (raw.stop < raw.entry && raw.entry < raw.target) {
    return { direction: "long", ...raw };
  }
  if (raw.target < raw.entry && raw.entry < raw.stop) {
    return { direction: "short", ...raw };
  }
  return null;
}

function addTimeVariants(allowed: Set<string>, formattedTimestamp: string) {
  const m = formattedTimestamp.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!m) return;
  const hh = Number(m[1]);
  const mm = m[2];
  const padded = `${String(hh).padStart(2, "0")}:${mm}`;
  const unpadded = `${hh}:${mm}`;
  allowed.add(padded);
  allowed.add(unpadded);
  if (hh > 12) {
    const h12 = hh - 12;
    allowed.add(`${h12}:${mm}`);
    allowed.add(`${String(h12).padStart(2, "0")}:${mm}`);
  }
}

export function validateOhlcStudyOutput(opts: {
  content: string;
  variant: "one_candle" | "davinci_model";
  candles: { t: string; o: number; h: number; l: number; c: number }[];
  openingRange?: { start: string; end: string; open: number; high: number; low: number; close: number } | null;
  asOfDate?: string | null;
  now?: Date;
}): PostcheckResult {
  const text = String(opts.content ?? "").trim();
  if (text.length < 80) {
    return { ok: false, reason: "postcheck_failed: setup study body is empty or truncated" };
  }
  if (/<script\b/i.test(text) || /\bjavascript:/i.test(text)) {
    return { ok: false, reason: "postcheck_failed: unsafe markup or script URI in study output" };
  }
  if (!Array.isArray(opts.candles) || opts.candles.length === 0) {
    return { ok: false, reason: "postcheck_failed: empty fetched candle series" };
  }

  const headerAsOf = extractHeaderAsOfDate(text);
  if (!headerAsOf) {
    return { ok: false, reason: 'postcheck_failed: missing opening "As of [Month Day, Year]" line' };
  }
  const headerCheck = validateAsOfDate(headerAsOf, opts.now);
  if (!headerCheck.ok) return headerCheck;
  if (opts.asOfDate) {
    const metaCheck = validateAsOfDate(opts.asOfDate, opts.now);
    if (!metaCheck.ok) return metaCheck;
  }

  // Variant-specific safety disclaimers (R2 / methodology.md:113,142).
  const tail = text.slice(-900);
  if (opts.variant === "one_candle") {
    if (
      !/educational framework analysis/i.test(tail) ||
      !/not a trade recommendation/i.test(tail)
    ) {
      return {
        ok: false,
        reason: "postcheck_failed: one_candle study is missing its required closing educational disclaimer",
      };
    }
  } else {
    if (
      !/not a verified trading edge/i.test(tail) ||
      !/not a trade recommendation/i.test(tail)
    ) {
      return {
        ok: false,
        reason: "postcheck_failed: davinci_model study is missing its required closing disclaimer",
      };
    }
    if (!/chart fanatics|trader-taught|taught framework|source trader/i.test(text)) {
      return {
        ok: false,
        reason: "postcheck_failed: davinci_model study is missing required source attribution framing",
      };
    }
  }

  // Candle timestamp grounding: every quoted HH:MM timestamp in the study must
  // belong to the fetched candle series (or the opening-range boundary).
  const allowedTimes = new Set<string>();
  for (const c of opts.candles) addTimeVariants(allowedTimes, c.t);
  if (opts.openingRange) {
    addTimeVariants(allowedTimes, opts.openingRange.start);
    addTimeVariants(allowedTimes, opts.openingRange.end);
  }

  const timeRe = /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g;
  let tm: RegExpExecArray | null;
  while ((tm = timeRe.exec(text)) !== null) {
    const full = tm[0];
    const after = text.slice(tm.index + full.length, tm.index + full.length + 24);
    const before = text.slice(Math.max(0, tm.index - 16), tm.index);
    // Exclude risk-to-reward ratios such as "1:10+" or "1:10 R:R".
    if (/^\+?(?:\s*(?:R\s*:\s*R|R\/R|risk|reward))/i.test(after) || /\bratio\s*$/i.test(before)) {
      continue;
    }
    if (!allowedTimes.has(full)) {
      return {
        ok: false,
        reason: `postcheck_failed: cited candle timestamp "${full}" is not present in fetched OHLC data`,
      };
    }
  }

  // Opening-range anchor check for one_candle.
  if (opts.variant === "one_candle" && opts.openingRange) {
    const numMatches = [...text.matchAll(/\b\d{1,6}\.\d{1,4}\b/g)].map((m) => Number(m[0]));
    const citesHigh = numMatches.some((n) => Math.abs(n - opts.openingRange!.high) <= 0.05);
    const citesLow = numMatches.some((n) => Math.abs(n - opts.openingRange!.low) <= 0.05);
    if (!citesHigh || !citesLow) {
      return {
        ok: false,
        reason:
          "postcheck_failed: one_candle study does not accurately state both fetched opening-range high and low",
      };
    }
  }

  const verdict = extractSetupVerdict(text);
  if (verdict === "unknown") {
    return {
      ok: false,
      reason: "postcheck_failed: setup study is missing an explicit verdict (valid / invalid / insufficient)",
    };
  }

  const rawLevels = parseRawTradePlanLevels(text);
  if (verdict !== "valid") {
    if (rawLevels !== null) {
      return {
        ok: false,
        reason: `postcheck_failed: actionable trade plan emitted despite ${verdict} setup verdict`,
      };
    }
    return {
      ok: true,
      asOfIso: headerCheck.isoDate,
      inlineCitedCount: 0,
      verdict,
      plan: null,
    };
  }

  if (!rawLevels) {
    return {
      ok: false,
      reason: "postcheck_failed: valid setup verdict is missing complete Entry/Stop/Target levels",
    };
  }

  const isLong = rawLevels.stop < rawLevels.entry && rawLevels.entry < rawLevels.target;
  const isShort = rawLevels.target < rawLevels.entry && rawLevels.entry < rawLevels.stop;
  if (!isLong && !isShort) {
    return {
      ok: false,
      reason: "postcheck_failed: trade plan Entry/Stop/Target levels have invalid directional ordering",
    };
  }

  const minLow = Math.min(...opts.candles.map((c) => c.l));
  const maxHigh = Math.max(...opts.candles.map((c) => c.h));
  const span = Math.max(maxHigh - minLow, maxHigh * 0.01);
  const loBound = minLow - span * 0.25;
  const hiBound = maxHigh + span * 0.25;
  if (
    rawLevels.entry < loBound ||
    rawLevels.entry > hiBound ||
    rawLevels.stop < loBound ||
    rawLevels.stop > hiBound
  ) {
    return {
      ok: false,
      reason: "postcheck_failed: trade plan entry or stop lies outside the fetched OHLC session bounds",
    };
  }

  if (opts.variant === "one_candle") {
    const risk = Math.abs(rawLevels.entry - rawLevels.stop);
    const reward = Math.abs(rawLevels.target - rawLevels.entry);
    const rr = risk > 0 ? reward / risk : 0;
    if (rr < 2.7 || rr > 3.3) {
      return {
        ok: false,
        reason: `postcheck_failed: one_candle target R:R (${rr.toFixed(2)}) violates fixed 3:1 rule`,
      };
    }
  }

  return {
    ok: true,
    asOfIso: headerCheck.isoDate,
    inlineCitedCount: 0,
    verdict: "valid",
    plan: {
      direction: isLong ? "long" : "short",
      ...rawLevels,
    },
  };
}

// Resolves a logged setup study trade plan (stocks.setup_study_plans) against
// subsequent daily bars, normalizing future bars to the signal-day split basis.
export function resolveSetupStudyPlan(
  plan: {
    sessionDate: string;
    direction: "long" | "short";
    entryPrice: number;
    stopPrice: number;
    targetPrice: number;
    horizonSessions: number;
  },
  bars: {
    dates: string[];
    highs: number[];
    lows: number[];
    closes: number[];
    adjCloses: number[];
  }
): { outcome: "target" | "stop" | "expired" | "ambiguous"; exitDate: string } | null {
  const start = bars.dates.indexOf(plan.sessionDate);
  if (start === -1) return null;
  const baseScale =
    bars.closes[start] > 0 && bars.adjCloses[start] > 0
      ? bars.closes[start] / bars.adjCloses[start]
      : 1;

  const lastIdx = Math.min(bars.dates.length - 1, start + plan.horizonSessions);
  for (let k = start + 1; k <= lastIdx; k++) {
    const dayScale =
      bars.closes[k] > 0 && bars.adjCloses[k] > 0
        ? (bars.adjCloses[k] / bars.closes[k]) * baseScale
        : 1;
    const high = bars.highs[k] * dayScale;
    const low = bars.lows[k] * dayScale;
    const hitTarget = plan.direction === "long" ? high >= plan.targetPrice : low <= plan.targetPrice;
    const hitStop = plan.direction === "long" ? low <= plan.stopPrice : high >= plan.stopPrice;
    if (hitTarget && hitStop) {
      return { outcome: "ambiguous", exitDate: bars.dates[k] };
    }
    if (hitStop) {
      return { outcome: "stop", exitDate: bars.dates[k] };
    }
    if (hitTarget) {
      return { outcome: "target", exitDate: bars.dates[k] };
    }
  }

  if (bars.dates.length - 1 >= start + plan.horizonSessions) {
    return { outcome: "expired", exitDate: bars.dates[start + plan.horizonSessions] };
  }
  return null;
}
