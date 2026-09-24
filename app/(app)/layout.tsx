import Nav from "@/components/Nav";
import { currentUser } from "@/lib/workspace";

// Authenticated app chrome (sidebar + main) — everything under the
// middleware-protected /dashboard, /new, /watchlist, /study/* routes.
// Kept separate from the public marketing layout (app/(marketing)) so
// logged-out visitors never see the app sidebar.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  return (
    <div className="flex min-h-screen">
      <Nav userEmail={user?.email ?? null} />
      <main className="flex-1 p-8 max-w-5xl mx-auto w-full">{children}</main>
    </div>
  );
}
