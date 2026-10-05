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
      <aside className="flex flex-col gap-4 border-b p-4 md:w-56 md:border-r md:border-b-0">
        <p className="text-lg font-semibold">{it.admin.title}</p>
        <nav aria-label={it.admin.nav.label} className="flex flex-col gap-1">
          {sections.map((section) => (
            <Link
              key={section.slug}
              href={section.href}
              className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              {section.label}
            </Link>
          ))}
        </nav>
        <LogoutButton />
      </aside>
      {/* min-w-0: il contenuto largo (calendario) scorre nel proprio contenitore, non allarga la pagina. */}
      <main className="flex min-w-0 flex-1 flex-col gap-2 p-6">{children}</main>
    </div>
  );
}
