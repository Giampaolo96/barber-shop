import { CustomerLoginForm } from "@/components/auth/customer-login-form";
import { it } from "@/i18n/it";
import { safeNextPath } from "@/lib/auth/safe-next-path";

export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ errore?: string; next?: string }>;
}) {
  const { errore, next } = await searchParams;
  const t = it.auth.customerLogin;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="text-sm opacity-70">{t.intro}</p>
      {errore === "link" && (
        <p role="alert" className="text-destructive">
          {t.invalidLink}
        </p>
      )}
      <CustomerLoginForm next={safeNextPath(next)} />
    </main>
  );
}
