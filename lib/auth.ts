import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { hashPassword, verifyMigratedPassword } from "./auth-password";
import { sendAuthMail } from "./auth-mail";

let instance: ReturnType<typeof buildAuth> | undefined;
export function buildAuth(database?: Pool, mailer = sendAuthMail) {
  const baseURL = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!process.env.AUTH_DATABASE_URL || !process.env.BETTER_AUTH_SECRET || !baseURL) {
    throw new Error("Authentication is not configured");
  }
  return betterAuth({
    appName: "Stock Studio", baseURL,
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [new URL(baseURL).origin],
    database: database || new Pool({ connectionString: process.env.AUTH_DATABASE_URL,
      options: "-c search_path=auth,stocks,public", max: 3 }),
    user: { modelName: "users", fields: {
      emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at",
    } },
    session: { modelName: "sessions", cookieCache: { enabled: false } },
    account: { modelName: "accounts", accountLinking: { enabled: false } },
    verification: { modelName: "verifications" },
    advanced: { database: { generateId: "uuid" } },
    rateLimit: { enabled: true, storage: "database" },
    emailAndPassword: {
      enabled: true, requireEmailVerification: true,
      password: { hash: hashPassword, verify: verifyMigratedPassword },
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await mailer(user.email, "Reset your Stock Studio password", `Reset your password: ${url}\n\nIf you did not request this, ignore this email.`);
      },
    },
    emailVerification: {
      sendOnSignUp: true, autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await mailer(user.email, "Confirm your Stock Studio email", `Confirm your email: ${url}\n\nIf you did not create an account, ignore this email.`);
      },
    },
    socialProviders: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? {
      google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET },
    } : {},
  });
}

// Build-time imports need no secrets and open no database connections.
export function getAuth() { return instance ??= buildAuth(); }
