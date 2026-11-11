import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { exchangeTime, fetchDailyBars, fetchMovers, fetchOpeningCandle, resetYahooCooldown } from "../lib/marketdata";
import { getGexSnapshot } from "../lib/gex";
import { getLeapsChain } from "../lib/leaps-chain";

const KEYS = ["MASSIVE_API_KEY", "TIINGO_API_KEY", "TWELVE_DATA_API_KEY", "FINNHUB_API_KEY", "ALPACA_KEY_ID", "ALPACA_SECRET_KEY", "MARKET_DATA_PROVIDERS"];
afterEach(() => {
  for (const k of KEYS) delete process.env[k];
  resetYahooCooldown();
});

type Call = { url: string; headers: Record<string, string> };
function mockFetch(t: any, respond: (url: URL) => Response) {
  const calls: Call[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return respond(url);
  });
  return calls;
}
const yahoo429 = (u: URL) => (u.hostname.endsWith("yahoo.com") ? new Response("", { status: 429 }) : null);

test("Massive serves daily bars when Yahoo refuses, with the key in a header only", async (t) => {
  process.env.MASSIVE_API_KEY = "mk-secret";
  const midnightNY = (d: string) => Date.parse(`${d}T04:00:00Z`);
  const calls = mockFetch(t, (u) => yahoo429(u) ?? Response.json({
    results: [
      { t: midnightNY("2026-11-05"), o: 1, h: 2, l: 1, c: 2, v: 10 },
      { t: midnightNY("2026-11-06"), o: 2, h: 3, l: 2, c: 3, v: 20 },
    ],
  }));
  const bars = await fetchDailyBars("BRK-B", "1mo", 0);
  assert.equal(bars.source, "massive");
  assert.deepEqual(bars.dates, ["2026-11-05", "2026-11-06"]);
  assert.deepEqual(bars.closes, [2, 3]);
  const massive = calls.filter((c) => c.url.includes("api.massive.com"));
  assert.ok(massive[0].url.includes("/v2/aggs/ticker/BRK.B/range/1/day/"));
  assert.equal(massive[0].headers.authorization, "Bearer mk-secret");
  assert.ok(!calls.some((c) => c.url.includes("mk-secret")));
});

test("a rate-limited provider is skipped for the next one, then cooled down", async (t) => {
  process.env.MASSIVE_API_KEY = "m";
  process.env.TIINGO_API_KEY = "tk";
  const calls = mockFetch(t, (u) => {
    const y = yahoo429(u);
    if (y) return y;
    if (u.hostname === "api.massive.com") return new Response("", { status: 429 });
    return Response.json([
      { date: "2026-11-05T00:00:00.000Z", open: 1, high: 2, low: 1, close: 2, volume: 10, adjClose: 1.9 },
      { date: "2026-11-06T00:00:00.000Z", open: 2, high: 3, low: 2, close: 3, volume: 20, adjClose: 2.95 },
    ]);
  });
  const first = await fetchDailyBars("SPY", "1mo", 0);
  assert.equal(first.source, "tiingo");
  assert.deepEqual(first.adjCloses, [1.9, 2.95]);
  assert.equal(calls.find((c) => c.url.includes("tiingo"))!.headers.authorization, "Token tk");
  calls.length = 0;
  await fetchDailyBars("QQQ", "1mo", 0);
  // Yahoo and Massive are both cooling down: straight to Tiingo.
  assert.deepEqual(calls.map((c) => new URL(c.url).hostname), ["api.tiingo.com"]);
});

test("MARKET_DATA_PROVIDERS sets the order; Twelve Data intraday bars are read in New York time", async (t) => {
  process.env.MASSIVE_API_KEY = "m";
  process.env.TWELVE_DATA_API_KEY = "td";
  process.env.MARKET_DATA_PROVIDERS = "twelvedata, massive";
  const date = "2026-09-24";
  const calls = mockFetch(t, (u) => yahoo429(u) ?? Response.json({
    status: "ok",
    values: ["09:25", "09:30", "09:31", "09:32", "09:33", "09:34"].map((hm) => ({
      datetime: `${date} ${hm}:00`, open: "10", high: "12", low: "9", close: "11", volume: "100",
    })),
  }));
  const data = await fetchOpeningCandle("NOVA", date);
  assert.equal(data.first_five_minute_candle.volume, 500);
  assert.equal(new Date(exchangeTime(date, 9, 30, "America/New_York") * 1000).toISOString(), "2026-09-24T13:30:00.000Z");
  assert.ok(calls.some((c) => c.url.includes("api.twelvedata.com/time_series") && c.headers.authorization === "apikey td"));
  assert.ok(!calls.some((c) => c.url.includes("massive")));
});

test("Twelve Data errors reported in a 200 body move on to the next provider", async (t) => {
  process.env.TWELVE_DATA_API_KEY = "td";
  process.env.FINNHUB_API_KEY = "fh";
  process.env.MARKET_DATA_PROVIDERS = "twelvedata,finnhub";
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
  const calls = mockFetch(t, (u) => {
    const y = yahoo429(u);
    if (y) return y;
    if (u.hostname === "api.twelvedata.com") return Response.json({ status: "error", code: 429, message: "out of credits" });
    return Response.json({ s: "ok", t: [day("2026-11-05"), day("2026-11-06")], o: [1, 2], h: [2, 3], l: [1, 2], c: [2, 3], v: [5, 6] });
  });
  const bars = await fetchDailyBars("KSTL", "1mo", 0);
  assert.equal(bars.source, "finnhub");
  assert.deepEqual(bars.dates, ["2026-11-05", "2026-11-06"]);
  assert.equal(calls.find((c) => c.url.includes("finnhub"))!.headers["x-finnhub-token"], "fh");
});

test("movers come from Massive when Yahoo's screeners refuse", async (t) => {
  process.env.MASSIVE_API_KEY = "m";
  mockFetch(t, (u) => yahoo429(u) ?? Response.json({
    tickers: u.pathname.endsWith("gainers")
      ? [{ ticker: "ORBT", todaysChangePerc: 12.345, day: { c: 5, v: 1e6 }, lastTrade: { p: 5.1 } }]
      : [{ ticker: "LMNR", todaysChangePerc: -8.2, day: { c: 3, v: 2e5 } }],
  }));
  const movers = await fetchMovers(5);
  assert.equal(movers.gainers[0].symbol, "ORBT");
  assert.equal(movers.gainers[0].change_pct, 12.35);
  assert.equal(movers.gainers[0].price, 5.1);
  assert.equal(movers.losers[0].price, 3);
  assert.match(movers.note, /Massive/);
});

test("with no provider keys Yahoo errors surface unchanged", async (t) => {
  mockFetch(t, () => new Response("", { status: 429 }));
  await assert.rejects(fetchDailyBars("SPY", "1mo", 0), /Yahoo chart API returned 429/);
});

const exp = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return { iso: d.toISOString().slice(0, 10), occ: d.toISOString().slice(2, 10).replace(/-/g, "") };
};

test("gamma exposure falls back to Massive's chain when CBOE fails", async (t) => {
  process.env.MASSIVE_API_KEY = "m";
  const e = exp(30);
  const calls = mockFetch(t, (u) => {
    if (u.hostname === "cdn.cboe.com") return new Response("", { status: 502 });
    if (u.pathname.endsWith("/prev")) return Response.json({ results: [{ c: 100 }] });
    return Response.json({
      results: [
        { details: { ticker: `O:NOVA${e.occ}C00105000` }, implied_volatility: 0.3, open_interest: 1000, greeks: { delta: 0.4, gamma: 0.05 }, last_quote: { bid: 1, ask: 1.1, last_updated: 1_762_000_000_000_000_000 }, day: { volume: 50 }, underlying_asset: { price: 101 } },
        { details: { ticker: `O:NOVA${e.occ}P00095000` }, implied_volatility: 0.35, open_interest: 800, greeks: { delta: -0.3, gamma: 0.04 }, last_quote: { bid: 0.9, ask: 1 }, day: { volume: 40 } },
      ],
    });
  });
  const snap = await getGexSnapshot("NOVA");
  assert.ok(snap);
  assert.equal(snap.source, "Massive options snapshot");
  assert.equal(snap.spot, 101);
  assert.equal(snap.contracts, 2);
  assert.equal(snap.sourceAt, new Date(1_762_000_000_000).toISOString());
  const chainUrl = new URL(calls.find((c) => c.url.includes("/v3/snapshot/options/NOVA"))!.url);
  assert.equal(chainUrl.searchParams.get("strike_price.gte"), "75");
  assert.equal(chainUrl.searchParams.get("strike_price.lte"), "125");
});

test("LEAPS chain falls back to Finnhub when CBOE is unreachable", async (t) => {
  process.env.FINNHUB_API_KEY = "fh";
  const e = exp(500);
  mockFetch(t, (u) => {
    if (u.hostname === "cdn.cboe.com") throw new TypeError("fetch failed");
    return Response.json({
      lastTradePrice: 50,
      data: [{
        expirationDate: e.iso,
        options: {
          CALL: [{ contractName: `KSTL${e.occ}C00055000`, strike: 55, bid: 4, ask: 4.5, impliedVolatility: 42, delta: 0.5, openInterest: 120, volume: 3 }],
          PUT: [{ contractName: `KSTL${e.occ}P00200000`, strike: 200, bid: 1, ask: 2, impliedVolatility: 0.4 }],
        },
      }],
    });
  });
  const chain = await getLeapsChain("KSTL");
  assert.ok(chain);
  assert.equal(chain.source, "Finnhub options chain");
  assert.equal(chain.options.length, 1); // the 200 strike is outside 50%-150% of spot
  assert.equal(chain.options[0].iv, 42); // percent, normalized from Finnhub's 42
  assert.equal(chain.sourceAt, null);
});
