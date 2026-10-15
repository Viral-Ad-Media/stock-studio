"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DEFAULT_LEAPS,
  leapsAnalysis,
  validateLeaps,
  type LeapsInput,
} from "@/lib/leaps";
import type { ChainOption, LeapsChain } from "@/lib/leaps-chain";
import LeapsCharts from "@/components/charts/LeapsCharts";
import SensitivityExplorer from "./SensitivityExplorer";
import PageHeader from "@/components/ui/PageHeader";
import DataStamp from "@/components/insights/DataStamp";
import { apiError } from "@/lib/shared";
const money = (v: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(v);
type Plan = { id: string; name: string; ticker: string; inputs: LeapsInput };
const LABELS: Record<keyof LeapsInput, string> = {
  ticker: "Ticker",
  type: "Option type",
  spot: "Underlying price ($)",
  strike: "Strike ($)",
  expiration: "Expiration date",
  as_of: "Valuation date",
  premium: "Entry premium per share ($)",
  contracts: "Standard contracts (100 shares each)",
  iv: "Current IV (%)",
  rate: "Annual risk-free rate assumption (%)",
  dividend: "Annual dividend yield assumption (%)",
  exit_days: "Days until modeled exit",
  scenario_move: "Underlying move at exit (%)",
  scenario_iv: "IV at modeled exit (%)",
  fees: "Total entry + exit fees ($)",
};
export default function LeapsClient({
  today,
  initialTicker,
  plans,
  savedUnavailable,
  archived,
}: {
  today: string;
  initialTicker: string;
  plans: Plan[];
  savedUnavailable: boolean;
  archived: boolean;
}) {
  const router = useRouter();
  const expiration = new Date(Date.parse(today) + 730 * 86400000)
    .toISOString()
    .slice(0, 10);
  const [form, setForm] = useState<Record<keyof LeapsInput, string>>(
    () =>
      Object.fromEntries(
        Object.entries({
          ...DEFAULT_LEAPS,
          as_of: today,
          expiration,
          ticker: /^[A-Za-z][A-Za-z0-9.\-]{0,11}$/.test(initialTicker)
            ? initialTicker.toUpperCase()
            : "",
        }).map(([k, v]) => [k, String(v)]),
      ) as Record<keyof LeapsInput, string>,
  );
  const [chain, setChain] = useState<LeapsChain | null>(null),
    [chainTicker, setChainTicker] = useState(initialTicker),
    [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [name, setName] = useState("");
  const computed = useMemo(() => {
    try {
      const input = validateLeaps(form);
      return { input, result: leapsAnalysis(input), error: "" };
    } catch (e) {
      return {
        input: null,
        result: null,
        error: e instanceof Error ? e.message : "Invalid inputs",
      };
    }
  }, [form]);
  function update(key: keyof LeapsInput, v: string) {
    setForm((f) => ({ ...f, [key]: v }));
  }
  async function loadChain(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setChain(null);
    try {
      const res = await fetch(
        `/api/leaps?symbol=${encodeURIComponent(chainTicker.trim())}`,
      );
      if (!res.ok) throw new Error(await apiError(res, "Options unavailable"));
      const { chain: c } = await res.json();
      setChain(c);
      setExpiry(c?.options[0]?.expiration ?? "");
      if (!c || !c.options.length)
        setNotice(
          "No supported long-dated contracts returned. Continue with manual assumptions below.",
        );
      else setNotice("Delayed chain loaded. Quotes are not execution prices.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load options.");
    } finally {
      setBusy(false);
    }
  }
  function useOption(o: ChainOption) {
    if (!chain) return;
    setForm((f) => ({
      ...f,
      ticker: chain.symbol,
      type: o.type,
      spot: String(chain.spot),
      strike: String(o.strike),
      expiration: o.expiration,
      as_of: today,
      premium: o.ask != null && o.ask > 0 ? String(o.ask) : f.premium,
      iv: o.iv != null ? String(o.iv) : f.iv,
      scenario_iv: o.iv != null ? String(o.iv) : f.scenario_iv,
      exit_days: String(Math.min(Number(f.exit_days) || 30, o.days)),
    }));
    setNotice(
      "Contract details copied. Ask is a delayed quote, not a fill. Review all assumptions and fees before saving.",
    );
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!computed.input) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/leaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, inputs: computed.input }),
      });
      if (!res.ok)
        throw new Error(await apiError(res, "Couldn't save scenario"));
      setNotice(
        "Scenario saved. This does not record a trade or place an order.",
      );
      setName("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save scenario");
    } finally {
      setBusy(false);
    }
  }
  async function archive(p: Plan) {
    setBusy(true);
    try {
      const res = await fetch("/api/leaps", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, archived: !archived }),
      });
      if (!res.ok)
        throw new Error(await apiError(res, "Couldn't change scenario"));
      router.refresh();
      setNotice(
        archived
          ? "Scenario restored."
          : "Scenario archived; restore it from Archived.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change scenario");
    } finally {
      setBusy(false);
    }
  }
  const result = computed.result;
  const options =
    chain?.options.filter(
      (o) => o.expiration === expiry && o.type === form.type,
    ) ?? [];
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Your trading desk / Options lab"
        title="LEAPS workspace"
        description="Explore long-dated purchased calls and puts, then compare a shorter holding period with the time remaining on the contract. Educational scenarios, not recommended contracts or trade calls."
      />
      {error && (
        <p
          role="alert"
          className="rounded border border-red-500/40 p-3 text-sm text-red-400"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-400">
          {notice}
        </p>
      )}
      <section className="card p-5">
        <h2 className="font-semibold">Delayed long-dated options</h2>
        <p className="mt-2 text-xs text-fg-subtle">
          CBOE chain · At least 365 days remaining, strikes within 50% of the
          underlying, standard symbol roots only. Up to 500 contracts sampled
          across expirations and types, with strikes nearest the underlying;
          this is not a recommended-contract ranking. Load on demand; no
          automatic quote polling.
        </p>
        <form onSubmit={loadChain} className="mt-3 flex flex-wrap gap-2">
          <label>
            <span className="sr-only">Options chain ticker</span>
            <input
              className="input font-mono"
              value={chainTicker}
              maxLength={12}
              placeholder="Stock / ETF ticker"
              onChange={(e) => setChainTicker(e.target.value.toUpperCase())}
            />
          </label>
          <button
            disabled={busy || !chainTicker.trim()}
            className="btn-secondary px-4 py-2 text-sm"
          >
            {busy ? "Loading…" : "Load delayed chain"}
          </button>
        </form>
        {chain && (
          <>
            <DataStamp
              source="CBOE options chain (about 15-minute delay; open interest updates daily)"
              sourceAt={chain.sourceAt}
              fetchedAt={chain.fetchedAt}
              delayed
            />
            <p className="mt-2 text-sm">
              {chain.symbol} underlying: {money(chain.spot)} · Treat quoted
              prices as delayed. Showing {chain.options.length} of{" "}
              {chain.totalMatches} matching contracts.
            </p>
            {chain.options.length > 0 && (
              <>
                <label className="mt-4 block">
                  <span className="field-label">Compare expiration</span>
                  <select
                    className="input"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                  >
                    {[...new Set(chain.options.map((o) => o.expiration))].map(
                      (d) => (
                        <option key={d}>{d}</option>
                      ),
                    )}
                  </select>
                </label>
                <p className="mt-2 text-xs text-fg-subtle">
                  Use the option-type field below to switch between calls and
                  puts. Spreads describe quoted liquidity, not your likely fill.
                </p>
                <div className="mt-3 max-h-80 overflow-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <caption className="sr-only">
                      Delayed long-dated options for selected expiry and type
                    </caption>
                    <thead>
                      <tr>
                        <th>Strike</th>
                        <th>Bid / ask</th>
                        <th>Spread</th>
                        <th>IV</th>
                        <th>Volume / OI</th>
                        <th>Scenario</th>
                      </tr>
                    </thead>
                    <tbody>
                      {options.map((o) => (
                        <tr key={o.symbol} className="border-t border-ink-700">
                          <td className="py-2">{o.strike}</td>
                          <td>
                            {o.bid ?? "—"} / {o.ask ?? "—"}
                          </td>
                          <td>
                            {o.ask != null && o.bid != null
                              ? money(o.ask - o.bid)
                              : "Unavailable"}
                          </td>
                          <td>{o.iv?.toFixed(1) ?? "—"}%</td>
                          <td>
                            {o.volume ?? "—"} / {o.openInterest ?? "—"}
                          </td>
                          <td>
                            <button
                              onClick={() => useOption(o)}
                              className="text-emerald-400 underline"
                            >
                              Use inputs
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </section>
      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Scenario assumptions</h2>
        <p className="mb-4 text-xs text-fg-subtle">
          Defaults are illustrative, not market observations. Enter your own
          values or copy a delayed contract. Rates, dividend yield and future
          volatility remain your assumptions.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(LABELS) as (keyof LeapsInput)[]).map((k) => (
            <label key={k}>
              <span className="field-label">{LABELS[k]}</span>
              {k === "type" ? (
                <select
                  className="input w-full"
                  value={form[k]}
                  onChange={(e) => update(k, e.target.value)}
                >
                  <option value="call">Purchased call</option>
                  <option value="put">Purchased put</option>
                </select>
              ) : (
                <input
                  className="input w-full"
                  type={
                    k === "ticker"
                      ? "text"
                      : k === "as_of" || k === "expiration"
                        ? "date"
                        : "number"
                  }
                  step={k === "contracts" || k === "exit_days" ? "1" : "any"}
                  value={form[k]}
                  maxLength={k === "ticker" ? 12 : undefined}
                  onChange={(e) =>
                    update(
                      k,
                      k === "ticker"
                        ? e.target.value.toUpperCase()
                        : e.target.value,
                    )
                  }
                />
              )}
            </label>
          ))}
        </div>
        {computed.error && (
          <p className="mt-3 text-sm text-fg-subtle" role="status">
            {computed.error}
          </p>
        )}
      </section>
      {result && (
        <>
          <section className="card p-5">
            <h2 className="font-semibold">Hypothetical early exit</h2>
            <p className="mt-1 text-xs text-fg-subtle">
              {result.days} days to expiration at valuation;{" "}
              {result.days - Number(form.exit_days)} days remain at modeled
              exit.
              {result.days < 365 &&
                " This is a shorter-dated comparison, not a contract with at least one year remaining."}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[
                ["Premium + fees at risk", money(result.cost)],
                ["Theoretical price now", money(result.current.price)],
                ["Theoretical price at exit", money(result.scenario.price)],
                ["Modeled net P&L at exit", money(result.scenarioPnl)],
              ].map(([label, value]) => (
                <div key={label} className="metric-tile">
                  <p className="text-xs text-fg-subtle">{label}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {value}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-fg-subtle">
              Expiration breakeven including entered fees:{" "}
              {money(result.expiryBreakeven)}
              {result.expiryBreakeven < 0 &&
                " (not achievable at a nonnegative underlying price)"}
              . This is not the breakeven before expiration. Intrinsic value
              now: {money(result.intrinsic)}. Model/entered-premium difference:{" "}
              {money(result.current.price - Number(form.premium))} per share.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Delta", result.current.delta],
                ["Gamma", result.current.gamma],
                ["Theta / day", result.current.theta],
                ["Vega / IV point", result.current.vega],
              ].map(([label, v]) => (
                <div key={String(label)}>
                  <p className="text-xs text-fg-subtle">{label}</p>
                  <p className="font-mono text-sm">
                    {v == null ? "—" : Number(v).toFixed(4)}
                  </p>
                </div>
              ))}
            </div>
          </section>
          <LeapsCharts input={computed.input!} />
          <SensitivityExplorer input={computed.input!} />
          <section className="card p-5">
            <h2 className="mb-3 font-semibold">
              Price scenarios at the modeled exit
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="mb-2 text-left text-xs text-fg-subtle">
                  Same exit day and exit IV; only the underlying price changes.
                  Returns are hypothetical.
                </caption>
                <thead>
                  <tr>
                    <th>Underlying move</th>
                    <th>Underlying price</th>
                    <th>Option model price</th>
                    <th>Net P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {result.grid.map((r) => (
                    <tr key={r.move} className="border-t border-ink-700">
                      <td className="py-2">
                        {r.move > 0 ? "+" : ""}
                        {r.move}%
                      </td>
                      <td>{money(Number(form.spot) * (1 + r.move / 100))}</td>
                      <td>{money(r.price)}</td>
                      <td>{money(r.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card p-5">
              <h2 className="mb-3 font-semibold">
                Time decay with unchanged price and IV
              </h2>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>Days elapsed</th>
                    <th>Model price</th>
                  </tr>
                </thead>
                <tbody>
                  {result.time.map((r) => (
                    <tr key={r.elapsed} className="border-t border-ink-700">
                      <td className="py-2">{r.elapsed}</td>
                      <td>{money(r.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="card p-5">
              <h2 className="mb-3 font-semibold">Compare time to expiration</h2>
              <p className="mb-2 text-xs text-fg-subtle">
                Hypothetical 6, 12 and 24-month terms, with the same price,
                strike and IV. These are model values, not listed contracts.
              </p>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>Days left</th>
                    <th>Model price</th>
                    <th>Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {result.comparison.map((r) => (
                    <tr key={r.days} className="border-t border-ink-700">
                      <td className="py-2">{r.days}</td>
                      <td>{money(r.price)}</td>
                      <td>{r.delta?.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
          <form onSubmit={save} className="card p-5">
            <h2 className="mb-3 font-semibold">Save this scenario</h2>
            <div className="flex flex-wrap gap-2">
              <label>
                <span className="sr-only">Scenario name</span>
                <input
                  className="input"
                  required
                  maxLength={100}
                  placeholder="Scenario name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button
                disabled={busy || savedUnavailable}
                className="btn-primary px-4 py-2 text-sm"
              >
                Save scenario
              </button>
              <Link
                href={`/journal?ticker=${encodeURIComponent(form.ticker)}`}
                className="btn-secondary px-4 py-2 text-sm"
              >
                Log an actual trade
              </Link>
            </div>
            <p className="mt-2 text-xs text-fg-subtle">
              Saving a scenario records assumptions only. The journal requires
              your actual entry and exit prices.
            </p>
          </form>
        </>
      )}
      <section className="card p-5">
        <div className="flex justify-between gap-3">
          <h2 className="font-semibold">
            {archived ? "Archived scenarios" : "Saved scenarios"}
          </h2>
          <Link
            href={archived ? "/leaps" : "/leaps?archived=1"}
            className="text-xs text-emerald-400 underline"
          >
            {archived ? "Active" : "Archived"}
          </Link>
        </div>
        {savedUnavailable ? (
          <p className="mt-3 text-sm text-fg-subtle">
            Saved scenarios are unavailable right now. Manual modeling is still
            available.
          </p>
        ) : !plans.length ? (
          <p className="mt-3 text-sm text-fg-subtle">
            No saved scenarios in this view.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-700">
            {plans.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap justify-between gap-3 py-3"
              >
                <span>
                  {p.name} · {p.ticker}
                </span>
                <div className="flex gap-3 text-xs">
                  <button
                    className="text-emerald-400 underline"
                    onClick={() => {
                      setForm(
                        Object.fromEntries(
                          Object.entries(p.inputs).map(([k, v]) => [
                            k,
                            String(v),
                          ]),
                        ) as Record<keyof LeapsInput, string>,
                      );
                      setNotice(
                        "Saved assumptions loaded; dates and premiums have not been refreshed.",
                      );
                    }}
                  >
                    Load assumptions
                  </button>
                  <button
                    disabled={busy}
                    className="underline"
                    onClick={() => void archive(p)}
                  >
                    {archived ? "Restore" : "Archive"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card p-5">
        <h2 className="font-semibold">How to interpret the model</h2>
        <p className="mt-2 text-sm text-fg-subtle">
          European Black-Scholes with continuous dividend yield, constant
          volatility and interest rate. Equity options may allow early exercise,
          which this model does not capture. Discrete dividends, volatility
          skew, assignment, taxes and execution slippage are not modeled. Enter
          total fees yourself. Greeks are per share; theta is per day and vega
          per one percentage-point change in IV. A theoretical value is not a
          quote, fill or forecast. Purchased options can lose the entire
          premium.
        </p>
        <p className="mt-3 text-xs">
          <a
            className="text-emerald-400 underline"
            href="https://www.optionseducation.org/advancedconcepts/black-scholes-formula"
            target="_blank"
            rel="noopener noreferrer"
          >
            OIC: model assumptions
          </a>{" "}
          ·{" "}
          <a
            className="text-emerald-400 underline"
            href="https://www.optionseducation.org/optionsoverview/leaps-pricing"
            target="_blank"
            rel="noopener noreferrer"
          >
            OIC: LEAPS pricing
          </a>
        </p>
      </section>
    </div>
  );
}
