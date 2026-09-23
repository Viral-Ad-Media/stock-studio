import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentWorkspaceId } from "@/lib/workspace";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = Number(params.id);
  await sql.begin(async (tx) => {
    await tx`DELETE FROM case_studies WHERE (id = ${id} OR parent_id = ${id}) AND workspace_id = ${ws}`;
    await tx`
      DELETE FROM jobs WHERE status = 'pending' AND workspace_id = ${ws}
      AND (payload->>'case_study_id')::bigint = ${id}
    `;
  });
  return NextResponse.json({ ok: true });
}
