import assert from "node:assert/strict";
import test from "node:test";
import { journalPlot, leapsPlots, plotDomain } from "../lib/chart-data";
import { DEFAULT_LEAPS, leapsAnalysis, optionModel } from "../lib/leaps";

test("journal preserves actual dates and finite plot domains for empty, flat and single-point records", () => {
  const points = journalPlot([{date:"2026-01-01",pnl:0},{date:"2026-01-11",pnl:-100}]);
  assert.equal(points[1].x-points[0].x, 10*86400000);
  assert.equal(points.length,2);
  for (const dataset of [[], [points[0]], points]) {
    const d=plotDomain(dataset);
    assert.ok(Object.values(d).every(Number.isFinite));
    assert.ok(d.xMax>d.xMin && d.yMax>d.yMin);
    assert.ok(d.yMin<=0 && d.yMax>=0);
  }
});

test("payoff curves match entered lot fees and model at the exact selected scenario", () => {
  for (const type of ["call","put"] as const) {
    const i={...DEFAULT_LEAPS,ticker:"SPY",as_of:"2026-01-01",expiration:"2028-01-01",type,contracts:3,fees:12,scenario_move:-13,exit_days:49};
    const {payoff,decay}=leapsPlots(i), analysis=leapsAnalysis(i);
    const spot=i.spot*(1+i.scenario_move/100);
    assert.equal(payoff.find(p=>p.x===spot)!.values[0],analysis.scenarioPnl);
    for (const p of payoff) {
      const intrinsic=Math.max(0,type==="call"?p.x-i.strike:i.strike-p.x);
      assert.equal(p.values[1], intrinsic*300-analysis.cost);
      assert.ok(p.values.every(v=>v>=-analysis.cost));
    }
    assert.equal(decay[0].values[0],analysis.current.price);
    assert.equal(decay.at(-1)!.x,analysis.days);
    assert.equal(decay.at(-1)!.values[0],analysis.intrinsic);
    assert.equal(decay.find(p=>p.x===49)!.values[0],optionModel(type,i.spot,i.strike,analysis.days-49,i.iv,i.rate,i.dividend).price);
  }
});

test("expiry exit curves coincide and extreme valid scenarios remain finite and ordered", () => {
  for (const scenario_move of [-99,500]) {
    const i={...DEFAULT_LEAPS,ticker:"SPY",as_of:"2026-01-01",expiration:"2026-01-02",strike:1000,scenario_move,exit_days:1};
    const {payoff,decay}=leapsPlots(i);
    assert.ok(payoff.every((p,n)=>Number.isFinite(p.x)&&p.values.every(Number.isFinite)&&(n===0||p.x>payoff[n-1].x)));
    assert.ok(payoff.every(p=>p.values[0]===p.values[1]));
    assert.equal(decay.length,2);
  }
});
