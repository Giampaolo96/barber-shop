"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HOME_PATH } from "@/lib/auth/access";
import { splitShopName } from "@/lib/shop/name";

/**
 * Nome del negozio nella testata dell'area clienti, link alla home. Sulla home non compare: lì il
 * nome è già il titolo della testata in marmo.
 */
export function ShopBrandLink({ name }: { name: string }) {
  const pathname = usePathname();
  if (pathname === HOME_PATH) return <span />;
  const { lead } = splitShopName(name);
  return (
    <Link href={HOME_PATH} aria-label={name} className="inline-flex h-11 min-w-0 items-center font-display text-xl">
      {/* Su mobile la prima parola, così la testata non va a capo; da sm il nome completo. */}
      <span className="sm:hidden">{lead}</span>
      <span className="hidden sm:inline">{name}</span>
    </Link>
  );
}
