import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentWorkspaceId } from "@/lib/workspace";
import { refundJobCredits } from "@/lib/billing";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = Number((await params).id);
  await sql.begin(async (tx) => {
    // The study and its follow-ups (earnings updates) go together…
    const studies = await tx`
      DELETE FROM case_studies WHERE (id = ${id} OR parent_id = ${id}) AND workspace_id = ${ws}
      RETURNING id
    `;
    const ids = studies.map((s) => Number(s.id));
    if (!ids.length) return;
    // …and so do their not-yet-started jobs, refunded in the same
    // transaction. Running jobs are left alone: the worker fails them
    // without a refund when it finds the study gone.
    const removed = await tx`
      DELETE FROM jobs WHERE status = 'pending' AND workspace_id = ${ws}
      AND (payload->>'case_study_id')::bigint = ANY(${ids}::bigint[])
      RETURNING id
    `;
    for (const job of removed) await refundJobCredits(job.id, tx);
  });
  return NextResponse.json({ ok: true });
}
