import { GRADE_DISCLAIMER, type StudyGrade } from "@/lib/grades";

// Letter band → tone. The letter itself carries the meaning; color is secondary.
export function gradeTone(letter: string): string {
  if (letter.startsWith("A")) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (letter.startsWith("B")) return "border-sky-500/40 bg-sky-500/10 text-sky-300";
  if (letter.startsWith("C")) return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return "border-red-500/40 bg-red-500/10 text-red-300";
}

export default function GradeBadge({ grade, size = "sm" }: { grade: StudyGrade; size?: "sm" | "lg" }) {
  const dims = size === "lg" ? "h-14 w-14 text-2xl" : "h-7 min-w-[2rem] px-1.5 text-sm";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg border font-bold tabular-nums ${dims} ${gradeTone(grade.overall)}`}
      title={GRADE_DISCLAIMER}
    >
      <span className="sr-only">Research grade </span>
      {grade.overall}
    </span>
  );
}
