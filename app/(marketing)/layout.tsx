import Link from "next/link";
import { CandlestickChart } from "lucide-react";
import { SITE } from "@/lib/site";
import ThemeToggle from "@/components/theme/ThemeToggle";

// Public marketing chrome — completely separate from the authenticated
// app's sidebar (app/(app)/layout.tsx). Logged-out visitors only ever see
// this header/footer, never the app Nav.
const FOOTER = [
  {
    heading: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/#how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    heading: "Account",
    links: [
      { href: "/signup", label: "Start free trial" },
      { href: "/login", label: "Sign in" },
      { href: "/forgot-password", label: "Reset password" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/terms", label: "Terms of Service" },
      { href: "/privacy", label: "Privacy Policy" },
    ],
  },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-emerald-500 focus:px-4 focus:py-2 focus:text-ink-950"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-ink-800 bg-ink-950/85 backdrop-blur supports-[backdrop-filter]:bg-ink-950/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap" aria-label="Stock Studio home">
            <CandlestickChart className="h-6 w-6 text-emerald-400" aria-hidden />
            <span className="font-bold text-slate-100">Stock Studio</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-3 whitespace-nowrap text-sm sm:gap-6">
            <Link href="/#features" className="hidden text-slate-300 hover:text-slate-100 md:inline">
              Features
            </Link>
            <Link href="/pricing" className="hidden text-slate-300 hover:text-slate-100 sm:inline">
              Pricing
            </Link>
            <Link href="/login" className="text-slate-300 hover:text-slate-100">
              Sign in
            </Link>
            <ThemeToggle />
            <Link href="/signup" className="btn-primary px-3 py-2 text-sm sm:px-4">
              <span className="sm:hidden">Try free</span>
              <span className="hidden sm:inline">Start free trial</span>
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="mt-auto border-t border-ink-800 bg-ink-900/40">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-12 md:grid-cols-5">
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-2">
              <CandlestickChart className="h-5 w-5 text-emerald-400" aria-hidden />
              <span className="font-bold text-slate-100">Stock Studio</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm text-fg-subtle">
              Fact-checked, source-cited stock case studies. Educational business analysis, not personalized
              investment advice.
            </p>
            <p className="mt-3 text-sm text-fg-subtle">
              Contact:{" "}
              <a href={`mailto:${SITE.email}`} className="text-slate-300 underline underline-offset-2 hover:text-slate-100">
                {SITE.email}
              </a>
            </p>
          </div>
          {FOOTER.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-300">{col.heading}</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-fg-subtle hover:text-slate-200">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="border-t border-ink-800">
          <p className="mx-auto max-w-6xl px-6 py-5 text-xs text-fg-subtle">
            © {new Date().getFullYear()} {SITE.operator}. Stock Studio is operated by {SITE.operator}.
          </p>
        </div>
      </footer>
    </div>
  );
}
