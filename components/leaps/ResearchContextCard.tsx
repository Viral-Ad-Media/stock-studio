import Link from "next/link";
import type { ResearchContext } from "@/lib/research-workflow";
export default function ResearchContextCard({
  context,
}: {
  context: ResearchContext;
}) {
  if (!context.studyId && !context.watchlistId && !context.contractSymbol)
    return null;
  return (
    <section className="card p-5">
      <p className="desk-eyebrow">Research behind this decision</p>
      <div className="flex flex-wrap gap-4 text-sm">
        {context.studyId && (
          <Link
            className="text-emerald-400 underline"
            href={`/study/${context.studyId}`}
          >
            Linked company research #{context.studyId}
          </Link>
        )}
        {context.watchlistId && (
          <Link
            className="text-emerald-400 underline"
            href={`/watchlist#thesis-${context.watchlistId}`}
          >
            Tracked thesis
          </Link>
        )}
        {context.contractSymbol && (
          <span className="font-mono text-fg-subtle">
            {context.contractSymbol}
          </span>
        )}
      </div>
      {context.thesis && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">
          {context.thesis}
        </p>
      )}
      <p className="mt-2 text-xs text-fg-subtle">
        A thesis is a research hypothesis, not a trading instruction. Recheck
        its sources before acting.
      </p>
    </section>
  );
}
