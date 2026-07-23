import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  await sql.begin(async (tx) => {
    await tx`DELETE FROM case_studies WHERE id = ${id} OR parent_id = ${id}`;
    await tx`
      DELETE FROM jobs WHERE status = 'pending' AND (payload->>'case_study_id')::bigint = ${id}
    `;
  });
  return NextResponse.json({ ok: true });
}
