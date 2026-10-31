import Link from "next/link";
import { it } from "@/i18n/it";
import { newBookingPath } from "@/lib/calendar/paths";

/** Pulsante "Nuova prenotazione" del calendario, precompilato con barbiere e giorno. */
export function NewBookingLink({ barberId, date }: { barberId: string; date: string }) {
  return (
    <Link
      href={newBookingPath({ barberId, date })}
      aria-label={it.admin.calendar.newBooking}
      className="glow inline-flex min-h-11 shrink-0 items-center rounded-lg bg-primary px-4 text-sm font-medium whitespace-nowrap text-primary-foreground md:ml-auto"
    >
      <span className="md:hidden">{it.admin.calendar.newBookingShort}</span>
      <span className="hidden md:inline">{it.admin.calendar.newBooking}</span>
    </Link>
  );
}
