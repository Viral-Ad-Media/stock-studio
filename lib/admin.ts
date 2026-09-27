import { cache } from "react";
import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, type SessionUser } from "@/lib/workspace";

// Super-admin checks. Admins are rows in stocks.platform_admins, managed in
// SQL only. Non-admins get a plain 404 so the console's existence isn't
// advertised.
export const isSuperAdmin = cache(async (userId: string): Promise<boolean> => {
  const [row] = await sql`SELECT 1 AS ok FROM platform_admins WHERE user_id = ${userId}`;
  return Boolean(row);
});

export async function requireSuperAdminPage(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user || !(await isSuperAdmin(user.id))) notFound();
  return user;
}

export async function requireSuperAdminApi(): Promise<{ ok: true; user: SessionUser } | { ok: false; response: NextResponse }> {
  const user = await currentUser();
  if (!user || !(await isSuperAdmin(user.id))) {
    return { ok: false, response: NextResponse.json({ error: "not found" }, { status: 404 }) };
  }
  return { ok: true, user };
}

// Maps the admin functions' SQLSTATEs (SS400/SS403/SS404) to responses.
export function adminErrorResponse(err: unknown): NextResponse {
  const e = err as { code?: string; message?: string };
  const status = e?.code === "SS400" ? 400 : e?.code === "SS403" ? 403 : e?.code === "SS404" ? 404 : 0;
  if (status) return NextResponse.json({ error: e.message ?? "Request failed" }, { status });
  console.error("admin action failed", err);
  // Login rejected (28P01 wrong password / 28000 no password or not allowed) or
  // the pooler refused the connection: say so, since it's a setup problem.
  const msg = String(e?.message ?? "");
  if (e?.code === "28P01" || e?.code === "28000" || /password authentication|authentication failed|tenant or user not found|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
    return NextResponse.json(
      {
        error:
          "The admin database connection was rejected. Set a password on the stocks_admin role (ALTER ROLE stocks_admin WITH PASSWORD ...) and put that exact password in ADMIN_DATABASE_URL, with the user stocks_admin.<project ref>.",
      },
      { status: 503 }
    );
  }
  return NextResponse.json({ error: "The change couldn't be saved. Check the server logs." }, { status: 500 });
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DirectoryUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  provider: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  total: number;
};

export async function userDirectory(
  adminId: string,
  opts: { ids?: string[]; query?: string | null; limit?: number; offset?: number } = {}
): Promise<DirectoryUser[]> {
  return (await sql`
    SELECT * FROM admin_user_directory(${adminId}::uuid, ${opts.ids ?? null}::uuid[], ${opts.query || null}, ${opts.limit ?? 50}, ${opts.offset ?? 0})
  `) as unknown as DirectoryUser[];
}
