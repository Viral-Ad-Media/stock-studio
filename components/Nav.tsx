"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, FilePlus2, Eye, CandlestickChart, LogOut, CreditCard } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/new", label: "New study", icon: FilePlus2 },
  { href: "/watchlist", label: "Watchlist", icon: Eye },
  { href: "/billing", label: "Billing", icon: CreditCard },
];

export default function Nav({ userEmail, credits }: { userEmail: string | null; credits: number | null }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

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
        const active = pathname.startsWith(href);
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
            {href === "/billing" && credits !== null && (
              <span className={`ml-auto text-[11px] ${credits > 0 ? "text-slate-500" : "text-red-400"}`}>
                {credits} cr
              </span>
            )}
          </Link>
        );
      })}
      <div className="mt-auto pt-3 border-t border-ink-800">
        {userEmail && <div className="px-3 py-1 text-[11px] text-slate-500 truncate">{userEmail}</div>}
        <button
          onClick={signOut}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-ink-800 hover:text-slate-200"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </nav>
  );
}
