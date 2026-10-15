import {
  Activity,
  BookOpen,
  FileSearch,
  Layers,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";

export type MockupKind =
  | "study"
  | "dashboard"
  | "watchlist"
  | "market"
  | "setups"
  | "gamma"
  | "journal"
  | "leaps";
const TITLES: Record<MockupKind, string> = {
  study: "A thesis you can examine",
  dashboard: "Your research, organized",
  watchlist: "Keep the thesis in view",
  market: "Read the broader market",
  setups: "Rules before patterns",
  gamma: "Positioning, with context",
  journal: "Review decisions and results",
  leaps: "Explore time and possibility",
};
const DESCRIPTIONS: Record<MockupKind, string> = {
  study:
    "Illustrative company study with four research cards, cited sources and a bear case.",
  dashboard:
    "Illustrative Today dashboard with market context, thesis review and recent research.",
  watchlist:
    "Illustrative watchlist showing fictional companies with intact and weakening theses.",
  market: "Illustrative market dashboard with sector leadership and breadth.",
  setups:
    "Illustrative rule-based setup scan for fictional companies; no trade recommendations.",
  gamma:
    "Illustrative dealer-gamma model with positive and negative strike concentrations.",
  journal:
    "Synthetic journal results and a realized P&L curve; not actual trading performance.",
  leaps:
    "Hypothetical options scenarios with a price curve and disclosed assumptions.",
};

function Panel({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-ink-700 bg-ink-900 p-3 sm:p-4 ${className}`}
    >
      <p className="mb-3 text-[11px] font-semibold text-slate-200">{title}</p>
      {children}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-950/60 p-2.5">
      <p className="text-[9px] text-fg-subtle">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-slate-100">
        {value}
      </p>
    </div>
  );
}
function Curve({
  loss = false,
  comparison = false,
}: {
  loss?: boolean;
  comparison?: boolean;
}) {
  return (
    <svg viewBox="0 0 400 130" className="h-auto w-full" aria-hidden="true">
      {[25, 65, 105].map((y) => (
        <line
          key={y}
          x1="10"
          x2="390"
          y1={y}
          y2={y}
          stroke="rgb(var(--ink-700))"
        />
      ))}
      <path
        d={
          loss
            ? "M10 35 C90 45 100 62 170 65 S290 100 390 110"
            : "M10 110 C70 112 90 92 140 96 S210 55 260 62 S340 30 390 20"
        }
        fill="none"
        stroke="rgb(var(--emerald-400))"
        strokeWidth="3"
      />
      {comparison && (
        <path
          d="M10 110 L150 110 L240 77 L390 23"
          fill="none"
          stroke="rgb(var(--sky-400))"
          strokeWidth="2"
          strokeDasharray="5 5"
        />
      )}
    </svg>
  );
}
function Bars({ gamma = false }: { gamma?: boolean }) {
  const values = gamma
    ? [-55, -80, -35, -15, 25, 70, 95]
    : [85, 64, 47, 22, -18, -40];
  return (
    <div className="space-y-2.5">
      {values.map((value, n) => (
        <div
          key={n}
          className="grid grid-cols-[2rem_1fr_3rem] items-center gap-2 text-[9px]"
        >
          <span className="font-mono text-fg-subtle">
            {gamma ? 85 + n * 5 : ["XLK", "XLI", "XLV", "XLY", "XLF", "XLE"][n]}
          </span>
          <div className="relative h-3.5 rounded bg-ink-800">
            <span className="absolute inset-y-0 left-1/2 w-px bg-ink-500" />
            <span
              className={`absolute inset-y-0.5 rounded-sm ${value < 0 ? "bg-red-400" : "bg-emerald-400"}`}
              style={{
                left: value < 0 ? `${50 - Math.abs(value) / 2}%` : "50%",
                width: `${Math.abs(value) / 2}%`,
              }}
            />
          </div>
          <span className="text-right font-mono text-fg-subtle">
            {gamma
              ? "Model"
              : `${value > 0 ? "+" : ""}${(value / 20).toFixed(1)}%`}
          </span>
        </div>
      ))}
    </div>
  );
}
function ResearchRows() {
  return (
    <div className="space-y-2">
      {[
        ["NWRB", "Northwind Robotics", "B−"],
        ["ATLS", "Atlas Systems", "C+"],
        ["GLMR", "Glimmer Energy", "B"],
      ].map(([ticker, name, grade]) => (
        <div
          key={ticker}
          className="flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-950/40 px-3 py-2.5"
        >
          <span className="rounded border border-sky-400/25 bg-sky-400/10 px-2 py-1 text-[10px] font-semibold text-sky-400">
            {grade}
          </span>
          <div>
            <p className="text-[11px] font-semibold text-slate-100">{ticker}</p>
            <p className="text-[9px] text-fg-subtle">
              {name} · fictional company
            </p>
          </div>
          <span className="ml-auto text-[9px] text-emerald-400">Ready</span>
        </div>
      ))}
    </div>
  );
}
function Content({ kind }: { kind: MockupKind }) {
  switch (kind) {
    case "study":
      return (
        <>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-sm font-semibold text-slate-100">
                NWRB
              </p>
              <p className="mt-1 text-[10px] text-fg-subtle">
                Northwind Robotics · fictional company
              </p>
            </div>
            <span className="rounded-lg border border-sky-400/25 bg-sky-400/10 px-3 py-2 text-lg font-semibold text-sky-400">
              B−
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["Growth", "Improving"],
              ["Profitability", "Positive"],
              ["Valuation", "Demanding"],
              ["Moat", "Developing"],
            ].map(([label, value]) => (
              <Metric key={label} label={label} value={value} />
            ))}
          </div>
          <Panel title="The research thesis">
            <p className="text-[11px] leading-5 text-slate-300">
              Revenue is growing. The next question is whether cash generation
              can keep pace with investment.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[9px] text-fg-subtle">
              <span>↗ Earnings release</span>
              <span>↗ Annual filing</span>
              <span>↗ Source table</span>
            </div>
          </Panel>
          <div className="rounded-lg border border-amber-400/25 bg-amber-400/5 p-3 text-[10px] text-amber-300">
            Bear case: slowing demand could pressure margins.
          </div>
        </>
      );
    case "dashboard":
      return (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Research library" value="12 studies" />
            <Metric label="Thesis review" value="2 to revisit" />
            <Metric label="Next earnings" value="In 8 days" />
          </div>
          <Panel title="Market context · illustrative">
            <Curve />
          </Panel>
          <ResearchRows />
        </>
      );
    case "watchlist":
      return (
        <>
          {[
            [
              "NWRB",
              "Thesis intact",
              "Demand remains consistent with the saved thesis.",
            ],
            [
              "ATLS",
              "Review needed",
              "Margin pressure challenges the prior assumptions.",
            ],
          ].map(([ticker, status, text], n) => (
            <Panel key={ticker} title={`${ticker} · fictional company`}>
              <span
                className={`rounded-full border px-2 py-1 text-[9px] ${n ? "border-amber-400/30 text-amber-300" : "border-emerald-400/30 text-emerald-400"}`}
              >
                {status}
              </span>
              <p className="mt-3 text-[11px] leading-5 text-slate-300">
                {text}
              </p>
              <p className="mt-3 border-t border-ink-700 pt-2 text-[9px] text-fg-subtle">
                Saved thesis → Source update → Review
              </p>
            </Panel>
          ))}
        </>
      );
    case "market":
      return (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Index · sample" value="+0.6%" />
            <Metric label="Breadth · sample" value="58%" />
            <Metric label="Data" value="Daily bars" />
          </div>
          <Panel title="Sector leadership · sample returns">
            <Bars />
          </Panel>
          <p className="text-[10px] text-fg-subtle">
            Historical context, not a forecast.
          </p>
        </>
      );
    case "setups":
      return (
        <>
          <Panel title="52-week breakout scan">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-fg-subtle">
                Illustrative completed scan
              </span>
              <span className="text-emerald-400">2 pattern matches</span>
            </div>
          </Panel>
          {[
            ["NWRB", "Price and volume rules matched"],
            ["ATLS", "Retest conditions matched"],
          ].map(([ticker, text]) => (
            <Panel key={ticker} title={`${ticker} · fictional company`}>
              <p className="text-[11px] text-slate-300">{text}</p>
              <p className="mt-2 text-[9px] text-fg-subtle">
                Rule checklist · sample scan · no trade call
              </p>
            </Panel>
          ))}
        </>
      );
    case "gamma":
      return (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Zero gamma · sample" value="$100" />
            <Metric label="Call wall · sample" value="$105" />
            <Metric label="Put wall · sample" value="$95" />
          </div>
          <Panel title="Net gamma by strike · illustrative">
            <Bars gamma />
          </Panel>
          <p className="text-[10px] text-fg-subtle">
            Model assumptions remain visible beside the data.
          </p>
        </>
      );
    case "journal":
      return (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Net P&L · synthetic" value="+$82" />
            <Metric label="Closed lots" value="3" />
            <Metric label="Fees included" value="Yes" />
          </div>
          <Panel title="Realized results · synthetic example">
            <Curve />
          </Panel>
          <Panel title="NWRB · example entry">
            <div className="flex justify-between gap-3 text-[10px]">
              <span className="text-fg-subtle">Entry thesis → Exit review</span>
              <span className="text-emerald-400">Linked study</span>
            </div>
          </Panel>
        </>
      );
    case "leaps":
      return (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Contract · sample" value="Long call" />
            <Metric label="Time remaining" value="730 days" />
            <Metric label="IV assumption" value="30%" />
          </div>
          <Panel title="Early exit vs. expiration · hypothetical">
            <Curve comparison />
          </Panel>
          <div className="flex flex-wrap gap-3 text-[9px]">
            <span className="text-emerald-400">● Modeled exit</span>
            <span className="text-sky-400">● At expiration</span>
          </div>
          <Panel title="Explore the assumptions">
            <div className="grid grid-cols-3 gap-3 text-[10px] text-fg-subtle">
              {["Price", "Time", "Volatility"].map((t) => (
                <div key={t}>
                  {t}
                  <div className="mt-2 h-1 rounded bg-ink-700">
                    <div className="h-1 w-2/3 rounded bg-sky-400" />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </>
      );
  }
}

/** Theme-aware UI illustration. No live data, account information or API calls. */
export default function ProductMockup({
  kind,
  compact = false,
  className = "",
}: {
  kind: MockupKind;
  compact?: boolean;
  className?: string;
}) {
  return (
    <figure
      className={`marketing-shot overflow-hidden rounded-2xl border border-ink-600 bg-ink-900 shadow-xl shadow-black/10 ${className}`}
      aria-label={DESCRIPTIONS[kind]}
    >
      <div className="flex items-center gap-2 border-b border-ink-700 bg-ink-800/60 px-4 py-3">
        <div className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((n) => (
            <span key={n} className="h-1.5 w-1.5 rounded-full bg-ink-500" />
          ))}
        </div>
        <span className="min-w-0 truncate font-mono text-[10px] text-fg-subtle">
          Stock Studio / {kind === "dashboard" ? "today" : kind}
        </span>
        <span className="ml-auto shrink-0 rounded border border-ink-500 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-fg-subtle">
          Illustrative
        </span>
      </div>
      <div className="flex min-w-0">
        {!compact && (
          <div
            className="hidden w-24 shrink-0 flex-col gap-3 border-r border-ink-700 bg-ink-950/40 p-3 sm:flex"
            aria-hidden="true"
          >
            <Activity className="mb-2 h-5 w-5 text-emerald-400" />
            {[
              [FileSearch, "Research"],
              [ShieldCheck, "Thesis"],
              [Layers, "Market"],
              [BookOpen, "Journal"],
            ].map(([Icon, label]) => {
              const Item = Icon as typeof Activity;
              return (
                <div
                  key={String(label)}
                  className="flex items-center gap-1.5 text-[9px] text-fg-subtle"
                >
                  <Item className="h-3 w-3" />
                  {String(label)}
                </div>
              );
            })}
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-3 bg-ink-950/25 p-4 sm:p-5">
          <div>
            <p className="text-[9px] uppercase tracking-[.14em] text-emerald-400">
              Research & trading workspace
            </p>
            <p className="mt-1 text-sm font-semibold tracking-tight text-slate-100 sm:text-base">
              {TITLES[kind]}
            </p>
          </div>
          <Content kind={kind} />
        </div>
      </div>
      <figcaption className="border-t border-ink-700 bg-ink-900 px-4 py-2 text-[9px] leading-4 text-fg-subtle">
        Product illustration · fictional companies / sample data · not a live
        account or verified performance
      </figcaption>
    </figure>
  );
}
