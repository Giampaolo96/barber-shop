"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CUSTOMER_LOGIN_PATH } from "@/lib/auth/access";

/** "Accedi" in testata, tranne sulla pagina di accesso (il layout, server, non conosce il percorso). */
export function LoginNavLink({ className, children }: { className: string; children: React.ReactNode }) {
  if (usePathname() === CUSTOMER_LOGIN_PATH) return null;
  return (
    <Link href={CUSTOMER_LOGIN_PATH} className={className}>
      {children}
    </Link>
  );
}
