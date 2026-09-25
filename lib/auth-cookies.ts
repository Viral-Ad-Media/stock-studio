// "Remember me": when unchecked at sign-in, this flag cookie is set to "0" and
// every Supabase auth cookie is then written without maxAge/expires — a
// browser-session cookie, gone when the browser closes. Absent = remember
// (Supabase's default long-lived cookies). Read by the browser client, the
// server client and proxy.ts, so all three write auth cookies the same way.
export const REMEMBER_COOKIE = "ss_remember";

type CookieOpts = { maxAge?: number; expires?: Date; [k: string]: unknown };

export function applyRemember<T extends CookieOpts | undefined>(options: T, remember: boolean): T {
  if (remember || !options) return options;
  const { maxAge: _maxAge, expires: _expires, ...rest } = options;
  return rest as T;
}

export function rememberFromCookieValue(value: string | undefined): boolean {
  return value !== "0";
}
