export const metadata = { title: "Terms of Service — Stock Studio" };

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16 markdown">
      <div className="card p-4 mb-8 border-amber-500/30 text-sm text-amber-400">
        Template — has not been reviewed by a lawyer. Replace the bracketed placeholders and get
        this reviewed before relying on it for a real launch.
      </div>

      <h1>Terms of Service</h1>
      <p className="text-sm text-fg-subtle">Last updated: [DATE]</p>

      <h2>1. What Stock Studio is</h2>
      <p>
        Stock Studio (&ldquo;we&rdquo;, &ldquo;us&rdquo;, the &ldquo;Service&rdquo;) generates
        educational business-analysis case studies about publicly traded companies. Content is
        produced by an automated research process using large language models, real-time web
        search, and public market data.
      </p>

      <h2>2. Not investment advice</h2>
      <p>
        Nothing on the Service is personalized investment, financial, legal, or tax advice. Case
        studies are educational business-quality analysis, not a recommendation to buy, sell, or
        hold any security. You are solely responsible for your own investment decisions.
        Historical and forward-looking figures may be inaccurate, incomplete, or out of date
        despite our fact-checking process — verify anything material before acting on it.
      </p>

      <h2>3. Accounts and eligibility</h2>
      <p>
        You must provide accurate information to create an account and are responsible for
        activity under it. You must be at least 18 (or the age of majority in your jurisdiction)
        to use the Service.
      </p>

      <h2>4. Trial, billing, and credits</h2>
      <p>
        New accounts receive a free trial period as described on our{" "}
        <a href="/pricing">pricing page</a>. After the trial, continued use requires a one-time
        unlock fee and sufficient credit balance, both billed through our payment processor. Fees
        are non-refundable except where required by law or stated otherwise at checkout. We may
        change pricing prospectively with notice.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service to build a competing automated research product without permission</li>
        <li>Attempt to circumvent usage limits, credits, or access controls</li>
        <li>Use the Service for unlawful purposes, including market manipulation</li>
        <li>Scrape, resell, or redistribute generated content at scale without permission</li>
      </ul>

      <h2>6. Intellectual property</h2>
      <p>
        We retain rights to the Service itself. You retain rights to case studies generated for
        your account and may use them for your own personal or internal business purposes,
        including republishing individual studies with attribution.
      </p>

      <h2>7. Disclaimers and limitation of liability</h2>
      <p>
        The Service is provided &ldquo;as is&rdquo; without warranties of any kind. To the
        maximum extent permitted by law, we are not liable for any indirect, incidental, or
        consequential damages, or for any trading or investment losses arising from use of the
        Service.
      </p>

      <h2>8. Termination</h2>
      <p>
        You may stop using the Service at any time. We may suspend or terminate accounts that
        violate these terms.
      </p>

      <h2>9. Changes to these terms</h2>
      <p>
        We may update these terms from time to time. Material changes will be notified through
        the Service or by email.
      </p>

      <h2>10. Governing law</h2>
      <p>These terms are governed by the laws of [JURISDICTION], without regard to conflict-of-law principles.</p>

      <h2>11. Contact</h2>
      <p>
        Questions about these terms:{" "}
        <a href="mailto:support@stockstudio.app">support@stockstudio.app</a>
      </p>
    </div>
  );
}
