import { ShieldCheck, TrendingDown, XOctagon, HelpCircle } from "lucide-react";

// Icon + word, never color alone.
const STYLES = {
  intact: { label: "Thesis intact", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", Icon: ShieldCheck },
  weakening: { label: "Thesis weakening", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30", Icon: TrendingDown },
  broken: { label: "Thesis broken", cls: "bg-red-500/10 text-red-400 border-red-500/30", Icon: XOctagon },
  unknown: { label: "Not yet re-checked", cls: "bg-ink-800 text-fg-subtle border-ink-600", Icon: HelpCircle },
} as const;

export default function ThesisStatusBadge({ status }: { status: string }) {
  const s = STYLES[status as keyof typeof STYLES] ?? STYLES.unknown;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${s.cls}`}>
      <s.Icon className="h-3 w-3" aria-hidden />
      {s.label}
    </span>
  );
}
