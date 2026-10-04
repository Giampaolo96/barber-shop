import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { it } from "@/i18n/it";
import { ADMIN_PATH, CUSTOMER_LOGIN_PATH, HOME_PATH, isStaffRole } from "@/lib/auth/access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { MY_BOOKINGS_PATH } from "@/lib/booking/paths";

const linkClass = "inline-flex h-11 items-center rounded-lg px-3 text-sm font-medium";

export default async function CustomerLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();

  return (
    <>
      <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <Link href={HOME_PATH} className={linkClass}>
          {it.shop.name}
        </Link>
        <div className="flex items-center gap-2">
          {user === null ? (
            <Link href={CUSTOMER_LOGIN_PATH} className={linkClass}>
              {it.nav.login}
            </Link>
          ) : (
            <>
              {isStaffRole(user.role) ? (
                <Link href={ADMIN_PATH} className={linkClass}>
                  {it.nav.staffArea}
                </Link>
              ) : (
                <>
                  <Link href={MY_BOOKINGS_PATH} className={linkClass}>
                    {it.nav.bookings}
                  </Link>
                  <Link href="/profilo" className={linkClass}>
                    {it.nav.profile}
                  </Link>
                </>
              )}
              <LogoutButton />
            </>
          )}
        </div>
      </header>
      {children}
    </>
  );
}
