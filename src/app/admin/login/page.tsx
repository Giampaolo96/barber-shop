import { StaffLoginForm } from "@/components/auth/staff-login-form";
import { it } from "@/i18n/it";
import { DISABLED_REASON } from "@/lib/auth/access";

export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string }>;
}) {
  const { motivo } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">{it.auth.staffLogin.title}</h1>
      <StaffLoginForm disabled={motivo === DISABLED_REASON} />
    </main>
  );
}
