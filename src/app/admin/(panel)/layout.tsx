import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { it } from "@/i18n/it";
import { requireRole } from "@/lib/auth/current-user";
import { ADMIN_SECTIONS } from "./sections";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireRole(["barber", "admin"]);
  const sections = ADMIN_SECTIONS.filter((section) => user.role === "admin" || !section.adminOnly);

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      {/* Su mobile: titolo ed "Esci" in una riga, sezioni scorrevoli sotto; da md colonna laterale. */}
      <aside className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line p-4 md:flex md:w-56 md:flex-col md:items-stretch md:gap-4 md:border-r md:border-b-0">
        <p className="font-display text-2xl">{it.admin.title}</p>
        <nav aria-label={it.admin.nav.label} className="order-last col-span-2 -mx-4 flex gap-1 overflow-x-auto px-4 md:order-none md:mx-0 md:flex-col md:overflow-visible md:px-0">
          {sections.map((section) => (
            <Link
              key={section.slug}
              href={section.href}
              className="flex min-h-11 shrink-0 items-center px-3 text-sm font-medium whitespace-nowrap hover:bg-disabled focus-visible:outline-2 focus-visible:outline-ring"
            >
              {section.label}
            </Link>
          ))}
        </nav>
        <LogoutButton />
      </aside>
      {/* min-w-0: il contenuto largo (calendario) scorre nel proprio contenitore, non allarga la pagina. */}
      <main className="flex min-w-0 flex-1 flex-col gap-4 p-6">{children}</main>
    </div>
  );
}
