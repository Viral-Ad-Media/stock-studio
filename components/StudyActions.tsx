"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, RefreshCcw, Trash2, Eye } from "lucide-react";
import { apiError } from "@/lib/shared";

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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function copyMd() {
    if (!study.content_md) return;
    try {
      await navigator.clipboard.writeText(study.content_md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy to the clipboard");
    }
  }

  // Runs one action; returns true when the API call succeeded.
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
    }
  }

  async function queueEarningsUpdate() {
    const ok = await act(
      "earnings",
      () =>
        fetch("/api/case-studies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticker: study.ticker,
            company: study.company,
            variant: "earnings_update",
            parent_id: study.id,
          }),
        }),
      "Couldn't queue the update"
    );
    if (ok) {
      setNotice("Earnings update queued.");
      router.refresh();
    }
  }

  async function addToWatchlist() {
    const ok = await act(
      "watch",
      () =>
        fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: study.ticker, company: study.company, case_study_id: study.id }),
        }),
      "Couldn't add to the watchlist"
    );
    if (ok) router.push("/watchlist");
  }

  async function remove() {
    if (!confirm(`Delete the ${study.ticker} study? This can't be undone.`)) return;
    const ok = await act("delete", () => fetch(`/api/case-studies/${study.id}`, { method: "DELETE" }), "Couldn't delete the study");
    if (ok) {
      router.push("/dashboard");
      router.refresh();
    }
  }

  const btn = "btn-secondary text-sm px-3 py-2";

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {study.status === "ready" && (
          <>
            <button onClick={copyMd} className={btn}>
              {copied ? <Check className="h-4 w-4 text-emerald-400" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
              {copied ? "Copied" : "Copy markdown"}
            </button>
            <button onClick={queueEarningsUpdate} disabled={busy !== null} className={btn}>
              <RefreshCcw className="h-4 w-4" aria-hidden />
              {busy === "earnings" ? "Queuing…" : "Queue earnings update"}
            </button>
            <button onClick={addToWatchlist} disabled={busy !== null} className={btn}>
              <Eye className="h-4 w-4" aria-hidden />
              {busy === "watch" ? "Adding…" : "Add to watchlist"}
            </button>
          </>
        )}
        <button onClick={remove} disabled={busy !== null} className={`${btn} hover:border-red-500/50 hover:text-red-400`}>
          <Trash2 className="h-4 w-4" aria-hidden /> {busy === "delete" ? "Deleting…" : "Delete"}
        </button>
      </div>
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
  );
}
