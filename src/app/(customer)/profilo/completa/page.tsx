import { redirect } from "next/navigation";
import { CompleteProfileForm } from "@/components/auth/complete-profile-form";
import { it } from "@/i18n/it";
import { HOME_PATH } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/current-user";
import { safeNextPath } from "@/lib/auth/safe-next-path";
import { createClient } from "@/lib/db/server";

export default async function CompleteProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await requireRole(["customer"]);
  if (user.profileComplete) redirect(HOME_PATH);

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", user.id)
    .maybeSingle();
  const t = it.auth.completeProfile;
  // Pagina a cui tornare dopo il salvataggio (es. il flusso di prenotazione).
  const next = safeNextPath((await searchParams).next);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="text-sm opacity-70">{t.intro}</p>
      <CompleteProfileForm
        fullName={profile?.full_name ?? ""}
        phone={profile?.phone ?? ""}
        next={next}
      />
    </main>
  );
}
