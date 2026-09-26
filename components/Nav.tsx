"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, FilePlus2, Eye, CandlestickChart, LogOut, CreditCard, Menu, X, Globe2, Radar, Sigma, HelpCircle, ShieldCheck } from "lucide-react";
import { useTour } from "@/components/guide/Tour";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { getSupabase } from "@/lib/supabase/lazy";
import { setRememberMe } from "@/lib/supabase/remember";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, tour: "dashboard" },
  { href: "/new", label: "New study", icon: FilePlus2, tour: "new" },
  { href: "/watchlist", label: "Watchlist", icon: Eye, tour: "watchlist" },
  { href: "/market", label: "Market", icon: Globe2, tour: "market" },
  { href: "/setups", label: "Setup bots", icon: Radar, tour: "setups" },
  { href: "/gamma", label: "Gamma exposure", icon: Sigma, tour: "gamma" },
  { href: "/billing", label: "Billing", icon: CreditCard, tour: "billing" },
];

type Props = { userEmail: string | null; userName: string | null; credits: number | null; isAdmin?: boolean };

// Sidebar from md up; on phones a top bar with a menu button that opens the
// same links in a drawer (the fixed 224px sidebar left ~100px for content).
export default function Nav({ userEmail, userName, credits, isAdmin = false }: Props) {
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
            <HelpButton onStart={() => setOpen(false)} />
            <ThemeToggle withLabel />
            {isAdmin && <AdminLink />}
            <Account userEmail={userEmail} userName={userName} />
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
        <HelpButton />
        <ThemeToggle withLabel />
        {isAdmin && <AdminLink />}
        <Account userEmail={userEmail} userName={userName} />
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
      {links.map(({ href, label, icon: Icon, tour }) => {
        // Study pages belong to the dashboard section.
        const active = pathname.startsWith(href) || (href === "/dashboard" && pathname.startsWith("/study"));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            data-tour={tour}
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

// Only rendered for platform admins; /admin re-checks on the server anyway.
function AdminLink() {
  return (
    <Link
      href="/admin"
      className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-amber-300 hover:bg-ink-800 hover:text-amber-200"
    >
      <ShieldCheck className="h-4 w-4" aria-hidden />
      Super admin
    </Link>
  );
}

// Replays the product tour (components/guide/Tour.tsx).
function HelpButton({ onStart }: { onStart?: () => void }) {
  const { start } = useTour();
  return (
    <button
      type="button"
      data-tour="help"
      onClick={() => {
        onStart?.();
        start();
      }}
      className="mt-2 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-slate-400 hover:bg-ink-800 hover:text-slate-200"
    >
      <HelpCircle className="h-4 w-4" aria-hidden />
      Help: take the tour
    </button>
  );
}

function Account({ userEmail, userName }: { userEmail: string | null; userName: string | null }) {
  const router = useRouter();
  async function signOut() {
    await (await getSupabase()).auth.signOut();
    setRememberMe(true); // clear the session-only flag
    router.push("/login");
    router.refresh();
  }
  return (
    <div className="mt-auto border-t border-ink-800 pt-3">
      {userName && <div className="truncate px-3 pt-1 text-sm text-slate-200">{userName}</div>}
      {userEmail && <div className="truncate px-3 pb-1 text-xs text-fg-subtle">{userEmail}</div>}
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
