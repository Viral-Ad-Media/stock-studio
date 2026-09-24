import { notFound } from "next/navigation";
import Link from "next/link";
import { renderMarkdown, safeHttpUrl } from "@/lib/markdown";
import { sql, CaseStudy, VARIANTS, formatDate } from "@/lib/db";
import { currentWorkspaceId } from "@/lib/workspace";
import AutoRefresh from "@/components/AutoRefresh";
import StudyActions from "@/components/StudyActions";
import StatusBadge from "@/components/StatusBadge";
import { ArrowLeft, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function StudyPage({ params }: { params: { id: string } }) {
  const ws = await currentWorkspaceId();
  if (!ws) notFound();

  const [study] = (await sql`
    SELECT * FROM case_studies WHERE id = ${Number(params.id)} AND workspace_id = ${ws}
  `) as unknown as CaseStudy[];
  if (!study) notFound();

  const sources = study.sources_json ?? [];
  const updates = (await sql`
    SELECT * FROM case_studies WHERE parent_id = ${study.id} AND workspace_id = ${ws} ORDER BY id DESC
  `) as unknown as CaseStudy[];
  const variantLabel = VARIANTS.find((v) => v.value === study.variant)?.label ?? study.variant;

  return (
    <div>
      {(study.status === "queued" || study.status === "building") && <AutoRefresh />}
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-fg-subtle hover:text-slate-300 mb-4">
        <ArrowLeft className="w-4 h-4" /> Dashboard
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-100 font-mono flex items-center gap-3">
            {study.ticker} <StatusBadge status={study.status} />
          </h1>
          <p className="text-sm text-fg-subtle">
            {study.company ?? "Company TBD"} · {variantLabel}
            {study.as_of_date && <> · as of {study.as_of_date}</>}
          </p>
        </div>
        <StudyActions study={{ id: study.id, ticker: study.ticker, company: study.company, status: study.status, content_md: study.content_md }} />
      </div>

      {study.status === "queued" && (
        <div className="card p-6 text-sm text-slate-300" role="status">
          Queued. It usually starts within a minute or two, and this page updates on its own.
        </div>
      )}
      {study.status === "building" && (
        <div className="card p-6 text-sm text-sky-400 border-sky-500/30" role="status">
          The engine is researching this one right now…
        </div>
      )}
      {study.status === "error" && (
        <div className="card p-6 text-sm text-red-400 border-red-500/30" role="alert">
          {study.error ?? "We couldn't build this report. Your credits have been refunded."}
        </div>
      )}

      {study.corrections_md && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-400">
            <AlertTriangle className="h-4 w-4" aria-hidden /> Corrections to your notes
          </h2>
          <div
            className="markdown text-sm"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(study.corrections_md) }}
          />
        </div>
      )}

      {study.content_md && (
        <article
          className="markdown card p-5 sm:p-8 max-w-[75ch]"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(study.content_md) }}
        />
      )}

      {sources.length > 0 && (
        <div className="card p-4 mt-4">
          <div className="text-xs uppercase tracking-wide text-fg-subtle mb-2 font-medium">Sources</div>
          <ul className="space-y-1 text-sm">
            {sources.map((s, i) => {
              const href = safeHttpUrl(s.url);
              return (
                <li key={i}>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
                      {s.title || href}
                    </a>
                  ) : (
                    <span className="text-slate-400">{s.title || String(s.url)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {study.notes && (
        <details className="card p-4 mt-4 text-sm text-slate-400">
          <summary className="cursor-pointer text-fg-subtle text-xs uppercase tracking-wide font-medium">
            Your original notes
          </summary>
          <p className="mt-2 whitespace-pre-wrap">{study.notes}</p>
        </details>
      )}

      {updates.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm uppercase tracking-wide text-fg-subtle font-medium mb-2">Follow-ups</h2>
          <div className="space-y-2">
            {updates.map((u) => (
              <Link key={u.id} href={`/study/${u.id}`} className="card p-3 flex flex-wrap items-center justify-between gap-2 text-sm hover:border-ink-500">
                <span>{VARIANTS.find((v) => v.value === u.variant)?.label ?? u.variant}</span>
                <span className="flex items-center gap-2 text-fg-subtle">
                  <StatusBadge status={u.status} /> {formatDate(u.created_at)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
