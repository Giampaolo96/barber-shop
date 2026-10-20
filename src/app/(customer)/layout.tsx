import Link from "next/link";
import { LinkPending } from "@/components/link-pending";
import type { ReactNode } from "react";
import { EmailLinkError } from "@/components/auth/email-link-error";
import { LogoutButton } from "@/components/auth/logout-button";
import { ShopBrandLink } from "@/components/shop-brand-link";
import { it } from "@/i18n/it";
import { ADMIN_PATH, CUSTOMER_LOGIN_PATH, isStaffRole } from "@/lib/auth/access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { MY_BOOKINGS_PATH } from "@/lib/booking/paths";
import { getShopInfo } from "@/lib/booking/queries";
import { AmbientBackground } from "@/themes/active";

const linkClass =
  "relative inline-flex h-11 items-center px-2 text-sm font-medium underline-offset-4 hover:underline";

export default async function CustomerLayout({ children }: { children: ReactNode }) {
  const [user, shop] = await Promise.all([getCurrentUser(), getShopInfo()]);

  return (
    <>
      <AmbientBackground />
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-1">
        {/* Nome del negozio dalle impostazioni (it.shop.name è solo il segnaposto). */}
        <ShopBrandLink name={shop?.name ?? it.shop.name} />
        <div className="flex shrink-0 items-center gap-1">
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
                    <LinkPending />
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
      <EmailLinkError />
      {children}
    </>
  );
}
