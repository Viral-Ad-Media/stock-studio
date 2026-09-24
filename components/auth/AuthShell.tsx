import Link from "next/link";
import { CandlestickChart } from "lucide-react";

// Shared frame for login / signup / password pages.
export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 p-4">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <CandlestickChart className="h-7 w-7 text-emerald-400" aria-hidden />
          <span className="text-lg font-bold text-slate-100">Stock Studio</span>
        </Link>
        <div className="card p-6 sm:p-8">
          <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-4 text-center text-sm text-slate-400">{footer}</div>}
      </div>
    </main>
  );
}
