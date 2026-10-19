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
  getOpenWeekdays,
  getTimeOff,
  getWorkingBands,
} from "./queries";
import { type CalendarQuery, defaultWeekBarber } from "./view";
import { isClosedDay, visibleWeekDays, weekGrid, type WeekGrid } from "./week-grid";

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

/** Colonna di un giorno nella vista settimana (fetta 8c). */
export type WeekDay = {
  date: string;
  bands: Interval[];
  bookings: CalendarBooking[];
  /** Assenze del barbiere e chiusure del negozio che toccano il giorno. */
  periods: Array<CalendarPeriod & { kind: "timeOff" | "closure" }>;
  /** Il negozio è chiuso per l'intera giornata. */
  closed: boolean;
};

const isCancelled = (booking: CalendarBooking): boolean => booking.status.startsWith("cancelled");

export type StaffBarbers = { barbers: CalendarBarber[]; ownBarberId: string | null };

/**
 * Tutte le schede leggibili (RLS) e la scheda collegata all'utente (anche un admin barbiere). Non
 * dipende dal ruolo: prima di mostrarle si filtrano con staffBarbersFor.
 */
export async function getBarbersWithOwn(supabase: ServerClient): Promise<StaffBarbers> {
  const [barbers, ownBarberId] = await Promise.all([getBarbers(supabase), getOwnBarberId(supabase)]);
  return { barbers, ownBarberId };
}

/** Barbieri visibili all'utente: il barbiere vede solo la propria scheda (SPEC §2), l'admin tutte. */
export function staffBarbersFor(user: CurrentUser, { barbers, ownBarberId }: StaffBarbers): StaffBarbers {
  if (user.role === "admin") return { barbers, ownBarberId };
  return { barbers: barbers.filter((barber) => barber.id === ownBarberId), ownBarberId };
}

export async function getStaffBarbers(supabase: ServerClient, user: CurrentUser): Promise<StaffBarbers> {
  return staffBarbersFor(user, await getBarbersWithOwn(supabase));
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

export type WeekViewData = {
  barberId: string | null;
  grid: WeekGrid | null;
  /** Solo i giorni da disegnare (visibleWeekDays), da lunedì a domenica. */
  days: WeekDay[];
  cancelledCount: number;
};

/**
 * Vista settimana di un barbiere (fetta 8c): il barbiere sempre il proprio, l'admin quello scelto.
 * Una query per tabella su tutta la settimana [lunedì, lunedì successivo), mai una per giorno. I giorni
 * di chiusura settimanale fissa del negozio senza prenotazioni da mostrare non si disegnano.
 */
export async function loadWeekView(
  supabase: ServerClient,
  settings: CalendarSettings,
  query: CalendarQuery,
  barbers: CalendarBarber[],
  ownBarberId: string | null,
): Promise<WeekViewData> {
  const { timezone } = settings;
  const chosen = barbers.find((barber) => barber.id === query.barberId)?.id;
  const barberId = chosen ?? defaultWeekBarber({ ownBarberId, barbers });
  const dates = weekDates(query.date);
  if (!barberId) return { barberId: null, grid: null, days: [], cancelledCount: 0 };

  const from = startOfLocalDay(dates[0], timezone);
  const to = startOfLocalDay(addDays(dates[6], 1), timezone);
  const [bookings, bands, timeOff, closures, openWeekdays] = await Promise.all([
    getBookingsInRange(supabase, [barberId], from, to),
    getWorkingBands(supabase, [barberId]),
    getTimeOff(supabase, [barberId], from, to),
    getClosures(supabase, from, to),
    getOpenWeekdays(supabase),
  ]);

  const shown = bookings.filter((booking) => query.showCancelled || !isCancelled(booking));
  const touches = (period: Interval, dayStart: Date, dayEnd: Date): boolean =>
    period.startsAt.getTime() < dayEnd.getTime() && period.endsAt.getTime() > dayStart.getTime();

  const visible = visibleWeekDays({
    dates,
    openWeekdays,
    bookings,
    showCancelled: query.showCancelled,
    tz: timezone,
  });
  const days = visible.map((date) => {
    const dayStart = startOfLocalDay(date, timezone);
    const dayEnd = startOfLocalDay(addDays(date, 1), timezone);
    const dayClosures = closures.filter((period) => touches(period, dayStart, dayEnd));
    return {
      date,
      bands: localBandsToIntervals(date, bandsOn(bands, barberId, date), timezone),
      // Una prenotazione sta nel giorno in cui inizia (oltre la mezzanotte si ritaglia alle 24:00).
      bookings: shown.filter(
        (booking) => booking.startsAt.getTime() >= dayStart.getTime() && booking.startsAt.getTime() < dayEnd.getTime(),
      ),
      periods: [
        ...timeOff
          .filter((period) => touches(period, dayStart, dayEnd))
          .map((period) => ({ ...period, kind: "timeOff" as const })),
        ...dayClosures.map((period) => ({ ...period, kind: "closure" as const })),
      ],
      closed: isClosedDay(date, dayClosures, timezone),
    };
  });

  const grid = weekGrid({
    dates: visible,
    tz: timezone,
    granularityMin: settings.granularityMin,
    bands: Object.fromEntries(visible.map((date) => [date, bandsOn(bands, barberId, date)])),
    // Solo le prenotazioni che iniziano nella settimana: le altre non si disegnano.
    bookings: days.flatMap((day) => day.bookings),
  });

  return { barberId, grid, days, cancelledCount: bookings.filter(isCancelled).length };
}
