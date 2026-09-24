"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Terminal, X, Newspaper } from "lucide-react";

export type QueueJob = {
  id: number;
  type: string;
  status: string;
  created_at: string;
  ticker: string | null;
  variant: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  build_case_study: "Case study",
  earnings_update: "Earnings reaction",
  watchlist_entry: "Watchlist entry",
  movers_digest: "Movers digest",
};

export default function QueuePanel({ jobs }: { jobs: QueueJob[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | "movers" | null>(null);

  async function removeJob(id: number) {
    setBusy(id);
    const res = await fetch(`/api/jobs?id=${id}`, { method: "DELETE" });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? "Couldn't remove the job");
    setBusy(null);
    router.refresh();
  }

  async function queueMovers() {
    setBusy("movers");
    const res = await fetch("/api/case-studies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: "MARKET", variant: "movers_digest" }),
    });
    if (!res.ok && res.status !== 409) alert("Could not queue the digest");
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="mb-6 space-y-3">
      <div className="flex justify-end">
        <button
          onClick={queueMovers}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-ink-600 bg-ink-800 hover:border-ink-500 text-slate-300 disabled:opacity-50"
        >
          <Newspaper className="w-3.5 h-3.5 text-emerald-400" />
          {busy === "movers" ? "Queuing…" : "Queue today's movers digest"}
        </button>
      </div>

      {jobs.length > 0 && (
        <div className="card border-amber-500/30">
          <div className="p-4 pb-2 flex items-center gap-3">
            <Terminal className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="text-sm">
              <span className="text-amber-400 font-medium">
                {jobs.length} job{jobs.length > 1 ? "s" : ""} in the queue.
              </span>{" "}
              <span className="text-slate-400">
                Run <code className="text-emerald-400">/build-studies</code> in Claude Code to drain it.
              </span>
            </div>
          </div>
          <ul className="px-4 pb-3 divide-y divide-ink-800">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-center justify-between py-2 text-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-slate-200">{j.ticker ?? "—"}</span>
                  <span className="text-slate-500 truncate">
                    {TYPE_LABELS[j.type] ?? j.type}
                    {j.status === "running" && (
                      <span className="text-sky-400"> · building now</span>
                    )}
                  </span>
                </div>
                {j.status === "pending" && (
                  <button
                    onClick={() => removeJob(j.id)}
                    disabled={busy !== null}
                    title="Remove from queue"
                    className="p-1 rounded-md border border-ink-600 text-slate-500 hover:border-red-500/50 hover:text-red-400 disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
