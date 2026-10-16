import test from "node:test";
import assert from "node:assert/strict";
import {
  contractMetrics,
  sortContracts,
  filterContracts,
  DEFAULT_FILTERS,
} from "../lib/leaps-discovery";
import type { ChainOption } from "../lib/leaps-chain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ContractComparison from "../components/leaps/ContractComparison";

const call: ChainOption = {
  symbol: "TEST281020C00100000",
  type: "call",
  strike: 100,
  expiration: "2028-10-20",
  days: 735,
  bid: 10,
  ask: 12,
  iv: 30,
  delta: 0.7,
  volume: 5,
  openInterest: 100,
};

test("comparison costs, spreads and call/put expiration breakevens use the ask, whole lot and total fees", () => {
  const m = contractMetrics(call, 2, 8);
  assert.equal(m.premiumCost, 2400);
  assert.equal(m.totalCost, 2408);
  assert.equal(m.spread, 2);
  assert.equal(m.spreadPct, (2 / 11) * 100);
  assert.ok(Math.abs(m.breakeven! - 112.04) < 1e-10);
  assert.ok(
    Math.abs(
      contractMetrics({ ...call, type: "put" }, 2, 8).breakeven! - 87.96,
    ) < 1e-10,
  );
  assert.equal(
    filterContracts([call], {
      ...DEFAULT_FILTERS,
      contracts: "2",
      fees: "8",
      budget: "2407.99",
    }).rows.length,
    0,
  );
  assert.equal(
    filterContracts([call], {
      ...DEFAULT_FILTERS,
      contracts: "2",
      fees: "8",
      budget: "2408",
    }).rows.length,
    1,
  );
  assert.ok(filterContracts([call], { ...DEFAULT_FILTERS, fees: "-1" }).error);
});

test("unknown and crossed quotes never turn into cheap costs or narrow spreads", () => {
  for (const fields of [
    { ask: null },
    { bid: 13 },
    { ask: 0, bid: 0 },
    { ask: Infinity },
    { ask: 1e308 },
  ]) {
    const m = contractMetrics({ ...call, ...fields }, 2, 0);
    assert.equal(m.totalCost, null);
    assert.equal(m.breakeven, null);
  }
  assert.equal(contractMetrics({ ...call, bid: null }, 2, 0).spreadPct, null);
  assert.equal(contractMetrics({ ...call, bid: 13 }, 2, 0).spreadPct, null);
  assert.equal(contractMetrics({ ...call, bid: 0 }, 2, 0).spreadPct, 200);
  for (const contracts of [0, 1.5, NaN, 10001])
    assert.equal(contractMetrics(call, contracts, 0).totalCost, null);
  for (const fees of [-1, NaN, Infinity])
    assert.equal(contractMetrics(call, 1, fees).totalCost, null);
  assert.equal(
    filterContracts([{ ...call, bid: 13 }], {
      ...DEFAULT_FILTERS,
      maxSpread: "10",
    }).rows.length,
    0,
  );
});

test("sorts put unavailable data last in both directions, preserve input order and resolve ties consistently", () => {
  const unknown = {
    ...call,
    symbol: "unknown",
    ask: null,
    bid: null,
    delta: null,
    openInterest: null,
  };
  const liquidPut = {
    ...call,
    symbol: "put",
    type: "put" as const,
    ask: 8,
    bid: 7.9,
    delta: -0.8,
    openInterest: 200,
  };
  const input = [unknown, call, liquidPut],
    before = input.map((o) => o.symbol);
  for (const sort of ["cost", "spread", "delta", "openInterest"] as const)
    assert.deepEqual(
      sortContracts(input, sort, 1, 0).map((o) => o.symbol),
      ["put", call.symbol, "unknown"],
    );
  assert.deepEqual(
    input.map((o) => o.symbol),
    before,
  );
  const early = { ...call, symbol: "early", expiration: "2027-10-20" };
  assert.equal(
    sortContracts([call, early], "expiration", 1, 0)[0].symbol,
    "early",
  );
  assert.equal(sortContracts([call, early], "cost", 1, 0)[0].symbol, "early");
  assert.deepEqual(sortContracts([], "cost", 1, 0), []);
});

test("comparison renders missing values and out-of-filter selections without implying a fill", () => {
  const html = renderToStaticMarkup(
    createElement(ContractComparison, {
      options: [call, { ...call, symbol: "missing", bid: null, ask: null }],
      contracts: 2,
      fees: 8,
      visibleSymbols: new Set([call.symbol]),
      onRemove() {},
      onClear() {},
      onUse() {},
    }),
  );
  assert.match(html, /\$2,408\.00/);
  assert.match(html, /Unavailable/);
  assert.match(html, /Outside current filters/);
  assert.match(html, /scope="col"/);
  assert.match(html, /aria-label="Remove missing from comparison"/);
  assert.match(html, /not an early-exit breakeven or a fill/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});
