"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { VARIANTS, HIDDEN_FORM_VARIANTS, MAX_NOTES, creditCost, apiError } from "@/lib/shared";
import PageHeader from "@/components/ui/PageHeader";
import Link from "next/link";

export type ExistingStudy = { id: number; status: string };

// `initial*` pre-fill the form (e.g. "New study for AAPL" on a study page);
// `existing` maps each format already built or queued for the pre-filled
// ticker, so the format cards can say which ones you already have.
export default function NewStudyForm({
  initialTicker = "",
  initialCompany = "",
  initialVariant = "full",
  existing = {},
  allowed = null,
}: {
  initialTicker?: string;
  initialCompany?: string;
  initialVariant?: string;
  existing?: Record<string, ExistingStudy>;
  // Formats the member's plan can queue; null = all (lib/plans.ts).
  allowed?: readonly string[] | null;
}) {
  const router = useRouter();
  const [ticker, setTicker] = useState(initialTicker);
  const [company, setCompany] = useState(initialCompany);
  const [variant, setVariant] = useState(initialVariant);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/case-studies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, company, variant, notes }),
      });
      if (res.ok) {
        router.push("/dashboard");
        router.refresh();
        return;
      }
      setError(await apiError(res, "Something went wrong"));
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    }
    setBusy(false);
  }

  const formats = VARIANTS.filter((v) => !HIDDEN_FORM_VARIANTS.includes(v.value));
  // Only meaningful while the ticker is still the one the page was opened for.
  const have = ticker.trim() === initialTicker && initialTicker ? existing : {};

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={initialTicker ? `New study for ${initialTicker}` : "New case study"}
        description="Queues a report for the research engine. Credits are refunded automatically if the build fails."
      />

      <form onSubmit={submit} className="card p-4 sm:p-6 space-y-5" aria-describedby={error ? "new-error" : undefined}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ticker" className="field-label">
              Ticker <span aria-hidden>*</span>
            </label>
            <input
              id="ticker"
              required
              autoComplete="off"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="NVDA, or AAPL vs MSFT"
              aria-describedby="ticker-hint"
              className="input font-mono"
            />
            <p id="ticker-hint" className="mt-1 text-xs text-fg-subtle">
              For comparisons, separate tickers with “vs”.
            </p>
          </div>
          <div>
            <label htmlFor="company" className="field-label">
              Company (optional)
            </label>
            <input
              id="company"
              maxLength={200}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="NVIDIA Corporation"
              className="input"
            />
          </div>
        </div>

        <fieldset>
          <legend className="field-label mb-2">Format</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {formats.map((v) => {
              const locked = allowed != null && !allowed.includes(v.value);
              return (
              <label
                key={v.value}
                className={`relative flex gap-3 rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-emerald-400 ${
                  locked ? "cursor-not-allowed border-ink-600 opacity-60"
                  : variant === v.value ? "cursor-pointer border-emerald-500 bg-emerald-500/10" : "cursor-pointer border-ink-500 bg-ink-800 hover:border-slate-400"
                }`}
              >
                <input
                  type="radio"
                  name="variant"
                  value={v.value}
                  checked={variant === v.value}
                  disabled={locked}
                  onChange={() => setVariant(v.value)}
                  className="sr-only"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-200">{v.label}{locked && <span className="ml-2 text-xs font-normal text-amber-300">Gold and Diamond</span>}</span>
                  <span className="mt-0.5 block text-xs text-fg-subtle">{v.hint}</span>
                  {have[v.value] && (
                    <span className="mt-1 block text-xs text-sky-400">
                      {have[v.value].status === "ready" ? "You already have this one" : "Already queued"}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-slate-400">
                  {creditCost(v.value)} cr
                </span>
              </label>
              );
            })}
          </div>
          {allowed != null && formats.some((v) => !allowed.includes(v.value)) && (
            <p className="mt-2 text-xs text-fg-subtle">
              Your plan includes quick takes, full studies and comparisons.{" "}
              <Link href="/billing?plan=gold" className="text-emerald-400 underline-offset-2 hover:underline">Upgrade to Gold</Link> for every format.
            </p>
          )}
        </fieldset>

        <div>
          <label htmlFor="notes" className="field-label">
            Raw notes (optional — the engine fact-checks these and flags corrections)
          </label>
          <textarea
            id="notes"
            value={notes}
            maxLength={MAX_NOTES}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            placeholder="e.g. Revenue accelerating 5 quarters straight, data center demand insane, moat = CUDA…"
            aria-describedby="notes-count"
            className="input"
          />
          <p id="notes-count" className="mt-1 text-right text-xs tabular-nums text-fg-subtle">
            {notes.length.toLocaleString()} / {MAX_NOTES.toLocaleString()}
          </p>
        </div>

        {error && (
          <p id="new-error" role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <button disabled={busy || !ticker.trim()} className="btn-primary w-full text-sm px-5 py-2.5 sm:w-auto">
          {busy ? "Queuing…" : `Queue report · ${creditCost(variant)} credits`}
        </button>
      </form>
    </div>
  );
}
