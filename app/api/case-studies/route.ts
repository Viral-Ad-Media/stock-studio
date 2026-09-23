import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentWorkspaceId } from "@/lib/workspace";

export async function POST(req: Request) {
  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "Ticker is required" }, { status: 400 });
  }
  const variant = String(body.variant ?? "full");
  const jobType =
    variant === "earnings_update"
      ? "earnings_update"
      : variant === "movers_digest"
        ? "movers_digest"
        : "build_case_study";

  if (variant === "movers_digest") {
    const [pending] = await sql`
      SELECT id FROM jobs WHERE type = 'movers_digest' AND status IN ('pending','running') AND workspace_id = ${ws}
    `;
    if (pending) {
      return NextResponse.json({ error: "A movers digest is already queued" }, { status: 409 });
    }
  }

  const id = await sql.begin(async (tx) => {
    const [study] = await tx`
      INSERT INTO case_studies (workspace_id, ticker, company, variant, status, notes, parent_id)
      VALUES (${ws}, ${ticker}, ${body.company ? String(body.company).trim() : null}, ${variant}, 'queued',
              ${body.notes ? String(body.notes).trim() : null}, ${body.parent_id ?? null})
      RETURNING id
    `;
    await tx`
      INSERT INTO jobs (workspace_id, type, payload) VALUES (${ws}, ${jobType}, ${sql.json({ case_study_id: study.id })})
    `;
    return study.id;
  });

  return NextResponse.json({ id });
}
