import Link from "next/link";
import { notFound } from "next/navigation";
import { HoursEditor } from "@/components/admin/hours-editor";
import { it } from "@/i18n/it";
import { isUuid } from "@/lib/admin/schemas";
import { fillText } from "@/lib/admin/text";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/db/server";

export default async function BarberHoursPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const [barberResult, hoursResult] = await Promise.all([
    supabase.from("barbers").select("id, display_name").eq("id", id).maybeSingle(),
    supabase
      .from("working_hours")
      .select("weekday, start_time, end_time")
      .eq("barber_id", id)
      .order("weekday")
      .order("start_time"),
  ]);
  if (!barberResult.data) notFound();
  if (hoursResult.error) throw new Error(`orari non leggibili: ${hoursResult.error.code}`);

  return (
    <>
      <Link href={`/admin/barbieri/${id}`} className="text-sm underline">
        {it.admin.barbers.editTitle}
      </Link>
      <h1 className="text-2xl font-semibold">
        {fillText(it.admin.barbers.hoursTitle, { name: barberResult.data.display_name })}
      </h1>
      <HoursEditor
        barberId={id}
        initialSlots={hoursResult.data.map((row, index) => ({
          key: index,
          weekday: row.weekday,
          // Il database restituisce HH:MM:SS; il campo time vuole HH:MM.
          start: row.start_time.slice(0, 5),
          end: row.end_time.slice(0, 5),
        }))}
      />
    </>
  );
}
