"use client";

import { useEffect } from "react";

// Styled fallback when an app page fails to load (e.g. a database hiccup),
// instead of Next's default error screen.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="card p-8 text-center">
      <h1 className="mb-2 text-lg font-semibold text-slate-100">Couldn't load this page</h1>
      <p className="mb-5 text-sm text-slate-400">
        Something went wrong on our side. Your reports and credits are safe — try again in a moment.
      </p>
      <button onClick={reset} className="btn-primary text-sm px-4 py-2">
        Try again
      </button>
    </div>
  );
}
