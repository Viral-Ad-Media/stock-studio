import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentWorkspaceId } from "@/lib/workspace";
import { requireAppAccess, insufficientCreditsResponse } from "@/lib/access";
import { creditCost, chargeJobCredits, isInsufficientCredits, isDuplicateOpenJob, refundJobCredits } from "@/lib/billing";
import { parseTicker, parseOptionalText, isInvalid, MAX_COMPANY, STATUS_TAGS } from "@/lib/validate";

const WATCHLIST_COST = creditCost("watchlist_entry");

export async function POST(req: Request) {
  const gate = await requireAppAccess();
  if (!gate.ok) return gate.response;
  const { ws } = gate;

  const body = await req.json().catch(() => ({}));
  const ticker = parseTicker(body.ticker);
  if (isInvalid(ticker)) return NextResponse.json({ error: ticker.error }, { status: 400 });
  const company = parseOptionalText(body.company, MAX_COMPANY, "Company");
  if (isInvalid(company)) return NextResponse.json({ error: company.error }, { status: 400 });

  // Only link a study from this workspace.
  let caseStudyId: number | null = null;
  if (body.case_study_id != null) {
    const [study] = await sql`
      SELECT id FROM case_studies WHERE id = ${Number(body.case_study_id)} AND workspace_id = ${ws}
    `;
    if (!study) return NextResponse.json({ error: "case study not found" }, { status: 404 });
    caseStudyId = study.id;
  }

  try {
    const id = await sql.begin(async (tx) => {
      const [row] = await tx`
        INSERT INTO watchlist (workspace_id, ticker, company, case_study_id)
        VALUES (${ws}, ${ticker}, ${company}, ${caseStudyId})
        ON CONFLICT (workspace_id, ticker) DO UPDATE SET
          company = COALESCE(excluded.company, watchlist.company),
          case_study_id = COALESCE(excluded.case_study_id, watchlist.case_study_id),
          updated_at = now()
        RETURNING id
      `;
      const [job] = await tx`
        INSERT INTO jobs (workspace_id, type, payload) VALUES (${ws}, 'watchlist_entry', ${sql.json({ watchlist_id: row.id })})
        RETURNING id
      `;
      await chargeJobCredits(tx, job.id, WATCHLIST_COST);
      return row.id;
    });
    return NextResponse.json({ id });
  } catch (err) {
    if (isInsufficientCredits(err)) return insufficientCreditsResponse();
    // Already tracked with a refresh queued or running (unique index) — no new charge.
    if (isDuplicateOpenJob(err)) {
      return NextResponse.json({ error: `${ticker} is already being researched` }, { status: 409 });
    }
    throw err;
  }
}

export async function PATCH(req: Request) {
  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const id = Number(body.id);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (body.status_tag) {
    if (!(STATUS_TAGS as readonly string[]).includes(String(body.status_tag))) {
      return NextResponse.json({ error: "Unknown status" }, { status: 400 });
    }
    await sql`UPDATE watchlist SET status_tag = ${String(body.status_tag)}, updated_at = now() WHERE id = ${id} AND workspace_id = ${ws}`;
  }
  if (body.requeue) {
    // A refresh is a new paid job — same gate as POST.
    const gate = await requireAppAccess();
    if (!gate.ok) return gate.response;

    const [row] = await sql`SELECT id FROM watchlist WHERE id = ${id} AND workspace_id = ${ws}`;
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    try {
      await sql.begin(async (tx) => {
        const [job] = await tx`
          INSERT INTO jobs (workspace_id, type, payload) VALUES (${ws}, 'watchlist_entry', ${sql.json({ watchlist_id: id })})
          RETURNING id
        `;
        await chargeJobCredits(tx, job.id, WATCHLIST_COST);
      });
    } catch (err) {
      if (isInsufficientCredits(err)) return insufficientCreditsResponse();
      // A refresh is already queued or running (unique index) — no double charge.
      if (isDuplicateOpenJob(err)) {
        return NextResponse.json({ error: "A refresh is already queued for this ticker" }, { status: 409 });
      }
      throw err;
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ws = await currentWorkspaceId();
  if (!ws) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await sql.begin(async (tx) => {
    await tx`DELETE FROM watchlist WHERE id = ${id} AND workspace_id = ${ws}`;
    const removed = await tx`
      DELETE FROM jobs WHERE status = 'pending' AND type = 'watchlist_entry' AND workspace_id = ${ws}
      AND (payload->>'watchlist_id')::bigint = ${id}
      RETURNING id
    `;
    // Unbuilt refreshes that were paid for go back to the balance, same tx.
    for (const job of removed) await refundJobCredits(job.id, tx);
  });
  return NextResponse.json({ ok: true });
}
