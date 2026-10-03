import { redirect } from "next/navigation";
import { EMPTY_PERIOD, PeriodForm } from "@/components/admin/period-form";
import { PeriodTable } from "@/components/admin/period-table";
import { it } from "@/i18n/it";
import { deleteTimeOff } from "@/lib/admin/period-actions";
import { getOwnBarberId, getShopTimezone } from "@/lib/admin/queries";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";

/** Le proprie assenze (SPEC §2): del barbiere, o dell'admin che è anche barbiere. */
export default async function OwnTimeOffPage() {
  const user = await requireRole(["barber", "admin"]);

  const supabase = await createClient();
  const barberId = await getOwnBarberId(supabase);
  if (!barberId) {
    // L'admin senza scheda gestisce le assenze di tutti dalla sezione Barbieri.
    if (user.role === "admin") redirect("/admin/barbieri");
    return (
      <>
        <h1 className="text-2xl font-semibold">{it.admin.nav.timeOff}</h1>
        <p className="text-sm opacity-70">{it.admin.timeOff.noBarber}</p>
      </>
    );
  }

  const [timeOffResult, tz] = await Promise.all([
    supabase
      .from("time_off")
      .select("id, starts_at, ends_at, reason")
      .eq("barber_id", barberId)
      .order("starts_at", { ascending: false }),
    getShopTimezone(supabase),
  ]);
  if (timeOffResult.error) throw new Error(`assenze non leggibili: ${timeOffResult.error.code}`);

  return (
    <>
      <h1 className="text-2xl font-semibold">{it.admin.nav.timeOff}</h1>
      <h2 className="text-lg font-semibold">{it.admin.period.newTitle}</h2>
      <PeriodForm kind="timeOff" values={EMPTY_PERIOD} />
      <PeriodTable
        rows={timeOffResult.data}
        tz={tz}
        editHref={(id) => `/admin/assenze/${id}`}
        deleteAction={deleteTimeOff}
      />
    </>
  );
}
