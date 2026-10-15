"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { JournalTrade } from "@/lib/journal";
import { calendarDays, decisionAnalysis } from "@/lib/journal-analysis";
const money = (v: number | null) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(v);
export default function DecisionAnalysis({
  rows,
  studies,
  today,
  onReview,
}: {
  rows: JournalTrade[];
  studies: { id: number; ticker: string; variant: string }[];
  today: string;
  onReview: (trade: JournalTrade) => void;
}) {
  const analysis = useMemo(() => decisionAnalysis(rows), [rows]);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState("");
  const days = calendarDays(month),
    byDate = new Map(analysis.calendar.map((d) => [d.date, d]));
  const months = [
    ...new Set([
      today.slice(0, 7),
      ...analysis.calendar.map((d) => d.date.slice(0, 7)),
    ]),
  ]
    .sort()
    .reverse();
  return (
    <section className="card space-y-6 p-5" aria-labelledby="decision-analysis">
      <div>
        <h2 id="decision-analysis" className="text-lg font-semibold">
          Decision review
        </h2>
        <p className="mt-2 text-xs text-fg-subtle">
          Closed, active lots only; net dollar results after recorded fees. Each
          lot counts once, including split partial exits. Descriptive history,
          not expected future returns or a time-weighted portfolio return.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Historical expectancy / lot", money(analysis.expectancy)],
          ["Average winning lot", money(analysis.averageWin)],
          ["Average losing lot", money(analysis.averageLoss)],
          [
            "Exit reviews completed",
            `${analysis.reviewed} / ${analysis.count}`,
          ],
        ].map(([label, value]) => (
          <div key={label} className="metric-tile">
            <p className="text-xs text-fg-subtle">{label}</p>
            <p className="mt-2 text-lg font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-fg-subtle">
        Expectancy = total realized net P&amp;L ÷ closed lots, including flat
        lots. Small samples are unstable; n={analysis.count}.
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 font-medium">Results by holding period</h3>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Calendar days between actual entry and exit
              </caption>
              <thead>
                <tr>
                  <th>Held</th>
                  <th>Lots</th>
                  <th>Net P&amp;L</th>
                  <th>Per lot</th>
                </tr>
              </thead>
              <tbody>
                {analysis.holding.map((b) => (
                  <tr key={b.name} className="border-t border-ink-700">
                    <th scope="row" className="py-2 font-normal">
                      {b.name}
                    </th>
                    <td>{b.count}</td>
                    <td>{money(b.pnl)}</td>
                    <td>{money(b.expectancy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h3 className="mb-3 font-medium">
            Results by linked research thesis
          </h3>
          {!analysis.theses.length ? (
            <p className="text-sm text-fg-subtle">
              Close a recorded trade to begin reviewing results.
            </p>
          ) : (
            <ul className="divide-y divide-ink-700 text-sm">
              {analysis.theses.map((t) => {
                const study = studies.find((s) => s.id === t.id);
                return (
                  <li
                    key={t.id ?? "unlinked"}
                    className="flex flex-wrap justify-between gap-3 py-2"
                  >
                    <span>
                      {t.id ? (
                        <Link
                          className="text-emerald-400 underline"
                          href={`/study/${t.id}`}
                        >
                          {study
                            ? `${study.ticker} · ${study.variant}`
                            : `Research #${t.id}`}
                        </Link>
                      ) : (
                        "No linked research"
                      )}
                      <span className="block text-xs text-fg-subtle">
                        {t.count} lots · {t.reviewed} reviews ·{" "}
                        {money(t.pnl / t.count)} per lot
                      </span>
                    </span>
                    <span>{money(t.pnl)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h3 className="font-medium">Realized results calendar</h3>
          <label>
            <span className="field-label">Review month</span>
            <select
              className="input"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setSelected("");
              }}
            >
              {months.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-7 gap-1 text-xs">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <span key={d} className="py-2 text-center text-fg-subtle">
              {d}
            </span>
          ))}
          {days.map((date, index) => {
            const d = date ? byDate.get(date) : null;
            return date ? (
              <button
                key={date}
                type="button"
                aria-pressed={selected === date}
                aria-label={`${date}: ${d ? `${d.count} closed lots, ${money(d.pnl)}` : "no closed lots"}`}
                className={`min-h-20 rounded-lg border p-1 text-left sm:p-2 ${selected === date ? "border-emerald-400" : "border-ink-700"} ${d ? (d.pnl < 0 ? "bg-red-500/10" : "bg-emerald-500/10") : "bg-ink-950/30"}`}
                onClick={() => setSelected(date)}
              >
                <span>{Number(date.slice(-2))}</span>
                {d && (
                  <>
                    <span className="mt-2 block break-all font-medium">
                      {money(d.pnl)}
                    </span>
                    <span className="hidden text-fg-subtle sm:block">
                      {d.count} lots
                    </span>
                  </>
                )}
              </button>
            ) : (
              <span key={`blank-${index}`} />
            );
          })}
        </div>
        {selected && (
          <div role="status" className="mt-4 text-sm">
            <p className="font-medium">{selected}</p>
            {rows
              .filter((t) => !t.archived_at && t.closed_on === selected)
              .map((t) => (
                <div
                  key={t.id}
                  className="mt-2 flex flex-wrap justify-between gap-2"
                >
                  <span>
                    {t.ticker} · {t.review || "Exit review missing"}
                  </span>
                  <button
                    type="button"
                    className="text-emerald-400 underline"
                    onClick={() => onReview(t)}
                  >
                    Edit / review lot
                  </button>
                </div>
              ))}
            {!byDate.has(selected) && (
              <p className="text-fg-subtle">No lots closed on this date.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
