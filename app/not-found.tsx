import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-8 text-center">
        <h1 className="mb-2 text-lg font-semibold text-slate-100">Page not found</h1>
        <p className="mb-5 text-sm text-slate-400">
          This page doesn't exist, or the report was deleted.
        </p>
        <Link href="/dashboard" className="btn-primary text-sm px-4 py-2">
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
