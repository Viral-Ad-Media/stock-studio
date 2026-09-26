"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";

// Guided product tour: spotlights one navigation item at a time with a short
// explanation. Targets are elements carrying data-tour="<key>". When a target
// isn't visible (the phone layout keeps the nav in a drawer) the step shows as
// a centred card instead.
export type TourStep = { target: string; title: string; body: string };

export const TOUR_STEPS: TourStep[] = [
  {
    target: "dashboard",
    title: "Your dashboard",
    body: "Every study you queue lands here with its build status, research grade and a one-line summary. Earnings dates for the companies you follow sit on top.",
  },
  {
    target: "new",
    title: "Queue a study",
    body: "Pick a ticker and a format, from a quick take to a deep research memo, and add notes you want fact-checked. The credit cost is shown before you queue.",
  },
  {
    target: "watchlist",
    title: "Track a thesis",
    body: "Add tickers you follow. Each refresh re-checks the thesis, marks it intact, weakening or broken, and keeps a timeline of earlier versions.",
  },
  {
    target: "market",
    title: "Market context",
    body: "Sector performance against the S&P 500, market breadth and today's movers, with a plain-English reading. Free to use.",
  },
  {
    target: "setups",
    title: "Setup bots",
    body: "Rule-based scanners that check about 100 large caps for well-known chart patterns after every close, and track how each pattern has behaved.",
  },
  {
    target: "gamma",
    title: "Gamma exposure",
    body: "A model of options-dealer positioning for any optionable symbol, with its assumptions spelled out.",
  },
  {
    target: "billing",
    title: "Credits and billing",
    body: "Your trial, access and credit balance. Failed studies are refunded automatically.",
  },
  {
    target: "help",
    title: "Replay any time",
    body: "Open this tour again from the Help button whenever you need a refresher.",
  },
];

const TourContext = createContext<{ start: () => void }>({ start: () => {} });
export const useTour = () => useContext(TourContext);

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [step, setStep] = useState<number | null>(null);
  const start = useCallback(() => setStep(0), []);
  return (
    <TourContext.Provider value={{ start }}>
      {children}
      {step !== null && <TourOverlay step={step} setStep={setStep} />}
    </TourContext.Provider>
  );
}

type Rect = { top: number; left: number; width: number; height: number };

function visibleRect(key: string): Rect | null {
  const els = document.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") {
      return { top: r.top, left: r.left, width: r.width, height: r.height };
    }
  }
  return null;
}

function TourOverlay({ step, setStep }: { step: number; setStep: (s: number | null) => void }) {
  const s = TOUR_STEPS[step];
  const last = step === TOUR_STEPS.length - 1;
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement;
    return () => (returnFocus.current as HTMLElement | null)?.focus?.();
  }, []);

  useLayoutEffect(() => {
    const update = () => setRect(visibleRect(s.target));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [s.target]);

  useEffect(() => {
    cardRef.current?.querySelector<HTMLElement>("[data-primary]")?.focus();
  }, [step]);

  const close = () => setStep(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") close();
    if (e.key === "ArrowRight" && !last) setStep(step + 1);
    if (e.key === "ArrowLeft" && step > 0) setStep(step - 1);
    // Keep Tab inside the card while the tour is open.
    if (e.key === "Tab" && cardRef.current) {
      const f = [...cardRef.current.querySelectorAll<HTMLElement>("button")];
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) (e.preventDefault(), f[f.length - 1]?.focus());
      else if (!e.shiftKey && i === f.length - 1) (e.preventDefault(), f[0]?.focus());
    }
  };

  // Card beside the highlighted item when there's room, else centred.
  const pad = 6;
  const cardStyle: React.CSSProperties =
    rect && window.innerWidth >= 640
      ? {
          top: Math.min(Math.max(rect.top - 8, 12), window.innerHeight - 260),
          left: Math.min(rect.left + rect.width + 16, window.innerWidth - 352),
        }
      : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  return (
    <div className="fixed inset-0 z-[60]" onKeyDown={onKeyDown}>
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-lg ring-2 ring-emerald-400 transition-all motion-reduce:transition-none"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: "0 0 0 9999px rgba(5, 8, 13, 0.72)",
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-ink-950/75" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="fixed w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-ink-500 bg-ink-900 p-5 shadow-2xl"
        style={cardStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium text-emerald-300" aria-live="polite">
            Step {step + 1} of {TOUR_STEPS.length}
          </p>
          <button type="button" onClick={close} className="-m-1 rounded p-1 text-fg-subtle hover:text-slate-100" aria-label="Close the tour">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <h2 id="tour-title" className="mt-1 text-base font-semibold text-slate-100">
          {s.title}
        </h2>
        <p id="tour-body" className="mt-2 text-sm text-slate-300">
          {s.body}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={close} className="text-sm text-fg-subtle underline-offset-2 hover:text-slate-200 hover:underline">
            Skip tour
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} className="btn-secondary px-3 py-1.5 text-sm">
                Back
              </button>
            )}
            <button type="button" data-primary onClick={() => (last ? close() : setStep(step + 1))} className="btn-primary px-3 py-1.5 text-sm">
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
