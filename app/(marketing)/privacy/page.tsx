export const metadata = { title: "Privacy Policy — Stock Studio" };

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16 markdown">
      <div className="card p-4 mb-8 border-amber-500/30 text-sm text-amber-400">
        Template — has not been reviewed by a lawyer. Replace the bracketed placeholders, confirm
        the vendor list matches what's actually integrated, and get this reviewed (including for
        GDPR/CCPA applicability) before relying on it for a real launch.
      </div>

      <h1>Privacy Policy</h1>
      <p className="text-sm text-fg-subtle">Last updated: [DATE]</p>

      <h2>1. What we collect</h2>
      <ul>
        <li><strong>Account data:</strong> email address and authentication credentials, handled by our authentication provider (Supabase Auth).</li>
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
        provider (Supabase), our AI research provider (Anthropic — the ticker/notes you submit
        for a study are sent to generate that study's content), and our payment processor
        (Stripe). We do not sell your personal data.
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
        <a href="mailto:privacy@stockstudio.app">privacy@stockstudio.app</a>.
      </p>

      <h2>6. Cookies</h2>
      <p>
        We use a single essential cookie to keep you signed in. We do not use third-party
        advertising or tracking cookies.
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
        <a href="mailto:privacy@stockstudio.app">privacy@stockstudio.app</a>
      </p>
    </div>
  );
}
