import Link from "next/link";
import { CandlestickChart } from "lucide-react";

// Public marketing chrome — completely separate from the authenticated
// app's sidebar (app/(app)/layout.tsx). Logged-out visitors only ever see
// this simple header/footer, never the app Nav.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-ink-800">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <CandlestickChart className="w-6 h-6 text-emerald-400" />
            <span className="font-bold text-slate-100">Stock Studio</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/pricing" className="text-slate-400 hover:text-slate-200">
              Pricing
            </Link>
            <Link href="/login" className="text-slate-400 hover:text-slate-200">
              Sign in
            </Link>
            <Link
              href="/signup"
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              Start free trial
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-ink-800 mt-auto">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-sm text-slate-500">
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
          <p className="text-xs text-slate-600 max-w-md">
            Educational business analysis, not personalized investment advice.
          </p>
        </div>
      </footer>
    </div>
  );
}
