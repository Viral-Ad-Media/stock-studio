"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { daysBetweenDates, optionModel, type LeapsInput } from "@/lib/leaps";
import { useMotionVisibility } from "@/components/motion/useMotionVisibility";
import MotionBoundary from "@/components/motion/MotionBoundary";
import RangeField from "@/components/ui/RangeField";
const Surface = dynamic(() => import("./SensitivityScene"), {
  ssr: false,
  loading: () => null,
});
const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
export default function SensitivityExplorer({ input }: { input: LeapsInput }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="chart-panel border-sky-400/25">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="desk-eyebrow text-sky-400">Options learning lab</p>
          <h2 className="font-semibold text-slate-100">
            Price, time and volatility in 3D
          </h2>
        </div>
        <button
          className="btn-secondary px-3 py-2 text-sm"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close 3D explorer" : "Explore sensitivity"}
        </button>
      </div>
      <p className="mt-2 text-xs text-fg-subtle">
        An optional illustration using the same European option model as the
        tables. Local sliders do not change or save your scenario. Hypothetical
        values, not forecasts.
      </p>
      {open && <Explorer key={JSON.stringify(input)} input={input} />}
    </section>
  );
}
function Explorer({ input }: { input: LeapsInput }) {
  const days = daysBetweenDates(input.as_of, input.expiration);
  const [move, setMove] = useState(
      Math.max(-50, Math.min(50, input.scenario_move)),
    ),
    [elapsed, setElapsed] = useState(input.exit_days),
    [iv, setIv] = useState(input.scenario_iv);
  const { containerRef, visible } = useMotionVisibility();
  const spot = input.spot * (1 + move / 100),
    price = optionModel(
      input.type,
      spot,
      input.strike,
      days - elapsed,
      iv,
      input.rate,
      input.dividend,
    ).price;
  const pnl = (price - input.premium) * input.contracts * 100 - input.fees;
  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <figure>
        <div
          ref={containerRef}
          className="relative flex h-64 items-center justify-center overflow-hidden rounded-xl border border-ink-700 bg-ink-950"
        >
          <p className="absolute max-w-xs p-6 text-center text-sm text-fg-subtle">
            Use the sliders to compare modeled values. The numeric results
            remain available with reduced motion or without WebGL.
          </p>
          {visible && (
            <div className="absolute inset-0" aria-hidden="true">
              <MotionBoundary>
                <Surface input={input} move={move} elapsed={elapsed} iv={iv} />
              </MotionBoundary>
            </div>
          )}
        </div>
        <figcaption className="mt-2 text-xs text-fg-subtle">
          Left/right: underlying price (−50% to +50%). Front/back: days elapsed
          (0 to {days}). Height: theoretical option value per share on a shared
          linear scale. Blue lines follow time; teal lines follow price. Drag to
          rotate; gold marker = slider selection.
        </figcaption>
      </figure>
      <div className="space-y-4">
        <RangeField
          label="Illustration underlying move"
          value={move}
          min={-50}
          max={50}
          suffix="%"
          onChange={setMove}
        />
        <RangeField
          label="Illustration days elapsed"
          value={elapsed}
          min={0}
          max={days}
          onChange={setElapsed}
        />
        <RangeField
          label="Illustration IV"
          value={iv}
          min={0.1}
          max={500}
          step={0.1}
          suffix="%"
          onChange={setIv}
        />
        <dl
          aria-live="polite"
          className="grid grid-cols-2 gap-3 rounded-lg border border-ink-700 p-3 text-xs"
        >
          <div>
            <dt className="text-fg-subtle">Underlying</dt>
            <dd className="mt-1 font-mono">{money(spot)}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Days remaining</dt>
            <dd className="mt-1 font-mono">{days - elapsed}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Model / share</dt>
            <dd className="mt-1 font-mono">{money(price)}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Net P&amp;L after fees</dt>
            <dd className="mt-1 font-mono">{money(pnl)}</dd>
          </div>
        </dl>
        <p className="text-xs text-fg-subtle">
          Strike, type, premium, contract count, fees, rates and dividend yield
          stay fixed at your scenario assumptions. Changing IV rescales the
          height axis; compare amounts using the numeric readout.
        </p>
      </div>
    </div>
  );
}
