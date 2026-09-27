"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import Tooltip from "@/components/guide/Tooltip";
import { apiError, creditCost } from "@/lib/shared";

// Re-queues a failed study. `compact` is the icon-only form for dashboard
// cards; the full form sits in the study page's error box.
export default function RetryStudyButton({
  id,
  ticker,
  variant,
  compact = false,
}: {
  id: number;
  ticker: string;
  variant: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cost = creditCost(variant);
  const costLabel = `${cost} credit${cost === 1 ? "" : "s"}`;

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/case-studies/${id}/retry`, { method: "POST" });
      if (!res.ok) setError(await apiError(res, "Couldn't retry this study"));
      else router.refresh();
    } catch {
      setError("Couldn't retry this study");
    } finally {
      setBusy(false);
    }
  }

  const errorText = error && (
    <p role="alert" className={`text-xs text-red-400 ${compact ? "max-w-[14rem] text-right" : ""}`}>
      {error}
    </p>
  );

  if (compact) {
    return (
      <div className="flex flex-row-reverse items-center gap-2">
        <Tooltip align="end" text={`Queue it again (${costLabel})`}>
          <button
            type="button"
            onClick={retry}
            disabled={busy}
            aria-label={`Retry ${ticker}`}
            className="icon-btn bg-ink-900 hover:border-emerald-500/50 hover:text-emerald-400"
          >
            <RotateCcw className={`h-4 w-4 ${busy ? "motion-safe:animate-spin" : ""}`} aria-hidden />
          </button>
        </Tooltip>
        {errorText}
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" onClick={retry} disabled={busy} className="btn-secondary px-3 py-2 text-sm">
        <RotateCcw className={`h-4 w-4 text-emerald-400 ${busy ? "motion-safe:animate-spin" : ""}`} aria-hidden />
        {busy ? "Queuing…" : `Try again · ${costLabel}`}
      </button>
      {errorText}
    </div>
  );
}
