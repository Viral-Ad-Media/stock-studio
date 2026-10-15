"use client";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin page failed", error);
  }, [error]);
  return (
    <section role="alert" className="card mx-auto max-w-xl p-8">
      <AlertTriangle className="mb-4 h-6 w-6 text-amber-400" aria-hidden />
      <h1 className="text-xl font-semibold text-slate-100">
        Unable to load this admin view
      </h1>
      <p className="mt-3 text-sm text-fg-subtle">
        The latest data could not be loaded. Try again; if it continues, check
        the service logs and database connection.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs text-fg-subtle">Reference: {error.digest}</p>
      )}
      <button onClick={reset} className="btn-primary mt-5 px-4 py-2">
        Try again
      </button>
    </section>
  );
}
