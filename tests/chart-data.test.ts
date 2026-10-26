import assert from "node:assert/strict";
import test from "node:test";
import { axisTicks, compactMoney, journalPlot, leapsPlots, niceTicks, plotDomain } from "../lib/chart-data";
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

test("journal drawdown series measures distance below the running realized peak", () => {
  const points = journalPlot([{date:"2026-01-01",pnl:-50},{date:"2026-01-02",pnl:200},{date:"2026-01-03",pnl:120},{date:"2026-01-04",pnl:260}]);
  assert.deepEqual(points.map(p=>p.values[1]),[-50,0,-80,0]);
  assert.ok(points.every(p=>p.values[1]<=0));
});

test("compact money and axis ticks stay short, signed and round", () => {
  assert.deepEqual([257.19,-1771.09,4.51,0,1234567,-99.6,12.5].map(compactMoney),["$257","-$1.8K","$4.51","$0","$1.2M","-$99.60","$12.50"]);
  assert.deepEqual(niceTicks(-6600,3900,4),[-5000,-2500,0,2500]);
  assert.deepEqual(niceTicks(0.01,0.02,4),[0.01,0.0125,0.015,0.0175,0.02]);
  assert.deepEqual(niceTicks(-1,1,4),[-1,-0.5,0,0.5,1]);
  for (const [lo,hi] of [[-7.3,41.9],[-5000,13000],[0.01,0.02]]) {
    const ticks=niceTicks(lo,hi,4);
    assert.ok(ticks.length>=2 && ticks.every(t=>t>=lo-1e-9&&t<=hi+1e-9));
  }
  assert.deepEqual(axisTicks(0,10,2),[0,5,10]);
});
