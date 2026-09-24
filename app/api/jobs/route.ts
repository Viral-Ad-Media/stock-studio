import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentWorkspaceId } from "@/lib/workspace";

// Remove a job from the queue. Only jobs that haven't started can be removed:
// once a job is running the research is already being paid for, so letting it
// be cancelled and refunded would be a free-report loop. The status check,
// the delete, and the refund are one statement sequence in one transaction —
// no window for the worker to finish the job in between.
export async function DELETE(req: Request) {
  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const outcome = await sql.begin(async (tx) => {
    const [job] = await tx`
      DELETE FROM jobs WHERE id = ${id} AND workspace_id = ${ws} AND status = 'pending'
      RETURNING id, payload
    `;
    if (!job) {
      const [existing] = await tx`SELECT status FROM jobs WHERE id = ${id} AND workspace_id = ${ws}`;
      return existing ? { error: existing.status as string } : { error: "not_found" };
    }
    const payload = job.payload as Record<string, unknown>;
    if (payload.case_study_id) {
      // Ready studies are never touched — only the unbuilt placeholder goes.
      await tx`
        DELETE FROM case_studies WHERE id = ${payload.case_study_id as number} AND workspace_id = ${ws}
        AND status IN ('queued','building','error')
      `;
    }
    // The report was never started — its queue-time charge goes back.
    await tx`SELECT refund_job_credits(${id})`;
    return { ok: true };
  });

  if ("ok" in outcome) return NextResponse.json({ ok: true });
  if (outcome.error === "not_found") return NextResponse.json({ error: "job not found" }, { status: 404 });
  return NextResponse.json(
    {
      error:
        outcome.error === "running"
          ? "This report is already being built and can't be cancelled."
          : "This job has already finished.",
    },
    { status: 409 }
  );
}
