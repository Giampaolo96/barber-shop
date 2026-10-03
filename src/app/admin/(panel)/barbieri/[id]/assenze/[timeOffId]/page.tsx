import Link from "next/link";
import { notFound } from "next/navigation";
import { PeriodForm } from "@/components/admin/period-form";
import { periodFormValues } from "@/components/admin/period-table";
import { it } from "@/i18n/it";
import { getShopTimezone } from "@/lib/admin/queries";
import { isUuid } from "@/lib/admin/schemas";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";

export default async function EditBarberTimeOffPage({
  params,
}: {
  params: Promise<{ id: string; timeOffId: string }>;
}) {
  await requireRole(["admin"]);
  const { id, timeOffId } = await params;
  if (!isUuid(id) || !isUuid(timeOffId)) notFound();

  const supabase = await createClient();
  const [{ data: row }, tz] = await Promise.all([
    supabase
      .from("time_off")
      .select("id, starts_at, ends_at, reason")
      .eq("id", timeOffId)
      .eq("barber_id", id)
      .maybeSingle(),
    getShopTimezone(supabase),
  ]);
  if (!row) notFound();

  return (
    <>
      <Link href={`/admin/barbieri/${id}/assenze`} className="text-sm underline">
        {it.admin.common.backToList}
      </Link>
      <h1 className="text-2xl font-semibold">{it.admin.period.editTitle}</h1>
      <PeriodForm kind="timeOff" values={periodFormValues(row, tz)} />
    </>
  );
}
