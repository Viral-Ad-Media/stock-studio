import type { ReactNode } from "react";

// The one page header for every signed-in screen: title, a dated or
// contextual meta line when the page has one, a short description, and the
// page's primary actions on the right.
export default function PageHeader({
  title,
  meta,
  description,
  actions,
  className = "",
}: {
  title: ReactNode;
  meta?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-ink-700 pb-5 ${className}`}
    >
      <div className="min-w-0 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl">
          {title}
        </h1>
        {meta && <p className="mt-1 text-sm text-slate-400">{meta}</p>}
        {description && (
          <div className="mt-2 max-w-[70ch] text-sm leading-6 text-fg-subtle">
            {description}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
