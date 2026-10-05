import Link from "next/link";
import { ManualBookingForm } from "@/components/admin/calendar/manual-booking-form";
import { it } from "@/i18n/it";
import { requireRole } from "@/lib/auth/current-user";
import { getStaffBarbers } from "@/lib/calendar/page-data";
import { getCalendarSettings, getServices } from "@/lib/calendar/queries";
import { calendarHref, newBookingBarber, parseCalendarQuery } from "@/lib/calendar/view";
import { createClient } from "@/lib/db/server";
import { isValidLocalTime, localDateOf } from "@/lib/domain/local-time";

const t = it.admin.calendar;

// Nuova prenotazione manuale (SPEC §6.2), precompilata dal click su uno slot vuoto:
// ?barbiere=<uuid>&data=YYYY-MM-DD&ora=HH:MM. Il barbiere prenota solo per sé (SPEC §2).
export default async function NewManualBookingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(["barber", "admin"]);
  const supabase = await createClient();
  const params = await searchParams;

  const [settings, { barbers }, services] = await Promise.all([
    getCalendarSettings(supabase),
    getStaffBarbers(supabase, user),
    getServices(supabase),
  ]);
  const query = parseCalendarQuery(params, localDateOf(new Date(), settings.timezone));
  const time = typeof params.ora === "string" && isValidLocalTime(params.ora) ? params.ora : "";
  const bookable = barbers.filter((barber) => barber.isActive);
  const activeServices = services.filter((service) => service.isActive);
  const { barberId, requestedUnavailable } = newBookingBarber({ requestedId: query.barberId, barbers });

  return (
    <div className="flex flex-col gap-4">
      <Link href={calendarHref({ date: query.date })} className="text-sm underline underline-offset-4">
        {it.admin.calendar.detail.backToCalendar}
      </Link>
      <h1 className="text-2xl font-semibold">{t.form.title}</h1>
      {requestedUnavailable && (
        <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          {t.requestedBarberUnavailable}
        </p>
      )}
      {barberId ? (
        <ManualBookingForm
          barbers={bookable.map((barber) => ({ id: barber.id, label: barber.displayName }))}
          services={activeServices.map((service) => ({
            id: service.id,
            label: `${service.name} (${t.detail.minutes.replace("{count}", String(service.durationMin))})`,
          }))}
          defaults={{ barberId, serviceId: activeServices[0]?.id ?? "", date: query.date, time }}
        />
      ) : (
        <p className="text-sm">{user.role === "admin" ? t.noBarbers : t.noOwnBarber}</p>
      )}
    </div>
  );
}
