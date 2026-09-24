"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X, Newspaper } from "lucide-react";
import { apiError } from "@/lib/shared";

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
  const [error, setError] = useState<string | null>(null);

  async function run(key: number | "movers", request: () => Promise<Response>, fallback: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await request();
      if (!res.ok) setError(await apiError(res, fallback));
    } catch {
      setError(fallback);
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  const removeJob = (id: number) =>
    run(id, () => fetch(`/api/jobs?id=${id}`, { method: "DELETE" }), "Couldn't remove the job");

  const queueMovers = () =>
    run(
      "movers",
      () =>
        fetch("/api/case-studies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: "MARKET", variant: "movers_digest" }),
        }),
      "Couldn't queue the digest"
    );

  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-3">
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <button onClick={queueMovers} disabled={busy !== null} className="btn-secondary text-sm px-3 py-2">
          <Newspaper className="h-4 w-4 text-emerald-400" aria-hidden />
          {busy === "movers" ? "Queuing…" : "Queue today's movers digest"}
        </button>
      </div>

      {jobs.length > 0 && (
        <section className="card" aria-labelledby="queue-heading">
          <div className="flex items-center gap-3 p-4 pb-2">
            <Loader2 className="h-5 w-5 shrink-0 text-sky-400 motion-safe:animate-spin" aria-hidden />
            <h2 id="queue-heading" className="text-sm">
              <span className="font-medium text-slate-100">
                {jobs.length} report{jobs.length > 1 ? "s" : ""} in progress.
              </span>{" "}
              <span className="text-slate-400">They usually start within a minute or two.</span>
            </h2>
          </div>
          <ul className="divide-y divide-ink-800 px-4 pb-3">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="font-mono text-slate-200">{j.ticker ?? "—"}</span>
                  <span className="truncate text-fg-subtle">
                    {TYPE_LABELS[j.type] ?? j.type}
                    {j.status === "running" && <span className="text-sky-400"> · building now</span>}
                  </span>
                </div>
                {j.status === "pending" && (
                  <button
                    onClick={() => removeJob(j.id)}
                    disabled={busy !== null}
                    aria-label={`Remove ${j.ticker ?? "job"} from the queue and refund its credits`}
                    title="Remove from queue"
                    className="icon-btn hover:border-red-500/50 hover:text-red-400"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
