import Link from "next/link";
import { notFound } from "next/navigation";
import { PeriodForm } from "@/components/admin/period-form";
import { periodFormValues } from "@/components/admin/period-table";
import { it } from "@/i18n/it";
import { getOwnBarberId, getShopTimezone } from "@/lib/admin/queries";
import { isUuid } from "@/lib/admin/schemas";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";

export default async function EditOwnTimeOffPage({ params }: { params: Promise<{ timeOffId: string }> }) {
  await requireRole(["barber", "admin"]);
  const { timeOffId } = await params;
  if (!isUuid(timeOffId)) notFound();

  const supabase = await createClient();
  const barberId = await getOwnBarberId(supabase);
  if (!barberId) notFound();

  const [{ data: row }, tz] = await Promise.all([
    supabase
      .from("time_off")
      .select("id, starts_at, ends_at, reason")
      .eq("id", timeOffId)
      .eq("barber_id", barberId)
      .maybeSingle(),
    getShopTimezone(supabase),
  ]);
  if (!row) notFound();

  return (
    <>
      <Link href="/admin/assenze" className="text-sm underline">
        {it.admin.common.backToList}
      </Link>
      <h1 className="text-2xl font-semibold">{it.admin.period.editTitle}</h1>
      <PeriodForm kind="timeOff" values={periodFormValues(row, tz)} />
    </>
  );
}
