import "server-only";

// Dati delle viste del calendario (SPEC §6.1), letti con il client della richiesta (RLS attiva).
import type { CurrentUser } from "@/lib/auth/profile";
import { getOwnBarberId } from "@/lib/admin/queries";
import type { createClient } from "@/lib/db/server";
import { addDays, startOfLocalDay } from "@/lib/domain/local-time";
import { type DayGrid, dayGrid, type Interval, localBandsToIntervals, weekDates } from "./grid";
import {
  bandsOn,
  type CalendarBarber,
  type CalendarBooking,
  type CalendarPeriod,
  type CalendarSettings,
  getBarbers,
  getBookingsInRange,
  getClosures,
  getTimeOff,
  getWorkingBands,
} from "./queries";
import { type CalendarQuery, defaultWeekBarber } from "./view";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type DayColumn = {
  barberId: string;
  barberName: string;
  /** Un barbiere disattivato si mostra (ha prenotazioni) ma non è prenotabile. */
  isActive: boolean;
  bands: Interval[];
  bookings: CalendarBooking[];
  /** Assenze del barbiere e chiusure del negozio. */
  periods: Array<CalendarPeriod & { kind: "timeOff" | "closure" }>;
};

export type WeekDay = { date: string; working: boolean; bookings: CalendarBooking[] };

const isCancelled = (booking: CalendarBooking): boolean => booking.status.startsWith("cancelled");

/**
 * Barbieri visibili all'utente: il barbiere vede solo la propria scheda (SPEC §2), l'admin tutte.
 * `ownBarberId` è la scheda collegata all'utente (anche un admin barbiere).
 */
export async function getStaffBarbers(
  supabase: ServerClient,
  user: CurrentUser,
): Promise<{ barbers: CalendarBarber[]; ownBarberId: string | null }> {
  const [barbers, ownBarberId] = await Promise.all([getBarbers(supabase), getOwnBarberId(supabase)]);
  if (user.role === "admin") return { barbers, ownBarberId };
  return { barbers: barbers.filter((barber) => barber.id === ownBarberId), ownBarberId };
}

export type DayViewData = {
  grid: DayGrid;
  columns: DayColumn[];
  cancelledCount: number;
};

/** Vista giorno: barbieri attivi più quelli disattivati che hanno prenotazioni nel giorno. */
export async function loadDayView(
  supabase: ServerClient,
  settings: CalendarSettings,
  query: CalendarQuery,
  barbers: CalendarBarber[],
): Promise<DayViewData> {
  const { timezone } = settings;
  const from = startOfLocalDay(query.date, timezone);
  const to = startOfLocalDay(addDays(query.date, 1), timezone);
  const ids = barbers.map((barber) => barber.id);

  const [bookings, bands, timeOff, closures] = await Promise.all([
    getBookingsInRange(supabase, ids, from, to),
    getWorkingBands(supabase, ids),
    getTimeOff(supabase, ids, from, to),
    getClosures(supabase, from, to),
  ]);

  const shown = bookings.filter((booking) => query.showCancelled || !isCancelled(booking));
  const visible = barbers.filter(
    (barber) => barber.isActive || bookings.some((booking) => booking.barberId === barber.id),
  );
  const columns: DayColumn[] = visible.map((barber) => ({
    barberId: barber.id,
    barberName: barber.displayName,
    isActive: barber.isActive,
    bands: localBandsToIntervals(query.date, bandsOn(bands, barber.id, query.date), timezone),
    bookings: shown.filter((booking) => booking.barberId === barber.id),
    periods: [
      ...timeOff
        .filter((period) => period.barberId === barber.id)
        .map((period) => ({ ...period, kind: "timeOff" as const })),
      ...closures.map((period) => ({ ...period, kind: "closure" as const })),
    ],
  }));

  const grid = dayGrid({
    date: query.date,
    tz: timezone,
    granularityMin: settings.granularityMin,
    bands: visible.flatMap((barber) => bandsOn(bands, barber.id, query.date)),
    bookings: shown.filter((booking) => visible.some((barber) => barber.id === booking.barberId)),
  });

  return { grid, columns, cancelledCount: bookings.filter(isCancelled).length };
}

export type WeekViewData = { barberId: string | null; days: WeekDay[]; cancelledCount: number };

/** Vista settimana di un barbiere: il barbiere sempre il proprio, l'admin quello scelto. */
export async function loadWeekView(
  supabase: ServerClient,
  settings: CalendarSettings,
  query: CalendarQuery,
  barbers: CalendarBarber[],
  ownBarberId: string | null,
): Promise<WeekViewData> {
  const chosen = barbers.find((barber) => barber.id === query.barberId)?.id;
  const barberId = chosen ?? defaultWeekBarber({ ownBarberId, barbers });
  const dates = weekDates(query.date);
  if (!barberId) return { barberId: null, days: [], cancelledCount: 0 };

  const from = startOfLocalDay(dates[0], settings.timezone);
  const to = startOfLocalDay(addDays(dates[6], 1), settings.timezone);
  const [bookings, bands] = await Promise.all([
    getBookingsInRange(supabase, [barberId], from, to),
    getWorkingBands(supabase, [barberId]),
  ]);

  const days = dates.map((date) => {
    const dayStart = startOfLocalDay(date, settings.timezone).getTime();
    const dayEnd = startOfLocalDay(addDays(date, 1), settings.timezone).getTime();
    return {
      date,
      working: bandsOn(bands, barberId, date).length > 0,
      bookings: bookings.filter(
        (booking) =>
          booking.startsAt.getTime() >= dayStart &&
          booking.startsAt.getTime() < dayEnd &&
          (query.showCancelled || !isCancelled(booking)),
      ),
    };
  });
  return { barberId, days, cancelledCount: bookings.filter(isCancelled).length };
}
