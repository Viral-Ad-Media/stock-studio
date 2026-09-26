import { REMEMBER_COOKIE } from "@/lib/auth-cookies";

// Set before signing in: remember=false makes the session end with the browser.
// Kept apart from ./client so pages can use it without loading the Supabase SDK.
export function setRememberMe(remember: boolean) {
  document.cookie = remember
    ? `${REMEMBER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
    : `${REMEMBER_COOKIE}=0; Path=/; SameSite=Lax`;
}
