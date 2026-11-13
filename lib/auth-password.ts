import { compare } from "bcryptjs";
import { hashPassword, verifyPassword } from "better-auth/crypto";

// Existing Supabase credentials are bcrypt. New passwords use Better Auth's
// scrypt format; never convert a hash by treating it as a plaintext password.
export { hashPassword };
export async function verifyMigratedPassword(input: { hash: string; password: string }) {
  if (/^\$2[aby]\$\d{2}\$/.test(input.hash)) {
    return compare(input.password, input.hash.replace(/^\$2y\$/, "$2b$"));
  }
  return verifyPassword(input);
}
