// Fetta 8c: posizione di prenotazioni, assenze e chiusure nella colonna di un giorno della vista
// settimana (dayBlockPosition, src/lib/calendar/week-grid.ts). Test di implementazione, non di accettazione.
import { describe, expect, test } from 'vitest';
import { dayBlockPosition, weekGrid } from '@/lib/calendar/week-grid';

const TZ = 'Europe/Rome';
const WEEK = ['2047-01-14', '2047-01-15', '2047-01-16', '2047-01-17', '2047-01-18', '2047-01-19', '2047-01-20'];
const winter = (date: string, time: string): Date => new Date(`${date}T${time}:00+01:00`);
const grid = weekGrid({ dates: WEEK, tz: TZ, granularityMin: 15, bands: { '2047-01-15': [{ start: '09:00', end: '19:00' }] }, bookings: [] });

describe('dayBlockPosition (fetta 8c)', () => {
  test('blocco del giorno: riga di inizio e righe occupate, arrotondate alla griglia', () => {
    expect(dayBlockPosition(grid, '2047-01-15', { startsAt: winter('2047-01-15', '10:00'), endsAt: winter('2047-01-15', '10:30') }, TZ)).toEqual({ row: 4, span: 2 });
    expect(dayBlockPosition(grid, '2047-01-15', { startsAt: winter('2047-01-15', '10:05'), endsAt: winter('2047-01-15', '10:20') }, TZ)).toEqual({ row: 4, span: 2 });
  });

  test('ritagliato all\'asse; fuori dall\'asse o da un altro giorno → null', () => {
    expect(dayBlockPosition(grid, '2047-01-15', { startsAt: winter('2047-01-15', '08:00'), endsAt: winter('2047-01-15', '09:30') }, TZ)).toEqual({ row: 0, span: 2 });
    expect(dayBlockPosition(grid, '2047-01-15', { startsAt: winter('2047-01-15', '19:00'), endsAt: winter('2047-01-15', '20:00') }, TZ)).toBeNull();
    expect(dayBlockPosition(grid, '2047-01-16', { startsAt: winter('2047-01-15', '10:00'), endsAt: winter('2047-01-15', '10:30') }, TZ)).toBeNull();
  });

  test('assenza o chiusura di più giorni: copre tutto l\'asse nei giorni interni', () => {
    const holidays = { startsAt: winter('2047-01-15', '12:00'), endsAt: winter('2047-01-17', '12:00') };
    expect(dayBlockPosition(grid, '2047-01-15', holidays, TZ)).toEqual({ row: 12, span: 28 });
    expect(dayBlockPosition(grid, '2047-01-16', holidays, TZ)).toEqual({ row: 0, span: 40 });
    expect(dayBlockPosition(grid, '2047-01-17', holidays, TZ)).toEqual({ row: 0, span: 12 });
  });
});
