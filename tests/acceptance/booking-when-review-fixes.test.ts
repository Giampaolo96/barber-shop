// Correzioni dalla review della fetta 8e (decisioni approvate in docs/PROGRESS.md, "Fetta 8e").
import { describe, expect, test } from 'vitest';

import type { DayStatus } from '@/lib/availability';
import { initialDay } from '@/lib/booking/when';

describe('initialDay – nessun giorno con posti nel periodo → stato vuoto', () => {
  const none: DayStatus[] = [
    { date: '2027-03-01', status: 'full' },
    { date: '2027-03-02', status: 'closed' },
    { date: '2027-03-03', status: 'full' },
  ];

  test('anche con un giorno richiesto "senza posti" il risultato è null', () => {
    expect(initialDay(none, '2027-03-01')).toBeNull();
    expect(initialDay(none, '2027-03-03')).toBeNull();
  });

  test('con almeno un giorno con posti il giorno richiesto "senza posti" resta valido', () => {
    expect(initialDay([...none, { date: '2027-03-04', status: 'open' }], '2027-03-03')).toBe('2027-03-03');
  });
});
