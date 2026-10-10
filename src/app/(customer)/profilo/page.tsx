import { redirect } from "next/navigation";
import { InstallAppEntry } from "@/components/pwa/install-banner";
import { it } from "@/i18n/it";
import { COMPLETE_PROFILE_PATH } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/current-user";

// Pagina privata del cliente: per ora un segnaposto, la gestione del profilo arriva dopo.
export default async function ProfilePage() {
  const user = await requireRole(["customer"]);
  if (!user.profileComplete) redirect(COMPLETE_PROFILE_PATH);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-2 p-6">
      <h1 className="font-display text-4xl leading-tight">{it.profile.title}</h1>
      <p className="text-sm text-muted-foreground">{it.profile.comingSoon}</p>
      <div className="mt-6">
        <InstallAppEntry />
      </div>
    </main>
  );
}
