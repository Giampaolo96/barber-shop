import Link from "next/link";
import { notFound } from "next/navigation";
import { EMPTY_PERIOD, PeriodForm } from "@/components/admin/period-form";
import { PeriodTable } from "@/components/admin/period-table";
import { it } from "@/i18n/it";
import { deleteTimeOff } from "@/lib/admin/period-actions";
import { getShopTimezone } from "@/lib/admin/queries";
import { isUuid } from "@/lib/admin/schemas";
import { fillText } from "@/lib/admin/text";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";

export default async function BarberTimeOffPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const [barberResult, timeOffResult, tz] = await Promise.all([
    supabase.from("barbers").select("id, display_name").eq("id", id).maybeSingle(),
    supabase
      .from("time_off")
      .select("id, starts_at, ends_at, reason")
      .eq("barber_id", id)
      .order("starts_at", { ascending: false }),
    getShopTimezone(supabase),
  ]);
  if (!barberResult.data) notFound();
  if (timeOffResult.error) throw new Error(`assenze non leggibili: ${timeOffResult.error.code}`);

  return (
    <>
      <Link href={`/admin/barbieri/${id}`} className="text-sm underline">
        {it.admin.barbers.editTitle}
      </Link>
      <h1 className="text-2xl font-semibold">
        {fillText(it.admin.barbers.timeOffTitle, { name: barberResult.data.display_name })}
      </h1>
      <h2 className="text-lg font-semibold">{it.admin.period.newTitle}</h2>
      <PeriodForm kind="timeOff" values={EMPTY_PERIOD} barberId={id} />
      <PeriodTable
        rows={timeOffResult.data}
        tz={tz}
        editHref={(timeOffId) => `/admin/barbieri/${id}/assenze/${timeOffId}`}
        deleteAction={deleteTimeOff}
      />
    </>
  );
}
