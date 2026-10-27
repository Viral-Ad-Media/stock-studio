import type { Metadata } from "next";
import Nav from "@/components/Nav";
import { TourProvider } from "@/components/guide/Tour";
import { currentUser, currentWorkspaceId, accountDisabled } from "@/lib/workspace";
import { getBillingState } from "@/lib/billing";
import { isSuperAdmin } from "@/lib/admin";
import { SITE } from "@/lib/site";

// Authenticated app chrome (sidebar + main) — everything under the
// middleware-protected /dashboard, /new, /watchlist, /study/*, /billing routes.
// Kept separate from the public marketing layout (app/(marketing)) so
// logged-out visitors never see the app sidebar.
// Every app page is per-user (session cookie) — never prerender. Without this
// Next probes the layout at build time and the cookie read throws its
// dynamic-rendering signal into our error handling.
export const dynamic = "force-dynamic";

// Signed-in screens are private: never indexed, never followed.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Nav chrome only — a failure here must not take the page down, but it
  // shouldn't vanish silently either.
  const logged = (label: string) => (err: unknown) => {
    console.error(`app layout: ${label} failed`, err);
    return null;
  };
  const user = await currentUser().catch(logged("currentUser"));
  const ws = user ? await currentWorkspaceId().catch(logged("currentWorkspaceId")) : null;
  const billing = user && ws ? await getBillingState(user.id, ws).catch(logged("getBillingState")) : null;
  const admin = user ? await isSuperAdmin(user.id).catch(logged("isSuperAdmin")) : false;
  const disabled = user ? await accountDisabled(user.id).catch(logged("accountDisabled")) : false;
  if (disabled) {
    return (
      <main id="main" className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
        <h1 className="text-xl font-semibold text-slate-100">This account is disabled</h1>
        <p className="mt-2 text-sm text-slate-300">
          Your Stock Studio account has been turned off. If you think this is a mistake, email{" "}
          <a className="text-emerald-400 hover:underline" href={`mailto:${SITE.email}`}>{SITE.email}</a>.
        </p>
      </main>
    );
  }
  return (
    <TourProvider>
      <div className="min-h-screen md:flex">
        <Nav userEmail={user?.email ?? null} userName={user?.name ?? null} credits={billing?.balance ?? null} isAdmin={Boolean(admin)} />
        <main id="main" className="w-full min-w-0 flex-1 p-4 sm:p-6 md:p-8 max-w-[1440px] mx-auto">
          {children}
        </main>
      </div>
    </TourProvider>
  );
}
