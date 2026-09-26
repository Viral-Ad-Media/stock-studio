import { CheckCircle2, XCircle } from "lucide-react";
import { sql, formatDate, adminWritesConfigured } from "@/lib/db";
import { requireSuperAdminPage } from "@/lib/admin";
import { SITE } from "@/lib/site";

export const metadata = { title: "System" };

// Presence only — never print a secret's value.
const ENV = [
  { key: "DATABASE_URL", what: "App database connection" },
  { key: "BILLING_DATABASE_URL", what: "Stripe webhook's billing connection" },
  { key: "ADMIN_DATABASE_URL", what: "This console's write connection (stocks_admin)" },
  { key: "NEXT_PUBLIC_SUPABASE_URL", what: "Supabase Auth" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", what: "Supabase Auth" },
  { key: "NEXT_PUBLIC_APP_URL", what: "Public URL for redirects, canonicals and the sitemap" },
  { key: "ANTHROPIC_API_KEY", what: "Automated research worker" },
  { key: "ENGINE_WEBHOOK_SECRET", what: "Worker trigger authentication" },
  { key: "STRIPE_SECRET_KEY", what: "Checkout" },
  { key: "STRIPE_WEBHOOK_SECRET", what: "Payment webhook verification" },
  { key: "STRIPE_PRICE_ACCESS", what: "One-time access price" },
  { key: "STRIPE_PRICE_CREDIT_PACK", what: "Credit pack price" },
];

export default async function AdminSystem() {
  await requireSuperAdminPage();
  const [worker] = await sql`
    SELECT max(updated_at) FILTER (WHERE status = 'done') AS last_done,
           max(locked_at) AS last_claim,
           count(*) FILTER (WHERE status = 'running' AND locked_at IS NOT NULL)::int AS worker_running
    FROM jobs
  `;
  const scans = await sql`SELECT session_date, status, universe_size, error, finished_at FROM setup_scans ORDER BY session_date DESC LIMIT 5`;
  const [matches] = await sql`SELECT count(*)::int AS open FROM setup_matches WHERE resolved_at IS NULL`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">System</h1>
        <p className="mt-1 text-sm text-fg-subtle">Configuration and background work. Site URL in use: {SITE.url}</p>
      </div>

      <section aria-labelledby="env-heading" className="card p-4">
        <h2 id="env-heading" className="mb-3 text-sm font-semibold text-slate-100">Environment</h2>
        <ul className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          {ENV.map((e) => {
            const set = e.key === "ADMIN_DATABASE_URL" ? adminWritesConfigured() : Boolean(process.env[e.key]);
            return (
              <li key={e.key} className="flex items-start gap-2">
                {set ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />}
                <span>
                  <span className="font-mono text-xs text-slate-100">{e.key}</span> <span className="text-slate-300">{set ? "set" : "missing"}</span>
                  <span className="block text-xs text-fg-subtle">{e.what}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="worker-heading" className="card p-4">
        <h2 id="worker-heading" className="mb-3 text-sm font-semibold text-slate-100">Research worker</h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-fg-subtle">Last job completed</dt><dd className="text-slate-200">{worker.last_done ? formatDate(worker.last_done) : "Never"}</dd></div>
          <div><dt className="text-xs text-fg-subtle">Last automated claim</dt><dd className="text-slate-200">{worker.last_claim ? formatDate(worker.last_claim) : "Never"}</dd></div>
          <div><dt className="text-xs text-fg-subtle">Held by the worker now</dt><dd className="text-slate-200">{worker.worker_running}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-fg-subtle">
          If automated claims show &ldquo;Never&rdquo;, check that the Supabase Vault secret engine_webhook_url points at /api/engine/run on this host.
        </p>
      </section>

      <section aria-labelledby="scan-heading" className="card p-4">
        <h2 id="scan-heading" className="mb-3 text-sm font-semibold text-slate-100">Setup-bot scans</h2>
        {scans.length === 0 ? <p className="text-sm text-fg-subtle">No scans yet. The worker runs one after each market close.</p> : (
          <ul className="divide-y divide-ink-800 text-sm">
            {scans.map((s) => (
              <li key={s.session_date} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span className="text-slate-200">{s.session_date} · {s.status}{s.universe_size ? ` · ${s.universe_size} stocks` : ""}</span>
                <span className="text-xs text-fg-subtle">{s.error ?? (s.finished_at ? `finished ${formatDate(s.finished_at)}` : "")}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-fg-subtle">{matches.open} matches still being tracked.</p>
      </section>
    </div>
  );
}
