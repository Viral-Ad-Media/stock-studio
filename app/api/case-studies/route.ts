import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAppAccess, insufficientCreditsResponse } from "@/lib/access";
import { creditCost, chargeJobCredits, isInsufficientCredits } from "@/lib/billing";

export async function POST(req: Request) {
  const gate = await requireAppAccess();
  if (!gate.ok) return gate.response;
  const { ws } = gate;

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

  // parent_id feeds the parent study's content into the engine prompt — it
  // must belong to this workspace, or it's a cross-tenant read.
  let parentId: number | null = null;
  if (body.parent_id != null) {
    const [parent] = await sql`
      SELECT id FROM case_studies WHERE id = ${Number(body.parent_id)} AND workspace_id = ${ws}
    `;
    if (!parent) return NextResponse.json({ error: "parent study not found" }, { status: 404 });
    parentId = parent.id;
  }

  if (variant === "movers_digest") {
    const [pending] = await sql`
      SELECT id FROM jobs WHERE type = 'movers_digest' AND status IN ('pending','running') AND workspace_id = ${ws}
    `;
    if (pending) {
      return NextResponse.json({ error: "A movers digest is already queued" }, { status: 409 });
    }
  }

  try {
    const id = await sql.begin(async (tx) => {
      const [study] = await tx`
        INSERT INTO case_studies (workspace_id, ticker, company, variant, status, notes, parent_id)
        VALUES (${ws}, ${ticker}, ${body.company ? String(body.company).trim() : null}, ${variant}, 'queued',
                ${body.notes ? String(body.notes).trim() : null}, ${parentId})
        RETURNING id
      `;
      const [job] = await tx`
        INSERT INTO jobs (workspace_id, type, payload) VALUES (${ws}, ${jobType}, ${sql.json({ case_study_id: study.id })})
        RETURNING id
      `;
      // Charged at queue time, same transaction: a short balance means the
      // study and job never exist. Refunded if the job fails or is removed.
      await chargeJobCredits(tx, job.id, creditCost(variant));
      return study.id;
    });
    return NextResponse.json({ id });
  } catch (err) {
    if (isInsufficientCredits(err)) return insufficientCreditsResponse();
    throw err;
  }
}
