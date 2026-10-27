import { NextResponse } from "next/server";
import { sql, adminSql, adminWritesConfigured } from "@/lib/db";
import { requireSuperAdminApi, adminErrorResponse, UUID_RE } from "@/lib/admin";

// Super-admin changes to one user: credits, trial, comp access, disabled,
// admin role (POST) and removal (DELETE). All writes run as the stocks_admin
// role through audited SECURITY DEFINER functions.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireSuperAdminApi();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!UUID_RE.test(id))
    return NextResponse.json({ error: "Unknown user" }, { status: 404 });
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
    if (body.action === "credits") {
      const delta = Number(body.delta);
      if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 10000)
        return NextResponse.json(
          {
            error:
              "Enter a whole, non-zero number of credits between -10,000 and 10,000.",
          },
          { status: 400 },
        );
      const [profile] =
        await sql`SELECT active_workspace_id FROM profiles WHERE id = ${id}`;
      if (!profile?.active_workspace_id)
        return NextResponse.json(
          { error: "This user has no workspace." },
          { status: 404 },
        );
      const [row] =
        await adminSql`SELECT stocks.admin_adjust_credits(${gate.user.id}::uuid, ${profile.active_workspace_id}::uuid, ${delta}, ${note}) AS balance`;
      return NextResponse.json({ ok: true, balance: row.balance });
    }
    if (body.action === "trial") {
      const days = Number(body.days);
      if (!Number.isInteger(days) || days < 1 || days > 365)
        return NextResponse.json(
          { error: "Days must be between 1 and 365." },
          { status: 400 },
        );
      const [row] =
        await adminSql`SELECT stocks.admin_extend_trial(${gate.user.id}::uuid, ${id}::uuid, ${days}, ${note}) AS trial_ends_at`;
      return NextResponse.json({ ok: true, trial_ends_at: row.trial_ends_at });
    }
    if (body.action === "access") {
      if (typeof body.granted !== "boolean")
        return NextResponse.json(
          { error: "granted must be true or false" },
          { status: 400 },
        );
      await adminSql`SELECT stocks.admin_set_access(${gate.user.id}::uuid, ${id}::uuid, ${body.granted}, ${note})`;
      return NextResponse.json({ ok: true });
    }
    if (body.action === "disabled") {
      if (typeof body.disabled !== "boolean")
        return NextResponse.json(
          { error: "disabled must be true or false" },
          { status: 400 },
        );
      await adminSql`SELECT stocks.admin_set_disabled(${gate.user.id}::uuid, ${id}::uuid, ${body.disabled}, ${note})`;
      return NextResponse.json({ ok: true });
    }
    if (body.action === "admin") {
      if (typeof body.admin !== "boolean")
        return NextResponse.json(
          { error: "admin must be true or false" },
          { status: 400 },
        );
      await adminSql`SELECT stocks.admin_set_platform_admin(${gate.user.id}::uuid, ${id}::uuid, ${body.admin}, ${note})`;
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

// Removes the Stock Studio account and its data (not the login, which other
// apps on the Supabase project may share). Needs the account's email typed
// back as confirmation.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireSuperAdminApi();
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!UUID_RE.test(id))
    return NextResponse.json({ error: "Unknown user" }, { status: 404 });
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
  const confirmEmail =
    typeof body.confirmEmail === "string" ? body.confirmEmail.slice(0, 254) : "";
  if (note.length < 3)
    return NextResponse.json(
      { error: "Add a short note explaining the change." },
      { status: 400 },
    );
  try {
    await adminSql`SELECT stocks.admin_remove_user(${gate.user.id}::uuid, ${id}::uuid, ${confirmEmail}, ${note})`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
