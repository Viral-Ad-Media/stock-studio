import Link from "next/link";
import { CandlestickChart } from "lucide-react";

// Public marketing chrome — completely separate from the authenticated
// app's sidebar (app/(app)/layout.tsx). Logged-out visitors only ever see
// this simple header/footer, never the app Nav.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-ink-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link href="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap">
            <CandlestickChart className="w-6 h-6 text-emerald-400" aria-hidden />
            <span className="font-bold text-slate-100">Stock Studio</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-3 sm:gap-6 text-sm whitespace-nowrap">
            <Link href="/pricing" className="hidden sm:inline text-slate-400 hover:text-slate-200">
              Pricing
            </Link>
            <Link href="/login" className="text-slate-400 hover:text-slate-200">
              Sign in
            </Link>
            <Link href="/signup" className="btn-primary text-sm px-3 py-2 sm:px-4">
              <span className="sm:hidden">Try free</span>
              <span className="hidden sm:inline">Start free trial</span>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-ink-800 mt-auto">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-sm text-fg-subtle">
          <div className="flex items-center gap-2">
            <CandlestickChart className="w-4 h-4 text-emerald-400" />
            <span>Stock Studio</span>
          </div>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/pricing" className="hover:text-slate-300">
              Pricing
            </Link>
            <Link href="/terms" className="hover:text-slate-300">
              Terms of Service
            </Link>
            <Link href="/privacy" className="hover:text-slate-300">
              Privacy Policy
            </Link>
          </nav>
          <p className="text-xs text-fg-subtle max-w-md">
            Educational business analysis, not personalized investment advice.
          </p>
        </div>
      </footer>
    </div>
  );
}
