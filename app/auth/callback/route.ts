import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/origin";
// Old Supabase links no longer establish sessions after the migration.
export function GET(request: Request) {
  return NextResponse.redirect(new URL("/login?error=auth_callback_failed", appOrigin(request)));
}
