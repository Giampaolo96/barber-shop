import Link from "next/link";
import { CustomerLoginForm } from "@/components/auth/customer-login-form";
import { secondaryLinkClass } from "@/components/auth/secondary-link";
import { it } from "@/i18n/it";
import { STAFF_LOGIN_PATH } from "@/lib/auth/access";
import { safeNextPath } from "@/lib/auth/safe-next-path";

export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ errore?: string; next?: string }>;
}) {
  const { errore, next } = await searchParams;
  const t = it.auth.customerLogin;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
      {/* Margine di 16 px come le altre pagine clienti; il modulo resta stretto, a sinistra (fetta 8k). */}
      <h1 className="font-display text-4xl leading-tight text-glow">{t.title}</h1>
      <p className="text-sm text-muted-foreground">{t.intro}</p>
      {errore === "link" && (
        <p role="alert" className="border-l-2 border-destructive pl-3 text-destructive">
          {t.invalidLink}
        </p>
      )}
      <div className="w-full max-w-sm">
        <CustomerLoginForm next={safeNextPath(next)} />
      </div>
      <p className="max-w-sm text-sm text-muted-foreground">{t.firstAccess}</p>
      <Link href={STAFF_LOGIN_PATH} className={`mt-auto pt-8 ${secondaryLinkClass}`}>
        {it.auth.customerLogin.staffLink}
      </Link>
    </main>
  );
}
