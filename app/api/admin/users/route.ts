import { NextResponse } from "next/server";
import { adminSql, adminWritesConfigured } from "@/lib/db";
import { requireSuperAdminApi, adminErrorResponse } from "@/lib/admin";

// Add a user by email (stocks.admin_create_user). An email with a login from
// another app on the Supabase project is set up now; anyone else gets an
// invite that's applied when they sign up with that email.
export async function POST(req: Request) {
  const gate = await requireSuperAdminApi();
  if (!gate.ok) return gate.response;
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
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const note =
    typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  const credits = body.credits === undefined || body.credits === "" ? 0 : Number(body.credits);
  const trialDays =
    body.trialDays === undefined || body.trialDays === "" || body.trialDays === null
      ? null
      : Number(body.trialDays);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254)
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 },
    );
  if (!Number.isInteger(credits) || credits < 0 || credits > 10000)
    return NextResponse.json(
      { error: "Starting credits must be a whole number from 0 to 10,000." },
      { status: 400 },
    );
  if (trialDays !== null && (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 365))
    return NextResponse.json(
      { error: "Trial days must be between 1 and 365." },
      { status: 400 },
    );
  if (typeof body.access !== "boolean")
    return NextResponse.json(
      { error: "access must be true or false" },
      { status: 400 },
    );
  if (note.length < 3)
    return NextResponse.json(
      { error: "Add a short note explaining the change." },
      { status: 400 },
    );

  try {
    const [row] = await adminSql`
      SELECT * FROM stocks.admin_create_user(${gate.user.id}::uuid, ${email}, ${credits}, ${trialDays}, ${body.access}, ${note})
    `;
    return NextResponse.json({
      ok: true,
      status: row.status,
      userId: row.user_id,
      inviteId: row.invite_id,
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
