"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CandlestickChart, FileSearch, Eye, Globe2, X } from "lucide-react";
import { useTour } from "./Tour";

// First-run introduction: four short steps, shown once per browser on the
// first visit to an empty dashboard. The finish offers the guided tour or
// jumps straight to queuing a first study.
const KEY = "ss_onboarded_v1";

const STEPS = [
  {
    icon: CandlestickChart,
    title: "Welcome to Stock Studio",
    body: "Stock Studio builds fact-checked case studies on public companies: growth, profitability, valuation and moat, each verified against filings and earnings releases, with every source listed.",
    points: ["Your free trial includes starter credits", "Every study is dated and cites its sources", "Educational analysis, never a buy or sell call"],
  },
  {
    icon: FileSearch,
    title: "Queue a study",
    body: "Pick a ticker and a format. A quick take costs the fewest credits; a deep research memo checks the most sources. You always see the cost before you queue.",
    points: ["Add your own notes and the study fact-checks them", "Corrections to your notes are shown separately", "A failed study refunds its credits automatically"],
  },
  {
    icon: Eye,
    title: "Track what you care about",
    body: "Add tickers to your watchlist. Each refresh re-checks the thesis and marks it intact, weakening or broken, and the dashboard shows upcoming earnings for everything you follow.",
    points: ["Thesis status with the reason behind it", "A timeline of every earlier thesis", "Earnings dates for your tickers"],
  },
  {
    icon: Globe2,
    title: "Context at no credit cost",
    body: "Market context, setup bots and the gamma exposure model are included at no credit cost. They describe the market; they never tell you what to trade.",
    points: ["Sector rotation and market breadth", "Pattern scanners with a tracked record", "Options-positioning model with its assumptions"],
  },
];

function readFlag(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true; // storage blocked: don't nag on every visit
  }
}
function setFlag() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // ignore
  }
}

export default function Onboarding({ show }: { show: boolean }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const { start } = useTour();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (show && !readFlag()) setOpen(true);
  }, [show]);

  useEffect(() => {
    if (open) dialogRef.current?.querySelector<HTMLElement>("[data-primary]")?.focus();
  }, [open, step]);

  if (!open) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  const finish = () => {
    setFlag();
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") finish();
    if (e.key === "Tab" && dialogRef.current) {
      const f = [...dialogRef.current.querySelectorAll<HTMLElement>("button, a[href]")];
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) (e.preventDefault(), f[f.length - 1]?.focus());
      else if (!e.shiftKey && i === f.length - 1) (e.preventDefault(), f[0]?.focus());
    }
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-ink-950/80 p-4" onKeyDown={onKeyDown}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-body"
        className="relative w-full max-w-lg rounded-2xl border border-ink-500 bg-ink-900 p-6 shadow-2xl sm:p-8"
      >
        <button type="button" onClick={finish} className="icon-btn absolute right-4 top-4" aria-label="Close the introduction">
          <X className="h-4 w-4" aria-hidden />
        </button>
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
          <s.icon className="h-6 w-6 text-emerald-400" aria-hidden />
        </span>
        <p className="mt-4 text-xs font-medium text-emerald-300" aria-live="polite">
          Step {step + 1} of {STEPS.length}
        </p>
        <h2 id="onboarding-title" className="mt-1 text-xl font-semibold text-slate-100">
          {s.title}
        </h2>
        <p id="onboarding-body" className="mt-2 text-sm text-slate-300">
          {s.body}
        </p>
        <ul className="mt-4 space-y-1.5 text-sm text-slate-300">
          {s.points.map((p) => (
            <li key={p} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden />
              {p}
            </li>
          ))}
        </ul>

        <div className="mt-6 flex gap-1.5" aria-hidden>
          {STEPS.map((_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-emerald-400" : "bg-ink-600"}`} />
          ))}
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {step > 0 ? (
            <button type="button" onClick={() => setStep(step - 1)} className="btn-secondary px-4 py-2 text-sm">
              Back
            </button>
          ) : (
            <button type="button" onClick={finish} className="text-sm text-fg-subtle underline-offset-2 hover:text-slate-200 hover:underline">
              Skip introduction
            </button>
          )}
          {last ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  finish();
                  start();
                }}
                className="btn-secondary px-4 py-2 text-sm"
              >
                Take the tour
              </button>
              <Link href="/new" data-primary onClick={finish} className="btn-primary px-4 py-2 text-sm">
                Queue my first study
              </Link>
            </div>
          ) : (
            <button type="button" data-primary onClick={() => setStep(step + 1)} className="btn-primary px-4 py-2 text-sm">
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
