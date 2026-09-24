import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import { currentUser, currentWorkspaceId } from "@/lib/workspace";
import { getBillingState } from "@/lib/billing";

export const metadata: Metadata = {
  title: "Stock Studio",
  description:
    "Queue tickers, let the research engine work, and get fact-checked investment case studies",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  const ws = user ? await currentWorkspaceId().catch(() => null) : null;
  const billing = user && ws ? await getBillingState(user.id, ws).catch(() => null) : null;
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <Nav userEmail={user?.email ?? null} credits={billing?.balance ?? null} />
          <main className="flex-1 p-8 max-w-5xl mx-auto w-full">{children}</main>
        </div>
      </body>
    </html>
  );
}
