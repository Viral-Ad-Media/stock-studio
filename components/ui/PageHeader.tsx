import type { ReactNode } from "react";

export default function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="workspace-heading flex flex-wrap items-start justify-between gap-5">
      <div className="max-w-3xl">
        {eyebrow && <p className="desk-eyebrow">{eyebrow}</p>}
        <h1 className="text-3xl font-semibold tracking-tight text-slate-100 sm:text-4xl">
          {title}
        </h1>
        <div className="mt-3 max-w-[70ch] text-sm leading-6 text-fg-subtle">
          {description}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
