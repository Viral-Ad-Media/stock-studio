import { Clock, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { STATUS_LABELS } from "@/lib/shared";

// Status is shown as icon + word, never color alone (WCAG 1.4.1).
const STYLES: Record<string, { cls: string; Icon: typeof Clock }> = {
  queued: { cls: "bg-amber-500/10 text-amber-400 border-amber-500/30", Icon: Clock },
  building: { cls: "bg-sky-500/10 text-sky-400 border-sky-500/30", Icon: Loader2 },
  ready: { cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", Icon: CheckCircle2 },
  error: { cls: "bg-red-500/10 text-red-400 border-red-500/30", Icon: AlertTriangle },
};

export default function StatusBadge({ status }: { status: string }) {
  const s = STYLES[status] ?? STYLES.queued;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${s.cls}`}>
      <s.Icon className={`h-3 w-3 ${status === "building" ? "motion-safe:animate-spin" : ""}`} aria-hidden />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
