"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { VARIANTS, HIDDEN_FORM_VARIANTS, MAX_NOTES, creditCost, apiError } from "@/lib/shared";

export default function NewStudy() {
  const router = useRouter();
  const [ticker, setTicker] = useState("");
  const [company, setCompany] = useState("");
  const [variant, setVariant] = useState("full");
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

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-100 mb-1">New case study</h1>
      <p className="text-sm text-fg-subtle mb-6">
        Queues a report for the research engine. Credits are refunded automatically if the build fails.
      </p>

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
            {formats.map((v) => (
              <label
                key={v.value}
                className={`relative flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-emerald-400 ${
                  variant === v.value ? "border-emerald-500 bg-emerald-500/10" : "border-ink-500 bg-ink-800 hover:border-slate-400"
                }`}
              >
                <input
                  type="radio"
                  name="variant"
                  value={v.value}
                  checked={variant === v.value}
                  onChange={() => setVariant(v.value)}
                  className="sr-only"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-200">{v.label}</span>
                  <span className="mt-0.5 block text-xs text-fg-subtle">{v.hint}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-slate-400">
                  {creditCost(v.value)} cr
                </span>
              </label>
            ))}
          </div>
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
