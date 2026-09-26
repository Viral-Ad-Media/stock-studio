"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCcw, Trash2, Plus } from "lucide-react";
import { apiError, formatDate, type WatchlistRow } from "@/lib/shared";
import ThesisStatusBadge from "@/components/insights/ThesisStatusBadge";

export type ThesisHistoryEntry = {
  id: number;
  watchlist_id: number;
  as_of_date: string | null;
  thesis: string;
  thesis_status: string;
  thesis_status_note: string | null;
  created_at: string;
};

const TAGS = [
  { value: "watching", label: "Watching", cls: "bg-sky-500/10 text-sky-400 border-sky-500/30" },
  { value: "building_conviction", label: "Building conviction", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  { value: "pass", label: "Pass", cls: "bg-red-500/10 text-red-400 border-red-500/30" },
];

export default function WatchlistClient({
  rows,
  history = {},
}: {
  rows: WatchlistRow[];
  history?: Record<number, ThesisHistoryEntry[]>;
}) {
  const router = useRouter();
  const [ticker, setTicker] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function act(key: string, request: () => Promise<Response>, fallback: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await request();
      if (!res.ok) {
        setError(await apiError(res, fallback));
        return false;
      }
      return true;
    } catch {
      setError(fallback);
      return false;
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  const patch = (body: object) =>
    fetch("/api/watchlist", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const ok = await act(
      "add",
      () => fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker }) }),
      "Couldn't add ticker"
    );
    if (ok) {
      setNotice(`${ticker.trim()} added. The research engine is writing its entry.`);
      setTicker("");
    }
  }

  async function refreshRow(id: number, t: string) {
    if (await act(`refresh-${id}`, () => patch({ id, requeue: true }), "Couldn't queue a refresh")) {
      setNotice(`Refresh queued for ${t}.`);
    }
  }

  async function remove(id: number, t: string) {
    if (!confirm(`Remove ${t} from the watchlist?`)) return;
    await act(`remove-${id}`, () => fetch(`/api/watchlist?id=${id}`, { method: "DELETE" }), "Couldn't remove ticker");
  }

  return (
    <div>
      <form onSubmit={add} className="mb-3 flex flex-wrap gap-2">
        <label htmlFor="watch-ticker" className="sr-only">
          Ticker to track
        </label>
        <input
          id="watch-ticker"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="Add ticker (e.g. PLTR)"
          className="input min-w-0 flex-1 font-mono sm:w-64 sm:flex-none"
        />
        <button disabled={busy !== null || !ticker.trim()} className="btn-primary text-sm px-4 py-2">
          <Plus className="h-4 w-4" aria-hidden /> {busy === "add" ? "Adding…" : "Add"}
        </button>
      </form>
      <div className="mb-6 min-h-[1.25rem]">
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-emerald-400">
            {notice}
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="card p-10 text-center text-fg-subtle text-sm">
          Nothing tracked yet. Add a ticker — the engine writes the thesis, snapshot, and triggers.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const triggers: string[] = r.triggers_json ?? [];
            // Earlier versions only — the first entry is the current thesis.
            const past = (history[r.id] ?? []).slice(1);
            return (
              <div key={r.id} className="card p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono font-bold text-slate-100">{r.ticker}</span>
                    {r.company && <span className="truncate text-sm text-fg-subtle">{r.company}</span>}
                    {r.as_of_date && <span className="text-xs text-fg-subtle">as of {r.as_of_date}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor={`tag-${r.id}`} className="sr-only">
                      Status for {r.ticker}
                    </label>
                    <select
                      id={`tag-${r.id}`}
                      value={r.status_tag}
                      disabled={busy !== null}
                      onChange={(e) => act(`tag-${r.id}`, () => patch({ id: r.id, status_tag: e.target.value }), "Couldn't update the status")}
                      className={`h-9 rounded-lg border bg-ink-800 pl-2 pr-7 text-xs ${
                        TAGS.find((t) => t.value === r.status_tag)?.cls ?? ""
                      }`}
                    >
                      {TAGS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => refreshRow(r.id, r.ticker)}
                      disabled={busy !== null}
                      aria-label={`Refresh ${r.ticker}`}
                      title="Queue a refresh"
                      className="icon-btn hover:border-slate-400"
                    >
                      <RefreshCcw className={`h-4 w-4 ${busy === `refresh-${r.id}` ? "motion-safe:animate-spin" : ""}`} aria-hidden />
                    </button>
                    <button
                      onClick={() => remove(r.id, r.ticker)}
                      disabled={busy !== null}
                      aria-label={`Remove ${r.ticker} from the watchlist`}
                      title="Remove"
                      className="icon-btn hover:border-red-500/50 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
                {r.thesis && (
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <ThesisStatusBadge status={r.thesis_status} />
                    {r.thesis_status_note && <span className="text-sm text-slate-300">{r.thesis_status_note}</span>}
                  </div>
                )}
                {r.snapshot && <p className="mb-1 text-sm text-slate-400">{r.snapshot}</p>}
                {r.thesis ? (
                  <p className="text-sm text-slate-300">{r.thesis}</p>
                ) : (
                  <p className="text-sm text-amber-400">Waiting for the research engine…</p>
                )}
                {triggers.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {triggers.map((t, i) => (
                      <li key={i} className="text-sm text-fg-subtle">
                        ▸ {t}
                      </li>
                    ))}
                  </ul>
                )}
                {past.length > 0 && (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-fg-subtle">
                      Thesis timeline ({past.length} earlier)
                    </summary>
                    <ol className="mt-2 space-y-2 border-l border-ink-600 pl-3">
                      {past.map((h) => (
                        <li key={h.id}>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
                            <span>{h.as_of_date ? `As of ${h.as_of_date}` : formatDate(h.created_at)}</span>
                            <ThesisStatusBadge status={h.thesis_status} />
                          </div>
                          <p className="mt-0.5 text-slate-400">{h.thesis}</p>
                          {h.thesis_status_note && <p className="text-xs text-fg-subtle">{h.thesis_status_note}</p>}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                {r.case_study_id && (
                  <Link href={`/study/${r.case_study_id}`} className="mt-2 inline-block text-sm text-emerald-400 hover:underline">
                    View full case study →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
