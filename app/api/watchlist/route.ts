import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function POST(req: Request) {
  const body = await req.json();
  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "Ticker is required" }, { status: 400 });
  }

  const id = await sql.begin(async (tx) => {
    const [row] = await tx`
      INSERT INTO watchlist (ticker, company, case_study_id)
      VALUES (${ticker}, ${body.company ?? null}, ${body.case_study_id ?? null})
      ON CONFLICT (ticker) DO UPDATE SET
        company = COALESCE(excluded.company, watchlist.company),
        case_study_id = COALESCE(excluded.case_study_id, watchlist.case_study_id),
        updated_at = now()
      RETURNING id
    `;
    await tx`INSERT INTO jobs (type, payload) VALUES ('watchlist_entry', ${sql.json({ watchlist_id: row.id })})`;
    return row.id;
  });

  return NextResponse.json({ id });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const id = Number(body.id);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (body.status_tag) {
    await sql`UPDATE watchlist SET status_tag = ${String(body.status_tag)}, updated_at = now() WHERE id = ${id}`;
  }
  if (body.requeue) {
    const [existing] = await sql`
      SELECT id FROM jobs WHERE type = 'watchlist_entry' AND status = 'pending'
      AND (payload->>'watchlist_id')::bigint = ${id}
    `;
    if (!existing) {
      await sql`INSERT INTO jobs (type, payload) VALUES ('watchlist_entry', ${sql.json({ watchlist_id: id })})`;
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await sql.begin(async (tx) => {
    await tx`DELETE FROM watchlist WHERE id = ${id}`;
    await tx`
      DELETE FROM jobs WHERE status = 'pending' AND type = 'watchlist_entry'
      AND (payload->>'watchlist_id')::bigint = ${id}
    `;
  });
  return NextResponse.json({ ok: true });
}
