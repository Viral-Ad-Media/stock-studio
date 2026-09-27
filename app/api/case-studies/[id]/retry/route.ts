import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAppAccess, insufficientCreditsResponse } from "@/lib/access";
import { queueLimitResponse } from "@/lib/limits";
import { creditCost, chargeJobCredits, isInsufficientCredits, isDuplicateOpenJob } from "@/lib/billing";
import { jobTypeForVariant } from "@/lib/shared";

// Re-queue a failed study. Its failed job was refunded, so the retry is a new
// job charged like a fresh one — the same study row (notes, company, parent)
// goes back to `queued`. The status guard on the UPDATE makes a double click
// or a concurrent retry a no-op 409, and a short balance rolls it all back.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAppAccess();
  if (!gate.ok) return gate.response;
  const { ws } = gate;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "study not found" }, { status: 404 });
  const limited = await queueLimitResponse(ws);
  if (limited) return limited;

  try {
    const outcome = await sql.begin(async (tx) => {
      const [study] = await tx`
        UPDATE case_studies SET status = 'queued', error = NULL, updated_at = now()
        WHERE id = ${id} AND workspace_id = ${ws} AND status = 'error'
        RETURNING id, variant
      `;
      if (!study) {
        const [existing] = await tx`SELECT status FROM case_studies WHERE id = ${id} AND workspace_id = ${ws}`;
        return existing ? ("not_failed" as const) : ("not_found" as const);
      }
      const [job] = await tx`
        INSERT INTO jobs (workspace_id, type, payload)
        VALUES (${ws}, ${jobTypeForVariant(study.variant)}, ${sql.json({ case_study_id: study.id })})
        RETURNING id
      `;
      await chargeJobCredits(tx, job.id, creditCost(study.variant));
      return "ok" as const;
    });
    if (outcome === "not_found") return NextResponse.json({ error: "study not found" }, { status: 404 });
    if (outcome === "not_failed") {
      return NextResponse.json({ error: "Only a failed study can be retried." }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isInsufficientCredits(err)) return insufficientCreditsResponse();
    if (isDuplicateOpenJob(err)) {
      return NextResponse.json({ error: "A movers digest is already queued" }, { status: 409 });
    }
    throw err;
  }
}
