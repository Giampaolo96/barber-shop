import Link from "next/link";
import { secondaryLinkClass } from "@/components/auth/secondary-link";
import { StaffLoginForm } from "@/components/auth/staff-login-form";
import { it } from "@/i18n/it";
import { CUSTOMER_LOGIN_PATH, DISABLED_REASON } from "@/lib/auth/access";

export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string }>;
}) {
  const { motivo } = await searchParams;

  return (
    <main data-area="admin" className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="font-display text-4xl leading-tight">{it.auth.staffLogin.title}</h1>
      <StaffLoginForm disabled={motivo === DISABLED_REASON} />
      <Link href={CUSTOMER_LOGIN_PATH} className={secondaryLinkClass}>
        {it.auth.staffLogin.customerLink}
      </Link>
    </main>
  );
}
