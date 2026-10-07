// Regressione dall'indagine sull'e2e instabile della fetta 6c: la destinazione di un trascinamento
// si calcola con una sola funzione pura, usata sia per l'anteprima ("Mario, 10:30" e colonna
// evidenziata, anche durante l'autoscroll) sia per il rilascio (ADR 008).
// La colonna è quella sotto il puntatore (pointerWithin), senza ripiego: fuori dalle colonne la
// prenotazione resta nella propria.

import { describe, expect, test } from 'vitest';

import { dayGrid } from '@/lib/calendar/grid';
import { dropTarget } from '@/lib/calendar/move';

const TZ = 'Europe/Rome';
const LUCA = 'b0000000-0000-4000-8000-000000000002';
const MARIO = 'b0000000-0000-4000-8000-000000000001';
const OFF = 'b0000000-0000-4000-8000-0000000000ff';

// 2047-01-15 (ora solare): griglia 09:00–19:00 a righe di 15 minuti
const grid = dayGrid({ date: '2047-01-15', tz: TZ, granularityMin: 15, bands: [{ start: '09:00', end: '19:00' }], bookings: [] });
const booking = { barberId: LUCA, startsAt: new Date('2047-01-15T09:00:00Z') }; // 10:00 a Roma
const now = new Date('2047-01-01T00:00:00Z');
const isActive = (barberId: string) => barberId !== OFF;
const base = { grid, role: 'admin' as const, booking, isActive, now };

describe('dropTarget', () => {
  test('colonna sotto il puntatore e riga di arrivo: Luca 10:00 → Mario 10:30', () => {
    expect(dropTarget({ ...base, overBarberId: MARIO, deltaRows: 2 })).toEqual({
      kind: 'move',
      barberId: MARIO,
      startsAt: new Date('2047-01-15T09:30:00Z'),
    });
  });

  test('puntatore fuori dalle colonne (nessun ripiego): resta nella propria colonna', () => {
    expect(dropTarget({ ...base, overBarberId: null, deltaRows: 4 })).toEqual({
      kind: 'move',
      barberId: LUCA,
      startsAt: new Date('2047-01-15T10:00:00Z'),
    });
  });

  test('stessa posizione, fuori dalla griglia o colonna non ammessa → none', () => {
    expect(dropTarget({ ...base, overBarberId: LUCA, deltaRows: 0 })).toEqual({ kind: 'none' });
    expect(dropTarget({ ...base, overBarberId: null, deltaRows: -5 })).toEqual({ kind: 'none' });
    expect(dropTarget({ ...base, overBarberId: OFF, deltaRows: 1 })).toEqual({ kind: 'none' });
    expect(dropTarget({ ...base, role: 'barber', overBarberId: MARIO, deltaRows: 1 })).toEqual({ kind: 'none' });
  });

  test('orario di arrivo non futuro → past (bordo: uguale a now)', () => {
    const atTen = new Date('2047-01-15T09:30:00Z');
    expect(dropTarget({ ...base, overBarberId: MARIO, deltaRows: 2, now: atTen })).toEqual({
      kind: 'past',
      barberId: MARIO,
      startsAt: atTen,
    });
    expect(dropTarget({ ...base, overBarberId: MARIO, deltaRows: 2, now: new Date(atTen.getTime() - 1) }).kind).toBe('move');
  });
});
