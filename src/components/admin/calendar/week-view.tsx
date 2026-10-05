import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { it } from "@/i18n/it";
import { formatDayLabel } from "@/lib/booking/format";
import { bookingDetailPath, newBookingPath } from "@/lib/calendar/paths";
import type { WeekDay } from "@/lib/calendar/page-data";
import { calendarHref } from "@/lib/calendar/view";
import { cn } from "@/lib/utils";

const t = it.admin.calendar;

/** Vista settimana (SPEC §6.1): un barbiere alla volta, un elenco per giorno. */
export function WeekView({
  barberId,
  barberActive,
  days,
  timezone,
  showCancelled,
}: {
  barberId: string;
  barberActive: boolean;
  days: WeekDay[];
  timezone: string;
  showCancelled: boolean;
}) {
  const time = (instant: Date) => formatInTimeZone(instant, timezone, "HH:mm");

  return (
    <div className="grid gap-3 md:grid-cols-7">
      {days.map((day) => (
        <section key={day.date} className={cn("flex flex-col gap-2 rounded-lg border p-2", !day.working && "bg-muted/60")}>
          <h2 className="text-sm font-semibold">
            <Link href={calendarHref({ date: day.date, showCancelled })} className="hover:underline">
              {formatDayLabel(day.date)}
            </Link>
          </h2>
          {!day.working && <p className="text-xs opacity-70">{t.dayOff}</p>}
          {day.bookings.length === 0 && <p className="text-xs opacity-70">{t.noBookings}</p>}
          <ul className="flex flex-col gap-1">
            {day.bookings.map((booking) => (
              <li key={booking.id}>
                <Link
                  href={bookingDetailPath(booking.id)}
                  className={cn(
                    "flex flex-col rounded-md border px-2 py-1 text-xs hover:bg-primary/10",
                    booking.status.startsWith("cancelled") && "line-through opacity-60",
                  )}
                >
                  <span className="font-medium">
                    {time(booking.startsAt)} {booking.customerName}
                  </span>
                  <span>
                    {booking.serviceName}
                    {booking.status === "confirmed" ? "" : ` · ${t.statusLabels[booking.status]}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {barberActive ? (
            <Link
              href={newBookingPath({ barberId, date: day.date })}
              className="mt-auto inline-flex min-h-11 items-center text-xs font-medium underline-offset-4 hover:underline"
            >
              {t.newBooking}
            </Link>
          ) : (
            <p className="mt-auto text-xs opacity-70">{t.inactiveBarberNoBooking}</p>
          )}
        </section>
      ))}
    </div>
  );
}
