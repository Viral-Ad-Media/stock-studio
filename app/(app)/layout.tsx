import Nav from "@/components/Nav";
import { currentUser, currentWorkspaceId } from "@/lib/workspace";
import { getBillingState } from "@/lib/billing";

// Authenticated app chrome (sidebar + main) — everything under the
// middleware-protected /dashboard, /new, /watchlist, /study/*, /billing routes.
// Kept separate from the public marketing layout (app/(marketing)) so
// logged-out visitors never see the app sidebar.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  const ws = user ? await currentWorkspaceId().catch(() => null) : null;
  const billing = user && ws ? await getBillingState(user.id, ws).catch(() => null) : null;
  return (
    <div className="flex min-h-screen">
      <Nav userEmail={user?.email ?? null} credits={billing?.balance ?? null} />
      <main className="flex-1 p-8 max-w-5xl mx-auto w-full">{children}</main>
    </div>
  );
}
