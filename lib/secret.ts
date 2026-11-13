import { createHash, timingSafeEqual } from "crypto";

// Constant-time comparison of a shared secret sent in a request header
// (hash first so lengths match). Fails closed when either side is empty, so
// an unset environment variable never opens the endpoint.
export function secretMatches(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
