"use client";

import { createBrowserClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { REMEMBER_COOKIE, applyRemember, rememberFromCookieValue } from "@/lib/auth-cookies";

// Browser-side Supabase client — auth only (see server.ts for why). Cookie
// writes honour the "remember me" flag (lib/auth-cookies.ts).
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set");
  }
  return createBrowserClient(url, key, {
    cookies: {
      getAll() {
        return parseCookieHeader(document.cookie).map(({ name, value }) => ({ name, value: value ?? "" }));
      },
      setAll(cookiesToSet) {
        const remember = rememberFromCookieValue(
          parseCookieHeader(document.cookie).find((c) => c.name === REMEMBER_COOKIE)?.value
        );
        for (const { name, value, options } of cookiesToSet) {
          document.cookie = serializeCookieHeader(name, value, applyRemember(options, remember));
        }
      },
    },
  });
}

export { setRememberMe } from "./remember";
