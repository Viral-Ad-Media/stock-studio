"use client";
import { useState } from "react";
import { DEFAULT_LEAPS, leapsAnalysis } from "@/lib/leaps";
import RangeField from "@/components/ui/RangeField";
import LeapsCharts from "@/components/charts/LeapsCharts";
const money = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    v,
  );
const STEPS = ["Research", "Thesis", "Scenario", "Actual trade", "Review"];
export default function WorkflowDemo() {
  const [step, setStep] = useState(0),
    [thesis, setThesis] = useState(
      "Check whether sales growth remains durable without sacrificing margins.",
    ),
    [move, setMove] = useState(10),
    [days, setDays] = useState(90),
    [iv, setIv] = useState(30),
    [entry, setEntry] = useState(""),
    [exit, setExit] = useState(""),
    [review, setReview] = useState("");
  const input = {
    ...DEFAULT_LEAPS,
    ticker: "DEMO",
    spot: 200,
    strike: 200,
    premium: 30,
    as_of: "2026-10-15",
    expiration: "2028-10-14",
    scenario_move: move,
    exit_days: days,
    scenario_iv: iv,
  };
  const result = leapsAnalysis(input);
  const validEntry =
      entry.trim() !== "" &&
      Number.isFinite(Number(entry)) &&
      Number(entry) > 0 &&
      Number(entry) <= 1e6,
    validExit =
      exit.trim() !== "" &&
      Number.isFinite(Number(exit)) &&
      Number(exit) >= 0 &&
      Number(exit) <= 1e6;
  return (
    <section
      className="card space-y-5 p-5 sm:p-8"
      aria-labelledby="workflow-demo"
    >
      <div>
        <p className="desk-eyebrow">Interactive demonstration</p>
        <h2 id="workflow-demo" className="text-2xl font-semibold">
          Walk through a decision
        </h2>
        <p className="mt-3 text-sm text-fg-subtle">
          Try the workflow without an account. All contract prices, dates and
          results below are invented examples, separate from the sourced Apple
          facts above. Nothing is saved, submitted to a broker or represented as
          actual performance.
        </p>
      </div>
      <nav aria-label="Demo steps" className="flex flex-wrap gap-2">
        {STEPS.map((name, i) => (
          <button
            key={name}
            type="button"
            aria-current={step === i ? "step" : undefined}
            onClick={() => setStep(i)}
            className={`rounded-lg border px-3 py-2 text-sm ${step === i ? "border-emerald-400 bg-emerald-500/10 text-emerald-400" : "border-ink-700 text-slate-300"}`}
          >
            {i + 1}. {name}
          </button>
        ))}
      </nav>
      <div className="min-h-52 rounded-xl border border-ink-700 bg-ink-950/50 p-5">
        {step === 0 && (
          <>
            <h3 className="font-semibold">Read the evidence first</h3>
            <p className="mt-3 text-sm text-slate-300">
              Start with a dated source and identify what it establishes. The
              historical Apple example supports reported sales growth; it does
              not establish a current valuation or an option entry price.
            </p>
            <p className="mt-3 text-sm text-fg-subtle">
              Next, turn the evidence into a question you can revisit.
            </p>
          </>
        )}
        {step === 1 && (
          <label className="block">
            <span className="field-label">Demo thesis to track</span>
            <textarea
              className="input min-h-28"
              maxLength={1000}
              value={thesis}
              onChange={(e) => setThesis(e.target.value)}
            />
            <span className="mt-2 block text-xs text-fg-subtle">
              This editable hypothesis travels with this local demonstration.
            </span>
          </label>
        )}
        {step === 2 && (
          <>
            <h3 className="font-semibold">
              Compare assumptions before a trade
            </h3>
            <p className="mt-2 text-sm text-fg-subtle">
              Invented long call: $200 underlying and strike, $30 premium/share,
              one standard contract, zero fees, 30% initial IV, 4% rate and zero
              dividend yield. European Black-Scholes; no live chain or listed
              contract is implied. Early exercise and slippage are excluded.
            </p>
            <div className="my-5 grid gap-5 sm:grid-cols-3">
              <RangeField
                label="Demo underlying move"
                value={move}
                min={-50}
                max={50}
                suffix="%"
                onChange={setMove}
              />
              <RangeField
                label="Demo holding days"
                value={days}
                min={0}
                max={730}
                onChange={setDays}
              />
              <RangeField
                label="Demo exit IV"
                value={iv}
                min={5}
                max={100}
                suffix="%"
                onChange={setIv}
              />
            </div>
            <p role="status" className="text-sm">
              Modeled option value: {money(result.scenario.price)} ·
              hypothetical net result: {money(result.scenarioPnl)}
            </p>
            <div className="mt-4">
              <LeapsCharts input={input} />
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h3 className="font-semibold">Enter executed prices yourself</h3>
            <p className="my-3 text-sm text-fg-subtle">
              In the real journal these fields require your actual fills. For
              this disposable demo, enter any hypothetical values to see the
              review. The modeled price has not been copied.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className="field-label">
                  Demo entry fill per share ($)
                </span>
                <input
                  className="input"
                  type="number"
                  min="0.000001"
                  max="1000000"
                  step="any"
                  value={entry}
                  onChange={(e) => setEntry(e.target.value)}
                />
              </label>
              <label>
                <span className="field-label">
                  Demo exit fill per share ($)
                </span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  max="1000000"
                  step="any"
                  value={exit}
                  onChange={(e) => setExit(e.target.value)}
                />
              </label>
            </div>
          </>
        )}
        {step === 4 && (
          <>
            <h3 className="font-semibold">
              Review the decision separately from its result
            </h3>
            <p className="my-3 text-sm text-slate-300">
              Thesis: {thesis || "No thesis entered"}
            </p>
            <p role="status" className="text-sm">
              {validEntry && validExit
                ? `Demo result for one contract with zero fees: ${money((Number(exit) - Number(entry)) * 100)}`
                : "Enter demo fill prices in Actual trade to calculate a result."}
            </p>
            <label className="mt-4 block">
              <span className="field-label">
                What did you learn? (demo only)
              </span>
              <textarea
                className="input min-h-24"
                maxLength={1000}
                value={review}
                onChange={(e) => setReview(e.target.value)}
              />
            </label>
          </>
        )}
      </div>
      <div className="flex justify-between gap-3">
        <button
          type="button"
          disabled={step === 0}
          className="btn-secondary px-4 py-2 text-sm"
          onClick={() => setStep((s) => s - 1)}
        >
          Back
        </button>
        <button
          type="button"
          disabled={step === 4}
          className="btn-primary px-4 py-2 text-sm"
          onClick={() => setStep((s) => s + 1)}
        >
          Next step
        </button>
      </div>
    </section>
  );
}
