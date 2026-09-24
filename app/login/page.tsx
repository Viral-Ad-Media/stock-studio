"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient, setRememberMe } from "@/lib/supabase/client";
import AuthShell from "@/components/auth/AuthShell";
import PasswordInput from "@/components/auth/PasswordInput";
import GoogleButton from "@/components/auth/GoogleButton";
import OrDivider from "@/components/auth/OrDivider";

// Messages carried in the URL by /auth/callback and the password pages.
const URL_MESSAGES: Record<string, { text: string; tone: "error" | "ok" }> = {
  auth_callback_failed: { text: "That sign-in link is invalid or has expired. Please try again.", tone: "error" },
  oauth_failed: { text: "Google sign-in didn't complete. Please try again.", tone: "error" },
  password_updated: { text: "Password updated — sign in with your new password.", tone: "ok" },
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const m = URL_MESSAGES[params.get("error") ?? params.get("message") ?? ""];
    if (m) (m.tone === "error" ? setError : setNotice)(m.text);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setRememberMe(remember);
    try {
      const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setError(
          /email not confirmed/i.test(error.message)
            ? "Please confirm your email first — check your inbox for the link we sent."
            : /invalid login credentials/i.test(error.message)
              ? "That email and password don't match. Check them, or reset your password."
              : error.message
        );
        setBusy(false);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
      setBusy(false);
    }
  }

  const clear = () => setError(null);

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your Stock Studio workspace."
      footer={
        <>
          New here?{" "}
          <Link href="/signup" className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            Start your 30-day free trial
          </Link>
        </>
      }
    >
      <GoogleButton remember={remember} onError={setError} />
      <OrDivider />

      <form onSubmit={submit} noValidate={false} aria-describedby={error ? "auth-error" : undefined}>
        <label htmlFor="email" className="field-label">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clear();
          }}
          aria-invalid={error ? true : undefined}
          className="input mb-4"
        />

        <div className="mb-1 flex items-baseline justify-between">
          <label htmlFor="password" className="text-sm text-slate-300">
            Password
          </label>
          <Link
            href={`/forgot-password${email ? `?email=${encodeURIComponent(email.trim())}` : ""}`}
            className="text-sm text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
          >
            Forgot password?
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            clear();
          }}
          aria-invalid={error ? true : undefined}
        />

        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 rounded border-ink-500 bg-ink-800 accent-emerald-500"
          />
          Remember me
          <span className="text-fg-subtle">— stay signed in on this device</span>
        </label>

        {error && (
          <p id="auth-error" role="alert" className="mt-4 text-sm text-red-400">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 text-sm text-emerald-400">
            {notice}
          </p>
        )}

        <button type="submit" disabled={busy || !email || !password} className="btn-primary mt-5 w-full py-2.5 text-sm">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}
