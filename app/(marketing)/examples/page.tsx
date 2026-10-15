import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import WorkflowDemo from "@/components/marketing/WorkflowDemo";
import { PUBLIC_EXAMPLE as example } from "@/lib/public-example";
export const metadata = {
  title: "Research example and interactive workflow",
  description:
    "Inspect a dated, source-linked Apple research example and try Stock Studio's research-to-review demonstration.",
  alternates: { canonical: "/examples" },
};
export default function ExamplesPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-12">
      <PageHeader
        eyebrow="Evidence before assumptions"
        title="See the research. Try the workflow."
        description="A public editorial research excerpt and an interactive product demonstration. Reported company facts and hypothetical trading assumptions are labeled separately."
      />
      <article className="card space-y-5 p-5 sm:p-8">
        <div>
          <p className="desk-eyebrow">
            Dated public research example · {example.ticker}
          </p>
          <h2 className="text-2xl font-semibold">
            Apple: evidence, then open questions
          </h2>
          <p className="mt-2 text-sm text-fg-subtle">
            {example.period} · information as of {example.asOf} · sources
            checked {example.reviewedOn}
          </p>
          <p className="mt-2 text-xs text-amber-300">
            Historical educational excerpt, manually prepared. It is not a
            current recommendation, a complete valuation or a claim of
            investment performance.
          </p>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="metric-tile">
            <dt className="text-sm text-fg-subtle">
              Reported quarterly revenue
            </dt>
            <dd className="mt-2 text-2xl font-semibold">
              ${example.revenueBillion} billion
            </dd>
          </div>
          <div className="metric-tile">
            <dt className="text-sm text-fg-subtle">
              Reported revenue growth, year over year
            </dt>
            <dd className="mt-2 text-2xl font-semibold">
              {example.growthPercent}%
            </dd>
          </div>
        </dl>
        <p className="text-sm text-slate-300">
          Apple’s release documents higher quarterly sales. That fact alone does
          not show whether the shares or a long-dated option offer an attractive
          price.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <section>
            <h3 className="font-medium">Research hypothesis to test</h3>
            <p className="mt-2 text-sm text-fg-subtle">
              Determine whether growth can continue while sustaining margins.
              Check subsequent filings before treating this historical
              observation as current.
            </p>
          </section>
          <section>
            <h3 className="font-medium">Bear case and missing evidence</h3>
            <p className="mt-2 text-sm text-fg-subtle">
              Weaker demand or margin pressure could undermine that hypothesis.
              This excerpt supplies no current share price, valuation estimate,
              option quote or probability of profit.
            </p>
          </section>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <a
            className="text-emerald-400 underline"
            href={example.source}
            target="_blank"
            rel="noopener noreferrer"
          >
            Apple earnings release · October 30, 2025
          </a>
          <a
            className="text-emerald-400 underline"
            href={example.filing}
            target="_blank"
            rel="noopener noreferrer"
          >
            SEC Form 8-K · October 30, 2025
          </a>
        </div>
      </article>
      <WorkflowDemo />
      <div className="flex flex-wrap gap-3">
        <Link className="btn-primary px-5 py-3" href="/signup">
          Start your own research workflow
        </Link>
        <Link className="btn-secondary px-5 py-3" href="/pricing">
          View pricing
        </Link>
      </div>
    </div>
  );
}
