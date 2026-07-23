import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

// Remove a job from the queue. Ready studies are never touched — if the job's
// study hasn't been built yet, the placeholder row goes with it.
export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const [job] = await sql`SELECT * FROM jobs WHERE id = ${id}`;
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
  if (job.status === "done") {
    return NextResponse.json({ error: "job already completed" }, { status: 409 });
  }

  const payload = job.payload as Record<string, unknown>;
  await sql.begin(async (tx) => {
    await tx`DELETE FROM jobs WHERE id = ${id}`;
    if (payload.case_study_id) {
      await tx`
        DELETE FROM case_studies WHERE id = ${payload.case_study_id as number}
        AND status IN ('queued','building','error')
      `;
    }
  });
  return NextResponse.json({ ok: true });
}
