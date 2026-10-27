"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { apiError } from "@/lib/shared";

// Pulls fresh market data (free, no credits) for one study, one watchlist
// row, or everything, then re-renders the page. `auto` runs it once on mount,
// for a study page whose stored quote is missing or stale.
export default function LiveRefreshButton({
  scope,
  id,
  label = "Refresh live data",
  auto = false,
  compact = false,
}: {
  scope: "study" | "watchlist" | "all";
  id?: number;
  label?: string;
  auto?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ran = useRef(false);

  async function refresh(quiet = false) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/live-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, id }),
      });
      if (!res.ok) {
        if (!quiet) setError(await apiError(res, "Couldn't refresh market data"));
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (!quiet && scope === "all") {
        const failed: string[] = body.failed ?? [];
        setNotice(
          body.upToDate
            ? "Everything was refreshed in the last minute."
            : `Updated ${body.refreshed} ${body.refreshed === 1 ? "item" : "items"}${failed.length ? `; no data for ${failed.join(", ")}` : ""}.`,
        );
      }
      router.refresh();
    } catch {
      if (!quiet) setError("Couldn't refresh market data");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (auto && !ran.current) {
      ran.current = true;
      void refresh(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  const icon = <RefreshCw className={`h-4 w-4 text-emerald-400 ${busy ? "motion-safe:animate-spin" : ""}`} aria-hidden />;

  return (
    <div className={`flex flex-col gap-1 ${compact ? "items-end" : "items-start"}`}>
      <button
        type="button"
        onClick={() => refresh()}
        disabled={busy}
        className={compact ? "btn-secondary px-2.5 py-1.5 text-xs" : "btn-secondary px-3 py-2 text-sm"}
      >
        {icon}
        {busy ? "Refreshing…" : label}
      </button>
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-emerald-400">
          {notice}
        </p>
      )}
    </div>
  );
}
