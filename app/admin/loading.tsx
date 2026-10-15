export default function AdminLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <p className="text-sm text-fg-subtle">Loading admin data…</p>
      <div
        aria-hidden
        className="grid animate-pulse grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card h-28 bg-ink-800/50" />
        ))}
      </div>
      <div aria-hidden className="card h-64 animate-pulse bg-ink-800/50" />
    </div>
  );
}
