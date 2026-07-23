"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCcw, Trash2, Plus } from "lucide-react";
import type { WatchlistRow } from "@/lib/shared";

const TAGS = [
  { value: "watching", label: "Watching", cls: "bg-sky-500/10 text-sky-400 border-sky-500/30" },
  { value: "building_conviction", label: "Building conviction", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  { value: "pass", label: "Pass", cls: "bg-red-500/10 text-red-400 border-red-500/30" },
];

export default function WatchlistClient({ rows }: { rows: WatchlistRow[] }) {
  const router = useRouter();
  const [ticker, setTicker] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker }),
    });
    setTicker("");
    setBusy(false);
    router.refresh();
  }

  async function setTag(id: number, status_tag: string) {
    await fetch("/api/watchlist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status_tag }),
    });
    router.refresh();
  }

  async function refreshRow(id: number) {
    await fetch("/api/watchlist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, requeue: true }),
    });
    router.refresh();
  }

  async function remove(id: number, t: string) {
    if (!confirm(`Remove ${t} from the watchlist?`)) return;
    await fetch(`/api/watchlist?id=${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div>
      <form onSubmit={add} className="flex gap-2 mb-6">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="Add ticker (e.g. PLTR)"
          className="bg-ink-800 border border-ink-600 rounded-lg px-3 py-2 text-sm font-mono w-64 focus:outline-none focus:border-emerald-500"
        />
        <button
          disabled={busy || !ticker.trim()}
          className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="card p-10 text-center text-slate-500 text-sm">
          Nothing tracked yet. Add a ticker — the engine writes the thesis, snapshot, and triggers.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const triggers: string[] = r.triggers_json ?? [];
            return (
              <div key={r.id} className="card p-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-slate-100">{r.ticker}</span>
                    <span className="text-sm text-slate-500">{r.company ?? ""}</span>
                    {r.as_of_date && (
                      <span className="text-[11px] text-slate-600">as of {r.as_of_date}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={r.status_tag}
                      onChange={(e) => setTag(r.id, e.target.value)}
                      className={`text-[11px] px-2 py-1 rounded-full border bg-ink-800 ${
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
                      onClick={() => refreshRow(r.id)}
                      title="Queue a refresh for the engine"
                      className="p-1.5 rounded-lg border border-ink-600 hover:border-ink-500 text-slate-400"
                    >
                      <RefreshCcw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => remove(r.id, r.ticker)}
                      className="p-1.5 rounded-lg border border-ink-600 hover:border-red-500/50 text-slate-400 hover:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {r.snapshot && <p className="text-sm text-slate-400 mb-1">{r.snapshot}</p>}
                {r.thesis ? (
                  <p className="text-sm text-slate-300">{r.thesis}</p>
                ) : (
                  <p className="text-sm text-amber-400/70">
                    Waiting for the engine — run <code>/build-studies</code>.
                  </p>
                )}
                {triggers.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {triggers.map((t, i) => (
                      <li key={i} className="text-[13px] text-slate-500">
                        ▸ {t}
                      </li>
                    ))}
                  </ul>
                )}
                {r.case_study_id && (
                  <Link
                    href={`/study/${r.case_study_id}`}
                    className="inline-block mt-2 text-[13px] text-emerald-400 hover:underline"
                  >
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
