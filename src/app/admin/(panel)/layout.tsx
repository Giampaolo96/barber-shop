import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/admin-nav";
import { LogoutButton } from "@/components/auth/logout-button";
import { requireRole } from "@/lib/auth/current-user";
import { getShopInfo } from "@/lib/booking/queries";
import { ADMIN_SECTIONS } from "./sections";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const [user, shop] = await Promise.all([requireRole(["barber", "admin"]), getShopInfo()]);
  const sections = ADMIN_SECTIONS.filter((section) => user.role === "admin" || !section.adminOnly);

  return (
    <div data-area="admin" className="flex flex-1 flex-col md:flex-row">
      {/* Su mobile: nome ed "Esci" in una riga, sezioni a capo sotto; da md colonna laterale fissa. */}
      <aside className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line p-4 md:sticky md:top-0 md:flex md:h-dvh md:w-56 md:shrink-0 md:flex-col md:items-stretch md:gap-4 md:overflow-y-auto md:border-r md:border-b-0">
        <p className="min-w-0 font-display text-2xl leading-tight">{shop?.name}</p>
        <AdminNav sections={sections} />
        <LogoutButton quiet className="md:mt-auto" />
      </aside>
      {/* min-w-0: il contenuto largo (calendario) scorre nel proprio contenitore, non allarga la pagina. */}
      <main className="flex min-w-0 flex-1 flex-col gap-4 p-6">{children}</main>
    </div>
  );
}
