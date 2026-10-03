// Vista delle assenze su /admin/assenze (modifica richiesta dall'utente dopo la fetta 3, SPEC §6.5):
// l'admin vede le assenze di tutti i barbieri, prima le future, con un filtro che parte dalla sua
// scheda se è anche barbiere; il barbiere vede solo le proprie. Qui la logica pura; il flusso è
// coperto da tests/e2e/admin-periods.spec.ts.

import { describe, expect, test } from 'vitest';
import { ALL_BARBERS, resolveBarberFilter, sortPeriodsForList } from '@/lib/admin/periods';

const MARIO = 'b0000000-0000-4000-8000-000000000001';
const SARA = 'b0000000-0000-4000-8000-000000000003';
const BARBERS = [MARIO, SARA];

describe('resolveBarberFilter – filtro iniziale delle assenze dell\'admin', () => {
  test('admin anche barbiere, nessuna scelta → la sua scheda', () => {
    expect(resolveBarberFilter(undefined, MARIO, BARBERS)).toBe(MARIO);
  });

  // Prima della modifica l'admin senza scheda veniva rimandato a /admin/barbieri
  test('admin senza scheda, nessuna scelta → tutti i barbieri (nessun redirect)', () => {
    expect(resolveBarberFilter(undefined, null, BARBERS)).toBeNull();
  });

  test('scelta "tutti" → tutti, anche per l\'admin con una scheda', () => {
    expect(resolveBarberFilter(ALL_BARBERS, MARIO, BARBERS)).toBeNull();
  });

  test('scelta di un barbiere esistente → quel barbiere', () => {
    expect(resolveBarberFilter(SARA, MARIO, BARBERS)).toBe(SARA);
    expect(resolveBarberFilter(SARA, null, BARBERS)).toBe(SARA);
  });

  test('scelta non valida o di un barbiere inesistente → valore iniziale', () => {
    expect(resolveBarberFilter('b0000000-0000-4000-8000-000000000999', MARIO, BARBERS)).toBe(MARIO);
    expect(resolveBarberFilter("'; drop table", null, BARBERS)).toBeNull();
  });
});

describe('sortPeriodsForList – prima le assenze future', () => {
  const now = new Date('2030-06-15T12:00:00Z');
  const row = (id: string, startsAt: string, endsAt: string) => ({ id, starts_at: startsAt, ends_at: endsAt });

  test('future dalla più vicina, poi passate dalla più recente', () => {
    const rows = [
      row('passata-vecchia', '2030-01-01T08:00:00Z', '2030-01-01T10:00:00Z'),
      row('futura-lontana', '2030-12-01T08:00:00Z', '2030-12-01T10:00:00Z'),
      row('passata-recente', '2030-06-10T08:00:00Z', '2030-06-10T10:00:00Z'),
      row('futura-vicina', '2030-06-20T08:00:00Z', '2030-06-20T10:00:00Z'),
    ];
    expect(sortPeriodsForList(rows, now).map((r) => r.id)).toEqual([
      'futura-vicina',
      'futura-lontana',
      'passata-recente',
      'passata-vecchia',
    ]);
  });

  test('un\'assenza in corso conta fra le future (non è ancora finita)', () => {
    const rows = [
      row('passata', '2030-06-14T08:00:00Z', '2030-06-14T10:00:00Z'),
      row('in-corso', '2030-06-15T08:00:00Z', '2030-06-15T18:00:00Z'),
    ];
    expect(sortPeriodsForList(rows, now).map((r) => r.id)).toEqual(['in-corso', 'passata']);
  });

  test('non modifica l\'elenco ricevuto', () => {
    const rows = [row('b', '2030-07-02T08:00:00Z', '2030-07-02T09:00:00Z'), row('a', '2030-07-01T08:00:00Z', '2030-07-01T09:00:00Z')];
    sortPeriodsForList(rows, now);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });
});
