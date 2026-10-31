"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { it } from "@/i18n/it";
import { activeSection } from "@/lib/admin/active-section";

/** Menu dell'area staff. Client: il layout non si riesegue durante la navigazione. */
export function AdminNav({ sections }: { sections: ReadonlyArray<{ slug: string; href: string; label: string }> }) {
  const active = activeSection(usePathname(), sections);

  return (
    <nav aria-label={it.admin.nav.label} className="order-last col-span-2 flex flex-wrap gap-1 md:order-none md:flex-col">
      {sections.map((section) => (
        <Link
          key={section.slug}
          href={section.href}
          aria-current={section.slug === active ? "page" : undefined}
          className="flex min-h-11 shrink-0 items-center px-2 text-sm font-medium whitespace-nowrap hover:bg-disabled focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-ink aria-[current=page]:text-surface md:px-3"
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
