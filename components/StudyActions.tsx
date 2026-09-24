"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, RefreshCcw, Trash2, Eye } from "lucide-react";

type Props = {
  study: {
    id: number;
    ticker: string;
    company: string | null;
    status: string;
    content_md: string | null;
  };
};

export default function StudyActions({ study }: Props) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function copyMd() {
    if (!study.content_md) return;
    await navigator.clipboard.writeText(study.content_md);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function queueEarningsUpdate() {
    setBusy("earnings");
    await fetch("/api/case-studies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticker: study.ticker,
        company: study.company,
        variant: "earnings_update",
        parent_id: study.id,
      }),
    });
    setBusy(null);
    router.refresh();
  }

  async function addToWatchlist() {
    setBusy("watch");
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: study.ticker, company: study.company, case_study_id: study.id }),
    });
    setBusy(null);
    router.push("/watchlist");
  }

  async function remove() {
    if (!confirm(`Delete the ${study.ticker} study?`)) return;
    await fetch(`/api/case-studies/${study.id}`, { method: "DELETE" });
    router.push("/dashboard");
    router.refresh();
  }

  const btn =
    "inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-ink-600 bg-ink-800 hover:border-ink-500 text-slate-300 disabled:opacity-50";

  return (
    <div className="flex flex-wrap gap-2 justify-end">
      {study.status === "ready" && (
        <>
          <button onClick={copyMd} className={btn}>
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy markdown"}
          </button>
          <button onClick={queueEarningsUpdate} disabled={busy !== null} className={btn}>
            <RefreshCcw className="w-3.5 h-3.5" />
            {busy === "earnings" ? "Queuing…" : "Queue earnings update"}
          </button>
          <button onClick={addToWatchlist} disabled={busy !== null} className={btn}>
            <Eye className="w-3.5 h-3.5" />
            {busy === "watch" ? "Adding…" : "Add to watchlist"}
          </button>
        </>
      )}
      <button onClick={remove} className={`${btn} hover:border-red-500/50 hover:text-red-400`}>
        <Trash2 className="w-3.5 h-3.5" /> Delete
      </button>
    </div>
  );
}
