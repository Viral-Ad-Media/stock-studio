"use client";
import LineChart, { chartMoney } from "./LineChart";
import { leapsPlots } from "@/lib/chart-data";
import { leapsAnalysis, type LeapsInput } from "@/lib/leaps";

export default function LeapsCharts({ input }: { input: LeapsInput }) {
  const { payoff, decay } = leapsPlots(input), { expiryBreakeven } = leapsAnalysis(input);
  const scenarioSpot = input.spot * (1 + input.scenario_move / 100);
  return <div className="grid gap-4 xl:grid-cols-2">
    <LineChart title="Early exit vs. expiration" description={`${input.contracts} contract${input.contracts === 1 ? "" : "s"} · net P&L includes entered premium and total fees. Exit in ${input.exit_days} days at ${input.scenario_iv}% IV.`} points={payoff} series={["Modeled exit", "At expiration"]} xLabel="Underlying price ($)" xFormat={chartMoney} initialX={scenarioSpot}
      markers={[{ x: input.spot, label: "Now" }, { x: input.strike, label: "Strike" }, ...(expiryBreakeven > 0 ? [{ x: expiryBreakeven, label: "Breakeven" }] : [])]} />
    <LineChart title="Time remaining, value changing" description={`Option value per share with the underlying fixed at ${chartMoney(input.spot)} and IV fixed at ${input.iv}%. Rates and dividend yield stay unchanged.`} points={decay} series={["Theoretical price"]} xLabel="Days elapsed from valuation" xFormat={d => `${Math.round(d)}d`} initialX={input.exit_days}
      markers={input.exit_days > 0 ? [{ x: input.exit_days, label: "Modeled exit" }] : []} />
  </div>;
}
