"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import AuthShell from "@/components/auth/AuthShell";
import PasswordInput from "@/components/auth/PasswordInput";
import GoogleButton from "@/components/auth/GoogleButton";
import OrDivider from "@/components/auth/OrDivider";

const NAME_MAX = 50;
const PASSWORD_RULES = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "A letter and a number", test: (p: string) => /[a-z]/i.test(p) && /\d/.test(p) },
];

export default function SignupPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [resent, setResent] = useState<"idle" | "sending" | "sent">("idle");

  const passwordOk = PASSWORD_RULES.every((r) => r.test(password));
  const canSubmit = firstName.trim() && lastName.trim() && email.trim() && passwordOk && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const first = firstName.trim().slice(0, NAME_MAX);
    const last = lastName.trim().slice(0, NAME_MAX);
    try {
      const { error } = await createClient().auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          // Display name only — stored in Supabase Auth user metadata. Nothing
          // security-relevant (trial, access, credits) is ever read from here.
          data: { first_name: first, last_name: last, full_name: `${first} ${last}` },
        },
      });
      if (error) {
        setError(/already registered/i.test(error.message) ? "An account with this email already exists — sign in instead." : error.message);
        setBusy(false);
        return;
      }
      setSent(true);
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    }
    setBusy(false);
  }

  async function resend() {
    setResent("sending");
    const { error } = await createClient().auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setResent("idle");
    } else {
      setResent("sent");
    }
  }

  if (sent) {
    return (
      <AuthShell title="Check your email" subtitle={<>We sent a confirmation link to <span className="text-slate-200">{email.trim()}</span>.</>}>
        <div className="flex flex-col items-center text-center">
          <MailCheck className="mb-3 h-10 w-10 text-emerald-400" aria-hidden />
          <p className="text-sm text-slate-300">Click the link to activate your 30-day free trial. It can take a minute to arrive — check spam too.</p>
          <button type="button" onClick={resend} disabled={resent !== "idle"} className="btn-secondary mt-5 px-4 py-2 text-sm">
            {resent === "sending" ? "Sending…" : resent === "sent" ? "Sent again" : "Resend email"}
          </button>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-400">
              {error}
            </p>
          )}
          <Link href="/login" className="mt-5 text-sm text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Start your free trial"
      subtitle="30 days free, with 5 starter credits. No card required."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            Sign in
          </Link>
        </>
      }
    >
      <GoogleButton label="Sign up with Google" onError={setError} />
      <OrDivider />

      <form onSubmit={submit} aria-describedby={error ? "auth-error" : undefined}>
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="first-name" className="field-label">
              First name
            </label>
            <input
              id="first-name"
              name="given-name"
              autoComplete="given-name"
              required
              maxLength={NAME_MAX}
              autoFocus
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="last-name" className="field-label">
              Last name
            </label>
            <input
              id="last-name"
              name="family-name"
              autoComplete="family-name"
              required
              maxLength={NAME_MAX}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="input"
            />
          </div>
        </div>

        <label htmlFor="email" className="field-label">
          Work or personal email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          className="input mb-4"
        />

        <label htmlFor="password" className="field-label">
          Password
        </label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="password-rules"
        />
        <ul id="password-rules" className="mt-2 space-y-1 text-xs">
          {PASSWORD_RULES.map((r) => {
            const ok = r.test(password);
            return (
              <li key={r.label} className={`flex items-center gap-1.5 ${ok ? "text-emerald-400" : "text-fg-subtle"}`}>
                <Check className={`h-3.5 w-3.5 ${ok ? "" : "opacity-40"}`} aria-hidden />
                {r.label}
                <span className="sr-only">{ok ? "(met)" : "(not met yet)"}</span>
              </li>
            );
          })}
        </ul>

        {error && (
          <p id="auth-error" role="alert" className="mt-4 text-sm text-red-400">
            {error}
          </p>
        )}

        <button type="submit" disabled={!canSubmit} className="btn-primary mt-5 w-full py-2.5 text-sm">
          {busy ? "Creating account…" : "Create account"}
        </button>

        <p className="mt-4 text-center text-xs text-fg-subtle">
          By creating an account you agree to the{" "}
          <Link href="/terms" className="underline underline-offset-2 hover:text-slate-300">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-slate-300">
            Privacy Policy
          </Link>
          . Educational analysis — not investment advice.
        </p>
      </form>
    </AuthShell>
  );
}
