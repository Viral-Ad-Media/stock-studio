import type { Metadata } from "next";
import Link from "next/link";
import Breadcrumbs from "@/components/marketing/Breadcrumbs";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What personal data Stock Studio collects, why, who processes it on our behalf, how long we keep it, and how to access or delete it.",
  alternates: { canonical: "/privacy" },
};

const UPDATED = "September 26, 2026";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Privacy Policy", path: "/privacy" }]} />
      <div className="markdown">

      <h1>Privacy Policy</h1>
      <p className="text-sm text-fg-subtle">Last updated: {UPDATED}</p>

      <p>
        This policy explains how {SITE.operator} (&ldquo;we&rdquo;, &ldquo;us&rdquo;), the operator of Stock Studio,
        handles personal data. It applies together with our <Link href="/terms">Terms of Service</Link>.
      </p>

      <h2>1. What we collect</h2>
      <ul>
        <li><strong>Account data:</strong> your name, email address and authentication credentials, handled by our authentication provider (Supabase Auth). If you sign in with Google, we receive your name and email address from Google.</li>
        <li><strong>Usage data:</strong> tickers you queue, notes you submit for fact-checking, and the studies/watchlist entries generated for your account.</li>
        <li><strong>Payment data:</strong> handled entirely by our payment processor (Stripe) — we do not store full card numbers.</li>
        <li><strong>Technical data:</strong> IP address, browser type, and basic request logs, for security and abuse prevention.</li>
      </ul>

      <h2>2. How we use it</h2>
      <p>We use your data to:</p>
      <ul>
        <li>Operate your account and generate the studies/watchlist entries you request</li>
        <li>Process payments and manage your trial/credit balance</li>
        <li>Improve the Service's reliability and output quality</li>
        <li>Communicate service-related updates (not marketing, unless you opt in)</li>
      </ul>

      <h2>3. Third parties we share data with</h2>
      <p>
        We use a small set of subprocessors to run the Service: our database and authentication
        provider (Supabase), our AI research provider (Anthropic: the ticker and notes you submit
        for a study are sent to generate that study&apos;s content), our payment processor
        (Stripe), Google if you choose Google sign-in, and our hosting provider. We do not sell
        your personal data.
      </p>

      <h2>4. Data retention</h2>
      <p>
        We retain account and study data for as long as your account is active, and for a
        reasonable period after closure for legal and accounting purposes. You can request
        deletion at any time (see below).
      </p>

      <h2>5. Your rights</h2>
      <p>
        Depending on your location, you may have the right to access, correct, export, or delete
        your personal data. To exercise these rights, email{" "}
        <a href={`mailto:${SITE.email}`}>{SITE.email}</a>.
      </p>

      <h2>6. Cookies</h2>
      <p>
        We use only essential cookies: the ones that keep you signed in, and one that remembers
        whether you chose &ldquo;Remember me&rdquo;. We do not use advertising, analytics or
        tracking cookies.
      </p>

      <h2>7. Security</h2>
      <p>
        We use industry-standard measures (encryption in transit, access controls, and tenant
        data isolation) to protect your data, but no system is completely secure.
      </p>

      <h2>8. Children's privacy</h2>
      <p>The Service is not directed at, and we do not knowingly collect data from, anyone under 18.</p>

      <h2>9. Changes to this policy</h2>
      <p>We may update this policy from time to time. Material changes will be notified through the Service or by email.</p>

      <h2>10. Contact</h2>
      <p>
        {SITE.operator}: <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
      </p>
      </div>
    </div>
  );
}
