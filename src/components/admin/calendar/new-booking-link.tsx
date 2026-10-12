import Link from "next/link";
import { it } from "@/i18n/it";
import { newBookingPath } from "@/lib/calendar/paths";

/** Pulsante "Nuova prenotazione" del calendario, precompilato con barbiere e giorno. */
export function NewBookingLink({ barberId, date }: { barberId: string; date: string }) {
  return (
    <Link
      href={newBookingPath({ barberId, date })}
      className="inline-flex min-h-11 items-center self-start rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
    >
      {it.admin.calendar.newBooking}
    </Link>
  );
}
