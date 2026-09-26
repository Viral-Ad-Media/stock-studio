import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/admin";

// Minutes a running job must sit untouched before an admin may fail it. A
// live worker bumps updated_at and finishes well inside its 5-minute budget;
// failing one mid-flight could refund a report that then gets delivered.
const STUCK_AFTER_MIN = 15;

// Fail (and refund) a job that's pending, or running but stuck.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperAdminApi();
  if (!gate.ok) return gate.response;
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Unknown job" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (note.length < 3) return NextResponse.json({ error: "Add a short note explaining why." }, { status: 400 });
  if (body.action !== "fail") return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const result = await sql.begin(async (tx) => {
    const [job] = await tx`
      UPDATE jobs SET status = 'error', result = ${`Failed by an administrator: ${note}`}, locked_at = NULL, updated_at = now()
      WHERE id = ${id}
        AND (status = 'pending' OR (status = 'running' AND updated_at < now() - make_interval(mins => ${STUCK_AFTER_MIN})))
      RETURNING id, status, payload, workspace_id
    `;
    if (!job) return null;
    const payload = job.payload as { case_study_id?: number };
    if (payload.case_study_id) {
      await tx`
        UPDATE case_studies SET status = 'error',
          error = 'We couldn''t build this report. Your credits have been refunded.', updated_at = now()
        WHERE id = ${payload.case_study_id}
      `;
    }
    const [refund] = await tx`SELECT refund_job_credits(${id}) AS credits`;
    await tx`
      INSERT INTO admin_audit (admin_user_id, action, target_type, target_id, detail)
      VALUES (${gate.user.id}, 'fail_job', 'job', ${String(id)},
              ${sql.json({ note, workspace_id: job.workspace_id, refunded_credits: refund.credits })})
    `;
    return { refunded: refund.credits as number };
  });

  if (!result) {
    return NextResponse.json(
      { error: `Only pending jobs, or running jobs untouched for ${STUCK_AFTER_MIN}+ minutes, can be failed.` },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, ...result });
}
