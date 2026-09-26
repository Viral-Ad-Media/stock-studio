"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiError } from "@/lib/shared";

// Fail a pending or stuck job and refund its credits, with a required note.
export default function FailJobButton({ jobId }: { jobId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fail", note }),
      });
      if (!res.ok) {
        setError(await apiError(res, "Couldn't fail the job."));
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary px-3 py-1.5 text-xs">
        Fail and refund
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor={`fail-note-${jobId}`} className="sr-only">Reason for failing job {jobId}</label>
        <input
          id={`fail-note-${jobId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason"
          required
          minLength={3}
          maxLength={500}
          className="input h-8 w-44 py-1 text-xs"
          autoFocus
        />
      </div>
      <button type="submit" disabled={busy} className="btn-primary px-3 py-1.5 text-xs">{busy ? "Failing…" : "Confirm"}</button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-fg-subtle hover:text-slate-200">Cancel</button>
      {error && <p role="alert" className="w-full text-xs text-red-400">{error}</p>}
    </form>
  );
}
