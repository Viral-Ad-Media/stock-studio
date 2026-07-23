"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FilePlus2, Eye, CandlestickChart } from "lucide-react";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/new", label: "New study", icon: FilePlus2 },
  { href: "/watchlist", label: "Watchlist", icon: Eye },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="w-56 shrink-0 border-r border-ink-700 bg-ink-900 p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 px-2 py-3 mb-4">
        <CandlestickChart className="w-6 h-6 text-emerald-400" />
        <div>
          <div className="font-bold text-slate-100 leading-tight">Stock Studio</div>
          <div className="text-[11px] text-slate-500 leading-tight">case study engine</div>
        </div>
      </div>
      {links.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm ${
              active
                ? "bg-ink-700 text-slate-100 font-medium"
                : "text-slate-400 hover:bg-ink-800 hover:text-slate-200"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        );
      })}
      <div className="mt-auto px-3 py-3 text-[11px] text-slate-600 leading-relaxed">
        Engine: Claude Code drains the jobs queue — run{" "}
        <code className="text-emerald-500">/build-studies</code> in this folder.
      </div>
    </nav>
  );
}
