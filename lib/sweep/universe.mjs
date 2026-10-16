export const SECTORS = Object.freeze([
  "Communication Services", "Consumer Discretionary", "Consumer Staples", "Energy",
  "Financials", "Health Care", "Industrials", "Information Technology", "Materials",
  "Real Estate", "Utilities",
]);
// Both Alphabet share classes are retained; seven companies, eight symbols.
export const PINNED = Object.freeze(["AAPL", "AMZN", "GOOG", "GOOGL", "META", "MSFT", "NVDA", "TSLA"]);
export function buildUniverse(source) {
  if (!source || !source.provenance || !/^\d{4}-\d{2}-\d{2}$/.test(source.asOf) ||
      !Array.isArray(source.rows)) throw new Error("SOURCE_METADATA_REQUIRED");
  const seen = new Set(), ranked = [];
  let dates;
  for (const row of source.rows) {
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(row.ticker) || seen.has(row.ticker) ||
        !SECTORS.includes(row.sector) || !Array.isArray(row.sessions) || row.sessions.length !== 30) {
      throw new Error("INVALID_UNIVERSE_ROW:" + row.ticker);
    }
    seen.add(row.ticker);
    for (let i = 0; i < row.sessions.length; i++) {
      const b = row.sessions[i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || b.date >= source.asOf ||
          !Number.isFinite(b.close) || b.close <= 0 || !Number.isFinite(b.volume) || b.volume < 0 ||
          !Number.isFinite(b.close * b.volume) || (i && b.date <= row.sessions[i - 1].date)) {
        throw new Error("INVALID_RANKING_SESSION:" + row.ticker);
      }
    }
    const rowDates = row.sessions.map(b => b.date).join(",");
    if (dates && dates !== rowDates) throw new Error("RANKING_SESSION_MISMATCH");
    dates = rowDates;
    const averageDollarVolume = row.sessions.reduce((s, b) => s + b.close * b.volume / 30, 0);
    if (!Number.isFinite(averageDollarVolume)) throw new Error("INVALID_DOLLAR_VOLUME");
    ranked.push({ ticker: row.ticker, sector: row.sector, averageDollarVolume });
  }
  for (const ticker of PINNED) if (!seen.has(ticker)) throw new Error("MISSING_PIN:" + ticker);
  const compare = (a, b) => b.averageDollarVolume - a.averageDollarVolume ||
    (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);
  const selected = new Map();
  for (const sector of SECTORS) {
    const rows = ranked.filter(r => r.sector === sector).sort(compare);
    if (rows.length < 10) throw new Error("INSUFFICIENT_SECTOR:" + sector);
    rows.slice(0, 10).forEach((r, i) => selected.set(r.ticker, { ...r, sectorRank: i + 1, pinned: PINNED.includes(r.ticker) }));
  }
  for (const ticker of PINNED) {
    if (!selected.has(ticker)) selected.set(ticker, { ...ranked.find(r => r.ticker === ticker), sectorRank: null, pinned: true });
  }
  const constituents = [...selected.values()].sort((a, b) => a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);
  return {
    status: "READY", asOf: source.asOf, provenance: source.provenance,
    ranking: "mean(close * volume), 30 identical completed trading sessions, top 10 per GICS sector",
    inputCount: source.rows.length, sessions: dates.split(","),
    tickers: constituents.map(r => r.ticker), constituents,
  };
}
