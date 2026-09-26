import { NextResponse } from "next/server";
import { sql, adminSql, adminWritesConfigured } from "@/lib/db";
import { requireSuperAdminApi, adminErrorResponse, UUID_RE } from "@/lib/admin";

// Super-admin changes to one user: credits, trial, comp access. All writes
// run as the stocks_admin role through audited SECURITY DEFINER functions.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperAdminApi();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Unknown user" }, { status: 404 });
  if (!adminWritesConfigured()) {
    return NextResponse.json({ error: "Admin changes are disabled: ADMIN_DATABASE_URL isn't set on the server." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (note.length < 3) return NextResponse.json({ error: "Add a short note explaining the change." }, { status: 400 });

  try {
    if (body.action === "credits") {
      const delta = Number(body.delta);
      if (!Number.isInteger(delta) || delta === 0) return NextResponse.json({ error: "Enter a whole, non-zero number of credits." }, { status: 400 });
      const [profile] = await sql`SELECT active_workspace_id FROM profiles WHERE id = ${id}`;
      if (!profile?.active_workspace_id) return NextResponse.json({ error: "This user has no workspace." }, { status: 404 });
      const [row] = await adminSql`SELECT stocks.admin_adjust_credits(${gate.user.id}::uuid, ${profile.active_workspace_id}::uuid, ${delta}, ${note}) AS balance`;
      return NextResponse.json({ ok: true, balance: row.balance });
    }
    if (body.action === "trial") {
      const days = Number(body.days);
      if (!Number.isInteger(days) || days < 1 || days > 365) return NextResponse.json({ error: "Days must be between 1 and 365." }, { status: 400 });
      const [row] = await adminSql`SELECT stocks.admin_extend_trial(${gate.user.id}::uuid, ${id}::uuid, ${days}, ${note}) AS trial_ends_at`;
      return NextResponse.json({ ok: true, trial_ends_at: row.trial_ends_at });
    }
    if (body.action === "access") {
      if (typeof body.granted !== "boolean") return NextResponse.json({ error: "granted must be true or false" }, { status: 400 });
      await adminSql`SELECT stocks.admin_set_access(${gate.user.id}::uuid, ${id}::uuid, ${body.granted}, ${note})`;
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
