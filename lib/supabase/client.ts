"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client — auth only (see server.ts for why).
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set");
  }
  return createBrowserClient(url, key);
}
