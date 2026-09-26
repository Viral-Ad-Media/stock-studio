import { GRADE_COMPONENTS, GRADE_DISCLAIMER, scoreToLetter, type StudyGrade } from "@/lib/grades";
import GradeBadge from "./GradeBadge";

export default function GradeBreakdown({ grade, summary }: { grade: StudyGrade; summary: string | null }) {
  return (
    <section aria-labelledby="grade-heading" className="card mb-4 p-4 sm:p-5">
      <div className="flex items-start gap-4">
        <GradeBadge grade={grade} size="lg" />
        <div className="min-w-0">
          <h2 id="grade-heading" className="text-sm font-semibold text-slate-100">
            Research grade <span className="font-normal text-fg-subtle">· {grade.score}/100</span>
          </h2>
          {summary && <p className="mt-1 text-sm text-slate-300">{summary}</p>}
          <p className="mt-1 text-xs text-fg-subtle">{GRADE_DISCLAIMER}</p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {grade.components.map((c) => {
          const hint = GRADE_COMPONENTS.find((g) => g.key === c.key)?.hint;
          return (
            <div key={c.key}>
              <dt className="flex items-baseline justify-between text-xs">
                <span className="font-medium text-slate-200" title={hint}>
                  {c.label}
                </span>
                <span className="tabular-nums text-slate-300">
                  {scoreToLetter(c.score)} · {c.score}
                </span>
              </dt>
              <dd>
                <div
                  className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-700"
                  role="meter"
                  aria-label={`${c.label} score`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={c.score}
                >
                  <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${c.score}%` }} />
                </div>
                {c.note && <p className="mt-1 text-xs text-fg-subtle">{c.note}</p>}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
