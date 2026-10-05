import Link from "next/link";
import { notFound } from "next/navigation";
import { BarberForm } from "@/components/admin/barber-form";
import { StaffAccountSection } from "@/components/admin/staff-account-section";
import { buttonVariants } from "@/components/ui/button";
import { it } from "@/i18n/it";
import { isUuid } from "@/lib/admin/schemas";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";

export default async function BarberCardPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["admin"]);
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const [barberResult, enabledResult, servicesResult, accountsResult, staffResult] = await Promise.all([
    // Colonne esplicite: profile_id si legge solo con barber_accounts() (ADR 001).
    supabase.from("barbers").select("id, display_name, photo_url, bio, is_active").eq("id", id).maybeSingle(),
    supabase.from("barber_services").select("service_id").eq("barber_id", id),
    supabase.from("services").select("id, name, is_active").order("sort_order").order("id"),
    supabase.rpc("barber_accounts"),
    supabase.from("profiles").select("id, full_name, is_blocked").in("role", ["barber", "admin"]),
  ]);
  const barber = barberResult.data;
  if (!barber) notFound();
  for (const result of [enabledResult, servicesResult, accountsResult, staffResult]) {
    if (result.error) throw new Error(`scheda barbiere non leggibile: ${result.error.code}`);
  }

  const accounts = accountsResult.data ?? [];
  const staff = staffResult.data ?? [];
  const profileId = accounts.find((row) => row.barber_id === id)?.profile_id ?? null;
  const linkedProfile = staff.find((profile) => profile.id === profileId);
  const linkedIds = new Set(accounts.map((row) => row.profile_id));

  const link = buttonVariants({ variant: "outline", size: "sm" });

  return (
    <>
      <Link href="/admin/barbieri" className="text-sm underline">
        {it.admin.common.backToList}
      </Link>
      <h1 className="font-display text-4xl leading-tight">{it.admin.barbers.editTitle}</h1>
      <div className="flex flex-wrap gap-2">
        <Link href={`/admin/barbieri/${id}/orari`} className={link}>
          {it.admin.barbers.hours}
        </Link>
        <Link href={`/admin/barbieri/${id}/assenze`} className={link}>
          {it.admin.barbers.timeOff}
        </Link>
      </div>
      <BarberForm
        values={{
          id: barber.id,
          displayName: barber.display_name,
          photoUrl: barber.photo_url ?? "",
          bio: barber.bio ?? "",
          isActive: barber.is_active,
          serviceIds: (enabledResult.data ?? []).map((row) => row.service_id),
        }}
        services={(servicesResult.data ?? []).map((service) => ({
          id: service.id,
          name: service.name,
          isActive: service.is_active,
        }))}
      />
      <hr className="my-4" />
      <StaffAccountSection
        barberId={barber.id}
        account={
          linkedProfile
            ? {
                profileId: linkedProfile.id,
                fullName: linkedProfile.full_name ?? "",
                isBlocked: linkedProfile.is_blocked,
                isSelf: linkedProfile.id === user.id,
              }
            : null
        }
        staffWithoutCard={staff
          .filter((profile) => !linkedIds.has(profile.id))
          .map((profile) => ({ profileId: profile.id, fullName: profile.full_name ?? profile.id }))}
      />
    </>
  );
}
