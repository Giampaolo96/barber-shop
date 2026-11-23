import { formatInTimeZone } from "date-fns-tz";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { ProfileForm } from "@/components/auth/profile-form";
import { secondaryLinkClass } from "@/components/auth/secondary-link";
import { InstallAppEntry } from "@/components/pwa/install-banner";
import { it } from "@/i18n/it";
import { fillText } from "@/lib/admin/text";
import { COMPLETE_PROFILE_PATH, DELETE_ACCOUNT_PATH, PRIVACY_PATH } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/current-user";
import { getShopInfo } from "@/lib/booking/queries";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/db/server";

const t = it.profile;

// Profilo del cliente (SPEC §5.4, fetta 9b): email e consenso privacy in sola lettura; nome, telefono
// e marketing modificabili; in fondo installazione, uscita ed eliminazione dell'account.
export default async function ProfilePage() {
  const user = await requireRole(["customer"]);
  if (!user.profileComplete) redirect(COMPLETE_PROFILE_PATH);

  const supabase = await createClient();
  const [{ data: auth }, { data: profile }, shop] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("profiles")
      .select("full_name, phone, privacy_policy_version, privacy_consent_at, marketing_consent, marketing_consent_at")
      .eq("id", user.id)
      .maybeSingle(),
    getShopInfo(),
  ]);
  if (!profile) redirect(COMPLETE_PROFILE_PATH);

  // Date dei consensi nell'ora del negozio (SPEC §9), registrate dal database. Fuso orario sempre
  // dalle impostazioni: senza impostazioni le date non si mostrano (come nella home).
  const timezone = shop?.timezone ?? null;
  const when = (instant: string, zone: string): string => formatInTimeZone(new Date(instant), zone, "dd/MM/yyyy HH:mm");
  const marketingNote =
    profile.marketing_consent_at && timezone
      ? fillText(profile.marketing_consent ? t.marketingGiven : t.marketingRevoked, {
          date: when(profile.marketing_consent_at, timezone),
        })
      : null;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-6">
      <h1 className="font-display text-4xl leading-tight text-glow">{t.title}</h1>

      <dl className="flex flex-col gap-1">
        <dt className="text-sm text-muted-foreground">{t.emailLabel}</dt>
        <dd className="break-all">{auth.user?.email}</dd>
      </dl>

      <div className="w-full max-w-sm">
        <ProfileForm
          fullName={profile.full_name ?? ""}
          phone={profile.phone ?? ""}
          marketingConsent={profile.marketing_consent}
          marketingNote={marketingNote}
        />
      </div>

      <section className="flex flex-col gap-1">
        <h2 className="font-display text-2xl">{t.privacyTitle}</h2>
        {profile.privacy_consent_at && profile.privacy_policy_version && timezone && (
          <p className="text-sm">
            {fillText(t.privacyAccepted, {
              version: profile.privacy_policy_version,
              date: when(profile.privacy_consent_at, timezone),
            })}
          </p>
        )}
        <Link href={PRIVACY_PATH} className={secondaryLinkClass}>
          {t.privacyLink}
        </Link>
      </section>

      <div className="mt-2 flex flex-col items-start gap-2 border-t border-line pt-4">
        <InstallAppEntry />
        <LogoutButton />
        <Link href={DELETE_ACCOUNT_PATH} className={cn(secondaryLinkClass, "text-destructive hover:text-destructive")}>
          {t.deleteAccount}
        </Link>
      </div>
    </main>
  );
}
