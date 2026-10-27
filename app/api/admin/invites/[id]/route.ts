import { NextResponse } from "next/server";
import { adminSql, adminWritesConfigured } from "@/lib/db";
import { requireSuperAdminApi, adminErrorResponse } from "@/lib/admin";

// Cancel an open invite (stocks.admin_revoke_invite).
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireSuperAdminApi();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id))
    return NextResponse.json({ error: "Unknown invite" }, { status: 404 });
  if (!adminWritesConfigured()) {
    return NextResponse.json(
      {
        error:
          "Admin changes are disabled: ADMIN_DATABASE_URL isn't set on the server.",
      },
      { status: 503 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const note =
    typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (note.length < 3)
    return NextResponse.json(
      { error: "Add a short note explaining the change." },
      { status: 400 },
    );
  try {
    await adminSql`SELECT stocks.admin_revoke_invite(${gate.user.id}::uuid, ${Number(id)}::bigint, ${note})`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
