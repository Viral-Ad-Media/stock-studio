"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { Gauge, Users, ListChecks, ScrollText, Server, ArrowLeft, ShieldCheck } from "lucide-react";

const LINKS = [
  { href: "/admin", label: "Overview", icon: Gauge, exact: true },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/jobs", label: "Jobs", icon: ListChecks },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/system", label: "System", icon: Server },
];

export default function AdminNav({ email }: { email: string | null }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="border-b border-ink-700 bg-ink-900 md:min-h-screen md:w-56 md:shrink-0 md:border-b-0 md:border-r">
      <div className="flex items-center gap-2 px-4 py-4">
        <ShieldCheck className="h-5 w-5 text-amber-300" aria-hidden />
        <div>
          <div className="font-bold leading-tight text-slate-100">Super admin</div>
          <div className="max-w-[10rem] truncate text-xs text-fg-subtle">{email}</div>
        </div>
      </div>
      <ul className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
        {LINKS.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm ${
                  active ? "bg-ink-700 font-medium text-slate-100" : "text-slate-400 hover:bg-ink-800 hover:text-slate-200"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden /> {label}
              </Link>
            </li>
          );
        })}
        <li className="shrink-0 md:mt-4 md:border-t md:border-ink-800 md:pt-3">
          <ThemeToggle withLabel />
        </li>
        <li className="shrink-0">
          <Link href="/dashboard" className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-slate-400 hover:bg-ink-800 hover:text-slate-200">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the app
          </Link>
        </li>
      </ul>
    </nav>
  );
}
