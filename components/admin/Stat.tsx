export default function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "warn" | "bad" }) {
  const toneCls = tone === "bad" ? "border-red-500/40" : tone === "warn" ? "border-amber-500/40" : "";
  return (
    <div className={`card p-4 ${toneCls}`}>
      <div className="text-xs text-fg-subtle">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-100">{value}</div>
      {hint && <div className="mt-1 text-xs text-fg-subtle">{hint}</div>}
    </div>
  );
}
