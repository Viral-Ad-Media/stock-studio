"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  CandlestickChart,
  CloudOff,
  Eye,
  FileText,
  Megaphone,
  RefreshCw,
  Trash2,
  Wifi,
} from "lucide-react";
import { journalStats, realizedPnl } from "@/lib/journal";
import { variantLabel } from "@/lib/shared";
import ThesisStatusBadge from "@/components/insights/ThesisStatusBadge";
import StatusBadge from "@/components/StatusBadge";
import PageHeader from "@/components/ui/PageHeader";
import { usePwa } from "./PwaProvider";

type Tab = "studies" | "watchlist" | "journal" | "leaps" | "signals";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);

export default function OfflineWorkspace() {
  const {
    isOffline,
    snapshot,
    outbox,
    syncing,
    syncNow,
    refreshSnapshot,
    discardOutboxItem,
    retryOutboxItem,
  } = usePwa();

  const [tab, setTab] = useState<Tab>("studies");
  const [selectedStudyId, setSelectedStudyId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const selectedStudy = useMemo(
    () => snapshot?.studies.find((s) => s.id === selectedStudyId) ?? null,
    [selectedStudyId, snapshot],
  );

  const stats = useMemo(
    () => (snapshot ? journalStats(snapshot.journal) : null),
    [snapshot],
  );

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await syncNow();
      await refreshSnapshot();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6 md:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-fg-subtle hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to workspace
        </Link>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
            isOffline
              ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          }`}
        >
          {isOffline ? (
            <>
              <CloudOff className="h-3.5 w-3.5" aria-hidden /> Offline
            </>
          ) : (
            <>
              <Wifi className="h-3.5 w-3.5" aria-hidden /> Online
            </>
          )}
        </span>
      </div>

      <PageHeader
        title="Offline workspace library"
        description={
          snapshot
            ? `Snapshot saved ${new Date(snapshot.syncedAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}. All figures reflect their saved as-of dates, not live market quotes.`
            : "Read cached studies, watchlist theses, and your trading journal when you don't have a network connection."
        }
        actions={
          !isOffline ? (
            <button
              type="button"
              disabled={refreshing || syncing}
              onClick={() => void handleRefresh()}
              className="btn-primary px-4 py-2 text-sm"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing || syncing ? "animate-spin" : ""}`}
                aria-hidden
              />
              {refreshing || syncing ? "Syncing…" : "Refresh snapshot"}
            </button>
          ) : undefined
        }
      />

      {outbox.length > 0 && (
        <div className="card p-4 space-y-3 border-amber-500/30">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-100">
              Queued offline changes ({outbox.length})
            </h2>
            {!isOffline && (
              <button
                type="button"
                disabled={syncing}
                onClick={() => void syncNow()}
                className="btn-secondary px-3 py-1.5 text-xs"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} aria-hidden />
                Sync now
              </button>
            )}
          </div>
          <div className="divide-y divide-ink-700">
            {outbox.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs">
                <div>
                  <span className="font-medium text-slate-200">{item.label}</span>
                  {item.status === "failed" && item.error ? (
                    <p className="text-red-400">{item.error}</p>
                  ) : (
                    <p className="text-fg-subtle">Queued locally — will sync automatically when online</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {item.status === "failed" && !isOffline && (
                    <button
                      type="button"
                      onClick={() => void retryOutboxItem(item.id)}
                      className="btn-secondary px-2.5 py-1 text-xs"
                    >
                      Retry
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Discard ${item.label}`}
                    onClick={() => void discardOutboxItem(item.id)}
                    className="icon-btn text-slate-400 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!snapshot ? (
        <div className="card p-8 text-center space-y-3">
          <CloudOff className="mx-auto h-8 w-8 text-fg-subtle" aria-hidden />
          <h2 className="text-lg font-semibold text-slate-100">No offline snapshot cached yet</h2>
          <p className="mx-auto max-w-md text-sm text-fg-subtle">
            Sign in while connected so Stock Studio can save your recent case studies, watchlist theses, and trading journal to this device.
          </p>
          {!isOffline && (
            <div className="pt-2">
              <Link href="/dashboard" className="btn-primary px-4 py-2 text-sm">
                Open Dashboard
              </Link>
            </div>
          )}
        </div>
      ) : (
        <>
          <div
            role="tablist"
            aria-label="Offline workspace sections"
            className="flex flex-wrap gap-2 border-b border-ink-700 pb-3"
          >
            {(
              [
                { id: "studies", label: `Studies (${snapshot.studies.length})`, Icon: FileText },
                { id: "watchlist", label: `Watchlist (${snapshot.watchlist.length})`, Icon: Eye },
                { id: "journal", label: `Journal (${snapshot.journal.length})`, Icon: BookOpen },
                { id: "leaps", label: `LEAPS (${snapshot.leapsPlans.length})`, Icon: CandlestickChart },
                ...(snapshot.signals.length > 0
                  ? [{ id: "signals" as const, label: `Signals (${snapshot.signals.length})`, Icon: Megaphone }]
                  : []),
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={tab === id}
                onClick={() => {
                  setTab(id);
                  setSelectedStudyId(null);
                }}
                className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  tab === id
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/40"
                    : "bg-ink-900 text-slate-400 border border-ink-700 hover:text-slate-200"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          {tab === "studies" && (
            <div>
              {selectedStudy ? (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => setSelectedStudyId(null)}
                    className="inline-flex items-center gap-1.5 text-sm text-emerald-400 hover:underline"
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden /> All cached studies
                  </button>

                  <div className="card p-5 sm:p-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 pb-4">
                      <div>
                        <h2 className="font-mono text-2xl font-bold text-slate-100 flex items-center gap-2.5">
                          {selectedStudy.ticker}
                          <StatusBadge status={selectedStudy.status as "ready" | "queued" | "building" | "error"} />
                          {selectedStudy.gradeLetter && (
                            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-sm text-emerald-400">
                              Grade {selectedStudy.gradeLetter}
                            </span>
                          )}
                        </h2>
                        <p className="mt-1 text-xs text-fg-subtle">
                          {selectedStudy.company ?? "Company"} · {variantLabel(selectedStudy.variant)}
                          {selectedStudy.asOfDate ? ` · As of ${selectedStudy.asOfDate}` : ""}
                        </p>
                      </div>
                      <Link href={`/study/${selectedStudy.id}`} className="btn-secondary px-3 py-1.5 text-xs">
                        Open full study page
                      </Link>
                    </div>

                    {selectedStudy.correctionsHtml && (
                      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
                        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-400">
                          Corrections to your notes
                        </h3>
                        <div
                          className="study-prose text-sm"
                          dangerouslySetInnerHTML={{ __html: selectedStudy.correctionsHtml }}
                        />
                      </div>
                    )}

                    {selectedStudy.renderedHtml ? (
                      <article
                        className="study-prose"
                        dangerouslySetInnerHTML={{ __html: selectedStudy.renderedHtml }}
                      />
                    ) : (
                      <p className="text-sm text-fg-subtle">
                        This report was still {selectedStudy.status} when the offline snapshot was taken.
                      </p>
                    )}

                    {selectedStudy.sources.length > 0 && (
                      <div className="border-t border-ink-700 pt-4">
                        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                          Pages searched &amp; referenced ({selectedStudy.sources.length})
                        </h3>
                        <p className="mb-2 text-xs text-fg-subtle">
                          Pages retrieved while building this report; verify key figures against primary filings before acting.
                        </p>
                        <ul className="space-y-1 text-xs">
                          {selectedStudy.sources.map((src, idx) => (
                            <li key={idx}>
                              <a
                                href={src.url}
                                target="_blank"
                                rel="noopener noreferrer nofollow"
                                className="text-emerald-400 hover:underline"
                              >
                                {src.title}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ) : snapshot.studies.length === 0 ? (
                <p className="card p-6 text-sm text-fg-subtle">No case studies saved in this snapshot yet.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {snapshot.studies.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedStudyId(s.id)}
                      className="card p-4 text-left transition-colors hover:border-emerald-500/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-lg font-bold text-slate-100">{s.ticker}</span>
                        <div className="flex items-center gap-2">
                          {s.gradeLetter && (
                            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-400">
                              {s.gradeLetter}
                            </span>
                          )}
                          <StatusBadge status={s.status as "ready" | "queued" | "building" | "error"} />
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-fg-subtle">
                        {s.company ?? s.ticker} · {variantLabel(s.variant)}
                        {s.asOfDate ? ` · As of ${s.asOfDate}` : ""}
                      </p>
                      {s.summaryLine && (
                        <p className="mt-2 line-clamp-2 text-xs text-slate-300">{s.summaryLine}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "watchlist" && (
            <div className="space-y-3">
              {snapshot.watchlist.length === 0 ? (
                <p className="card p-6 text-sm text-fg-subtle">Your watchlist is empty in this snapshot.</p>
              ) : (
                snapshot.watchlist.map((w) => (
                  <div key={w.id} className="card p-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono text-lg font-bold text-slate-100">{w.ticker}</span>
                        {w.company && <span className="text-sm text-fg-subtle">{w.company}</span>}
                        <ThesisStatusBadge status={w.thesisStatus} />
                      </div>
                      {w.asOfDate && <span className="text-xs text-fg-subtle">As of {w.asOfDate}</span>}
                    </div>
                    {w.thesis ? (
                      <p className="text-sm text-slate-200">{w.thesis}</p>
                    ) : (
                      <p className="text-xs text-fg-subtle">Entry was queued when this snapshot synced.</p>
                    )}
                    {w.thesisStatusNote && (
                      <p className="text-xs text-slate-400">Latest note: {w.thesisStatusNote}</p>
                    )}
                    {w.triggers.length > 0 && (
                      <ul className="list-disc pl-5 text-xs text-fg-subtle space-y-0.5">
                        {w.triggers.map((trig, i) => (
                          <li key={i}>{trig}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "journal" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {stats && (
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span className="text-slate-300">
                      Realized P&amp;L:{" "}
                      <strong className={stats.net >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {money(stats.net)}
                      </strong>
                    </span>
                    <span className="text-fg-subtle">Closed lots: {stats.closed}</span>
                    <span className="text-fg-subtle">Open lots: {stats.open}</span>
                  </div>
                )}
                <Link href="/journal" className="btn-secondary px-3 py-1.5 text-xs">
                  Log trade (works offline)
                </Link>
              </div>
              {snapshot.journal.length === 0 ? (
                <p className="card p-6 text-sm text-fg-subtle">No journal lots cached yet.</p>
              ) : (
                <div className="card overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-ink-700 text-fg-subtle">
                      <tr>
                        <th className="px-4 py-2.5">Ticker</th>
                        <th className="px-4 py-2.5">Asset</th>
                        <th className="px-4 py-2.5">Qty</th>
                        <th className="px-4 py-2.5">Opened</th>
                        <th className="px-4 py-2.5">Entry</th>
                        <th className="px-4 py-2.5">Closed</th>
                        <th className="px-4 py-2.5 text-right">Realized P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-800">
                      {snapshot.journal.map((row) => {
                        const pnl = realizedPnl(row);
                        return (
                          <tr key={row.id}>
                            <td className="px-4 py-2.5 font-mono font-semibold text-slate-100">{row.ticker}</td>
                            <td className="px-4 py-2.5 text-slate-300">
                              {row.asset === "stock"
                                ? `${row.side} stock`
                                : `${row.asset.toUpperCase()} $${row.strike} ${row.expiration}`}
                            </td>
                            <td className="px-4 py-2.5 text-slate-300">{row.quantity}</td>
                            <td className="px-4 py-2.5 text-fg-subtle">{row.opened_on}</td>
                            <td className="px-4 py-2.5 text-slate-300">${row.entry_price}</td>
                            <td className="px-4 py-2.5 text-fg-subtle">{row.closed_on ?? "Open"}</td>
                            <td
                              className={`px-4 py-2.5 text-right font-mono ${
                                pnl == null
                                  ? "text-fg-subtle"
                                  : pnl >= 0
                                    ? "text-emerald-400"
                                    : "text-red-400"
                              }`}
                            >
                              {pnl == null ? "—" : money(pnl)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === "leaps" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-fg-subtle">
                  Black-Scholes scenario modeling runs locally in your browser even while offline.
                </p>
                <Link href="/leaps" className="btn-secondary px-3 py-1.5 text-xs">
                  Open LEAPS calculator
                </Link>
              </div>
              {snapshot.leapsPlans.length === 0 ? (
                <p className="card p-6 text-sm text-fg-subtle">No saved LEAPS scenarios in this snapshot.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {snapshot.leapsPlans.map((p) => (
                    <div key={p.id} className="card p-4 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-100">{p.name}</span>
                        <span className="font-mono text-xs text-emerald-400">{p.ticker}</span>
                      </div>
                      <p className="text-xs text-fg-subtle">
                        {String(p.inputs?.type ?? "").toUpperCase()} · Strike ${String(p.inputs?.strike ?? "—")} · Exp{" "}
                        {String(p.inputs?.expiration ?? "—")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "signals" && (
            <div className="space-y-3">
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-slate-300">
                Historical snapshot of trader calls — not live market prices and not personalized financial advice.
              </p>
              {snapshot.signals.map((sig) => (
                <div key={sig.id} className="card p-4 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold text-slate-100">
                      {sig.action} {sig.ticker} {sig.instrument ?? ""}
                    </span>
                    <span className="text-xs text-fg-subtle">
                      #{sig.id} · {new Date(sig.postedAt).toLocaleString("en-US")}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">{sig.detail || "No additional notes."}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
