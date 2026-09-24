"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, FilePlus2, Eye, CandlestickChart, LogOut, CreditCard, Menu, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/new", label: "New study", icon: FilePlus2 },
  { href: "/watchlist", label: "Watchlist", icon: Eye },
  { href: "/billing", label: "Billing", icon: CreditCard },
];

type Props = { userEmail: string | null; credits: number | null };

// Sidebar from md up; on phones a top bar with a menu button that opens the
// same links in a drawer (the fixed 224px sidebar left ~100px for content).
export default function Nav({ userEmail, credits }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the drawer on navigation and on Escape.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <header className="md:hidden sticky top-0 z-30 flex h-14 items-center justify-between border-b border-ink-700 bg-ink-900 px-4">
        <Brand />
        <button
          type="button"
          className="icon-btn"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
        </button>
      </header>

      {open && (
        <div className="md:hidden fixed inset-0 top-14 z-20 bg-ink-950/70" onClick={() => setOpen(false)}>
          <nav
            id="mobile-nav"
            aria-label="Main"
            className="flex h-full w-72 max-w-[85vw] flex-col gap-1 border-r border-ink-700 bg-ink-900 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <NavLinks pathname={pathname} credits={credits} />
            <Account userEmail={userEmail} />
          </nav>
        </div>
      )}

      <nav
        aria-label="Main"
        className="hidden md:flex w-56 shrink-0 flex-col gap-1 border-r border-ink-700 bg-ink-900 p-4"
      >
        <div className="mb-4 px-2 py-3">
          <Brand withTagline />
        </div>
        <NavLinks pathname={pathname} credits={credits} />
        <Account userEmail={userEmail} />
      </nav>
    </>
  );
}

function Brand({ withTagline = false }: { withTagline?: boolean }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 rounded-lg">
      <CandlestickChart className="h-6 w-6 text-emerald-400" aria-hidden />
      <div>
        <div className="font-bold leading-tight text-slate-100">Stock Studio</div>
        {withTagline && <div className="text-xs leading-tight text-fg-subtle">case study engine</div>}
      </div>
    </Link>
  );
}

function NavLinks({ pathname, credits }: { pathname: string; credits: number | null }) {
  return (
    <>
      {links.map(({ href, label, icon: Icon }) => {
        // Study pages belong to the dashboard section.
        const active = pathname.startsWith(href) || (href === "/dashboard" && pathname.startsWith("/study"));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm ${
              active ? "bg-ink-700 font-medium text-slate-100" : "text-slate-400 hover:bg-ink-800 hover:text-slate-200"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
            {href === "/billing" && credits !== null && (
              <span className={`ml-auto text-xs tabular-nums ${credits > 0 ? "text-slate-400" : "text-red-400"}`}>
                {credits} {credits === 1 ? "credit" : "credits"}
              </span>
            )}
          </Link>
        );
      })}
    </>
  );
}

function Account({ userEmail }: { userEmail: string | null }) {
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }
  return (
    <div className="mt-auto border-t border-ink-800 pt-3">
      {userEmail && <div className="truncate px-3 py-1 text-xs text-fg-subtle">{userEmail}</div>}
      <button
        type="button"
        onClick={signOut}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-slate-400 hover:bg-ink-800 hover:text-slate-200"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        Sign out
      </button>
    </div>
  );
}
