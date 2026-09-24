// Shown while an app page's server data loads (every app page queries the DB).
export default function Loading() {
  return (
    <div role="status" aria-label="Loading">
      <div className="mb-6 h-8 w-48 rounded-lg bg-ink-800 motion-safe:animate-pulse" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-ink-900 border border-ink-700 motion-safe:animate-pulse" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
