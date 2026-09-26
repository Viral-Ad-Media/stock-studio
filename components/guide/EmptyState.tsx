import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Lightbulb } from "lucide-react";

// Guide shown on a blank screen: what goes here, how to add the first item,
// and a few tips. Tips are plain facts about the feature, never advice.
export default function EmptyState({
  icon: Icon,
  title,
  body,
  tips,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  tips: string[];
  action?: { href: string; label: string } | React.ReactNode;
}) {
  return (
    <section className="card p-6 sm:p-10" aria-labelledby="empty-title">
      <div className="mx-auto max-w-xl text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
          <Icon className="h-6 w-6 text-emerald-400" aria-hidden />
        </span>
        <h2 id="empty-title" className="mt-4 text-lg font-semibold text-slate-100">
          {title}
        </h2>
        <p className="mt-2 text-sm text-slate-300">{body}</p>
        {action && typeof action === "object" && "href" in (action as object) ? (
          <Link href={(action as { href: string }).href} className="btn-primary mt-5 px-5 py-2.5 text-sm">
            {(action as { label: string }).label}
          </Link>
        ) : (
          action && <div className="mt-5">{action as React.ReactNode}</div>
        )}
      </div>
      <div className="mx-auto mt-8 max-w-xl rounded-lg border border-ink-600 bg-ink-800/60 p-4">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
          <Lightbulb className="h-4 w-4 text-amber-300" aria-hidden /> Tips
        </h3>
        <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
          {tips.map((t) => (
            <li key={t} className="flex gap-2">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" aria-hidden />
              {t}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
