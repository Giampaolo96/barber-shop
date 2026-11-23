import Link from "next/link";
import { redirect } from "next/navigation";
import { secondaryLinkClass } from "@/components/auth/secondary-link";
import { ReconsentForm } from "@/components/auth/reconsent-form";
import { it } from "@/i18n/it";
import { COMPLETE_PROFILE_PATH, HOME_PATH, PRIVACY_PATH } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/current-user";
import { safeNextPath } from "@/lib/auth/safe-next-path";

// Nuovo consenso quando cambia la versione dell'informativa (fetta 9b): senza, il cliente non crea
// nuove prenotazioni, ma vede e cancella le sue e gestisce il profilo.
export default async function ReconsentPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await requireRole(["customer"]);
  if (!user.profileComplete) redirect(COMPLETE_PROFILE_PATH);
  if (!user.privacyConsentOutdated) redirect(HOME_PATH);
  const next = safeNextPath((await searchParams).next);
  const t = it.auth.reconsent;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
      <h1 className="font-display text-4xl leading-tight">{t.title}</h1>
      <p className="text-sm text-muted-foreground">{t.intro}</p>
      <Link href={PRIVACY_PATH} className={secondaryLinkClass}>
        {t.privacyLink}
      </Link>
      <div className="w-full max-w-sm">
        <ReconsentForm next={next} />
      </div>
    </main>
  );
}
