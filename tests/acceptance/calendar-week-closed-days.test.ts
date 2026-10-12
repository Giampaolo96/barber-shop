// Vista settimana senza i giorni di chiusura settimanale fissa (modifica della fetta 8c, SPEC §6.1):
// giorni disegnati (visibleWeekDays), colonna iniziale dello scorrimento (initialWeekColumn) e linea
// dell'ora quando oggi è nascosto (weekNowLine), src/lib/calendar/week-grid.ts.
// Test di implementazione, non di accettazione.
import { describe, expect, test } from 'vitest';
import type { BookingStatus } from '@/lib/calendar/transitions';
import { initialWeekColumn, visibleWeekDays, weekGrid, weekNowLine } from '@/lib/calendar/week-grid';

const TZ = 'Europe/Rome';
// Lunedì 14 – domenica 20 gennaio 2047
const WEEK = ['2047-01-14', '2047-01-15', '2047-01-16', '2047-01-17', '2047-01-18', '2047-01-19', '2047-01-20'];
const [MON, TUE, WED, , , SAT, SUN] = WEEK;
const TUE_TO_SAT = WEEK.slice(1, 6);
// Orari come nel seed: martedì–sabato (weekday ISO 2–6)
const SEED_OPEN = [2, 3, 4, 5, 6];
const winter = (date: string, time: string): Date => new Date(`${date}T${time}:00+01:00`);
const booking = (date: string, status: BookingStatus = 'confirmed') => ({ status, startsAt: winter(date, '10:00') });

const visible = (input: { openWeekdays?: number[]; bookings?: Array<{ status: BookingStatus; startsAt: Date }>; showCancelled?: boolean }) =>
  visibleWeekDays({
    dates: WEEK,
    openWeekdays: input.openWeekdays ?? SEED_OPEN,
    bookings: input.bookings ?? [],
    showCancelled: input.showCancelled ?? false,
    tz: TZ,
  });

describe('visibleWeekDays', () => {
  test('i giorni senza orari del negozio sono nascosti', () => {
    expect(visible({})).toEqual(TUE_TO_SAT);
  });

  test('giorno chiuso con una prenotazione da mostrare: visibile, nell\'ordine della settimana', () => {
    expect(visible({ bookings: [booking(MON)] })).toEqual([MON, ...TUE_TO_SAT]);
    expect(visible({ bookings: [booking(SUN, 'completed')] })).toEqual([...TUE_TO_SAT, SUN]);
  });

  test('una cancellata in un giorno chiuso lo rende visibile solo con "mostra cancellate"', () => {
    const cancelled = [booking(MON, 'cancelled_by_shop'), booking(SUN, 'cancelled_by_customer')];
    expect(visible({ bookings: cancelled })).toEqual(TUE_TO_SAT);
    expect(visible({ bookings: cancelled, showCancelled: true })).toEqual(WEEK);
  });

  test('la prenotazione conta nel giorno locale di inizio (domenica 23:30 locale = sabato in UTC)', () => {
    const lateSunday = { status: 'confirmed' as const, startsAt: winter(SUN, '23:30') };
    expect(visible({ bookings: [lateSunday] })).toEqual([...TUE_TO_SAT, SUN]);
    const earlyMonday = { status: 'confirmed' as const, startsAt: winter(MON, '00:30') };
    expect(visible({ bookings: [earlyMonday] })).toEqual([MON, ...TUE_TO_SAT]);
  });

  test('le chiusure straordinarie non contano: un giorno aperto resta visibile anche senza prenotazioni', () => {
    // La funzione non riceve le chiusure: decide solo con gli orari settimanali e le prenotazioni.
    expect(visible({ openWeekdays: [3] })).toEqual([WED]);
  });

  test('negozio aperto 7 giorni → 7 colonne', () => {
    expect(visible({ openWeekdays: [1, 2, 3, 4, 5, 6, 7] })).toEqual(WEEK);
  });

  test('negozio senza orari e senza prenotazioni → nessuna colonna', () => {
    expect(visible({ openWeekdays: [] })).toEqual([]);
  });
});

describe('oggi nascosto', () => {
  const grid = weekGrid({ dates: TUE_TO_SAT, tz: TZ, granularityMin: 15, bands: { [TUE]: [{ start: '09:00', end: '19:00' }] }, bookings: [] });

  test('scorrimento iniziale: verso oggi se è disegnato, altrimenti dalla prima colonna', () => {
    expect(initialWeekColumn(TUE_TO_SAT, WED)).toBe(WED);
    expect(initialWeekColumn(TUE_TO_SAT, MON)).toBeNull();
    expect(initialWeekColumn(TUE_TO_SAT, SUN)).toBeNull();
    expect(initialWeekColumn(TUE_TO_SAT, '2047-01-22')).toBeNull();
  });

  test('nessuna linea dell\'ora se oggi è nascosto, anche dentro l\'orario dell\'asse', () => {
    expect(weekNowLine(winter(MON, '10:00'), TUE_TO_SAT, grid, TZ)).toBeNull();
    expect(weekNowLine(winter(SUN, '10:00'), TUE_TO_SAT, grid, TZ)).toBeNull();
    // Con oggi disegnato la linea c'è, nella sua colonna fra quelle visibili
    expect(weekNowLine(winter(WED, '10:00'), TUE_TO_SAT, grid, TZ)).toEqual({ index: 1, offset: 60 });
    expect(weekNowLine(winter(SAT, '09:00'), TUE_TO_SAT, grid, TZ)).toEqual({ index: 4, offset: 0 });
  });
});
