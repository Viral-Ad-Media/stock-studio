import type { Metadata } from "next";
import { requireSuperAdminPage } from "@/lib/admin";
import RefreshButton from "@/components/admin/RefreshButton";
import AdminNav from "@/components/admin/AdminNav";

// The super-admin console. Every page and route under it re-checks
// platform_admins; non-admins get a 404.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin | Stock Studio" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireSuperAdminPage();
  return (
    <div className="min-h-screen bg-ink-950 md:flex">
      <AdminNav email={user.email} />
      <main
        id="main"
        className="mx-auto w-full min-w-0 max-w-6xl flex-1 p-4 sm:p-6 md:p-8"
      >
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-ink-700 pb-4">
          <p className="desk-eyebrow">Stock Studio · Operations</p>
          <RefreshButton />
        </div>
        {children}
      </main>
    </div>
  );
}
