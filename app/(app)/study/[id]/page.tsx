import { notFound } from "next/navigation";
import Link from "next/link";
import { marked } from "marked";

marked.use({ breaks: true });
import { sql, CaseStudy, VARIANTS } from "@/lib/db";
import { currentWorkspaceId } from "@/lib/workspace";
import AutoRefresh from "@/components/AutoRefresh";
import StudyActions from "@/components/StudyActions";
import { ArrowLeft } from "lucide-react";

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
      {study.status !== "ready" && <AutoRefresh />}
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 mb-4">
        <ArrowLeft className="w-4 h-4" /> Dashboard
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 font-mono">{study.ticker}</h1>
          <p className="text-sm text-slate-500">
            {study.company ?? "Company TBD"} · {variantLabel}
            {study.as_of_date && <> · as of {study.as_of_date}</>}
          </p>
        </div>
        <StudyActions study={{ id: study.id, ticker: study.ticker, company: study.company, status: study.status, content_md: study.content_md }} />
      </div>

      {study.status === "queued" && (
        <div className="card p-6 text-sm text-amber-400 border-amber-500/30">
          Queued — run <code className="text-emerald-400">/build-studies</code> in Claude Code to build it.
        </div>
      )}
      {study.status === "building" && (
        <div className="card p-6 text-sm text-sky-400 border-sky-500/30">
          The engine is researching this one right now…
        </div>
      )}
      {study.status === "error" && (
        <div className="card p-6 text-sm text-red-400 border-red-500/30">
          Build failed: {study.error ?? "unknown error"}
        </div>
      )}

      {study.corrections_md && (
        <div className="card p-4 mb-4 border-amber-500/30">
          <div className="text-xs uppercase tracking-wide text-amber-400 mb-2 font-medium">
            Corrections to your notes
          </div>
          <div
            className="markdown text-sm"
            dangerouslySetInnerHTML={{ __html: marked.parse(study.corrections_md) as string }}
          />
        </div>
      )}

      {study.content_md && (
        <article
          className="markdown card p-8"
          dangerouslySetInnerHTML={{ __html: marked.parse(study.content_md) as string }}
        />
      )}

      {sources.length > 0 && (
        <div className="card p-4 mt-4">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-2 font-medium">Sources</div>
          <ul className="space-y-1 text-sm">
            {sources.map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {study.notes && (
        <details className="card p-4 mt-4 text-sm text-slate-400">
          <summary className="cursor-pointer text-slate-500 text-xs uppercase tracking-wide font-medium">
            Your original notes
          </summary>
          <p className="mt-2 whitespace-pre-wrap">{study.notes}</p>
        </details>
      )}

      {updates.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm uppercase tracking-wide text-slate-500 font-medium mb-2">Follow-ups</h2>
          <div className="space-y-2">
            {updates.map((u) => (
              <Link key={u.id} href={`/study/${u.id}`} className="card p-3 flex justify-between text-sm block hover:border-ink-600">
                <span>{VARIANTS.find((v) => v.value === u.variant)?.label ?? u.variant}</span>
                <span className="text-slate-500">{u.status} · {String(u.created_at).slice(0, 10)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
