// Test di accettazione – FETTA 6 (SPEC §11: "Calendario admin + prenotazioni manuali + cambi stato"),
// regole pure della modifica dell'admin e della vista settimanale.
// Sezioni: SPEC §3.6 (durata e prezzo copiati; cambiando servizio vengono ricopiati; solo l'admin li
// modifica), §3.7.5, §6.1 (vista settimanale), §6.3 + decisioni dell'utente sulla fetta 6 (punti 3, 4, 5
// della seconda richiesta).
//
// Interfacce attese:
//   src/lib/calendar/edit.ts (puro)
//     bookingUpdateValues(
//       existing: { serviceId: string },
//       input: { barberId: string; serviceId: string; startsAt: Date; durationMin: number; priceCents: number },
//     ): { barber_id: string; service_id: string; starts_at: string /* ISO UTC */; duration_min?: number; price_cents?: number }
//       Colonne da scrivere: se il servizio cambia, durata e prezzo NON sono inclusi (li ricopia il
//       database dal nuovo servizio); se il servizio non cambia, sono inclusi.
//     editNeedsWarnings(
//       existing: { status: BookingStatus; barberId: string; startsAt: Date; endsAt: Date },
//       next: { barberId: string; startsAt: Date; endsAt: Date },
//     ): boolean
//       true solo se la prenotazione è confirmed e cambiano orario, barbiere o fine.
//   src/lib/calendar/view.ts (puro)
//     defaultWeekBarber(input: { ownBarberId: string | null;
//                                barbers: Array<{ id: string; displayName: string; isActive: boolean }> }): string | null
//       la scheda dell'utente se è anche barbiere, altrimenti il primo barbiere attivo per nome; null se nessuno.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { describe, expect, test } from 'vitest';

type BookingStatus = 'confirmed' | 'completed' | 'cancelled_by_customer' | 'cancelled_by_shop' | 'no_show';
type EditModule = {
  bookingUpdateValues: (
    existing: { serviceId: string },
    input: { barberId: string; serviceId: string; startsAt: Date; durationMin: number; priceCents: number },
  ) => Record<string, unknown>;
  editNeedsWarnings: (
    existing: { status: BookingStatus; barberId: string; startsAt: Date; endsAt: Date },
    next: { barberId: string; startsAt: Date; endsAt: Date },
  ) => boolean;
};
type ViewModule = {
  defaultWeekBarber: (input: {
    ownBarberId: string | null;
    barbers: Array<{ id: string; displayName: string; isActive: boolean }>;
  }) => string | null;
};

const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;
const edit = () => load<EditModule>('@/lib/calendar/edit');
const view = () => load<ViewModule>('@/lib/calendar/view');

const LUCA = 'b0000000-0000-4000-8000-000000000002';
const MARIO = 'b0000000-0000-4000-8000-000000000001';
const SARA = 'b0000000-0000-4000-8000-000000000003';
const TAGLIO = '50000000-0000-4000-8000-000000000001';
const BARBA = '50000000-0000-4000-8000-000000000002';
const at = (time: string): Date => new Date(`2027-01-12T${time}:00+01:00`);

// ---------------------------------------------------------------------------
// bookingUpdateValues – SPEC §3.6, decisione punto 3
// ---------------------------------------------------------------------------
describe('bookingUpdateValues (SPEC §3.6)', () => {
  const input = { barberId: MARIO, serviceId: TAGLIO, startsAt: at('11:00'), durationMin: 50, priceCents: 1800 };

  test('stesso servizio: si scrivono anche durata e prezzo dell\'admin', async () => {
    const { bookingUpdateValues } = await edit();
    expect(bookingUpdateValues({ serviceId: TAGLIO }, input)).toEqual({
      barber_id: MARIO,
      service_id: TAGLIO,
      starts_at: '2027-01-12T10:00:00.000Z',
      duration_min: 50,
      price_cents: 1800,
    });
  });

  test('servizio cambiato: durata e prezzo del modulo ignorati (li ricopia il database)', async () => {
    const { bookingUpdateValues } = await edit();
    const values = bookingUpdateValues({ serviceId: BARBA }, input);
    expect(values).toEqual({ barber_id: MARIO, service_id: TAGLIO, starts_at: '2027-01-12T10:00:00.000Z' });
    expect(values).not.toHaveProperty('duration_min');
    expect(values).not.toHaveProperty('price_cents');
  });
});

// ---------------------------------------------------------------------------
// editNeedsWarnings – SPEC §3.7.5, decisione punto 4
// ---------------------------------------------------------------------------
describe('editNeedsWarnings (SPEC §3.7.5, §6.3)', () => {
  const existing = { status: 'confirmed' as BookingStatus, barberId: LUCA, startsAt: at('10:00'), endsAt: at('10:30') };
  const same = { barberId: LUCA, startsAt: at('10:00'), endsAt: at('10:30') };

  test('solo il prezzo (orario, barbiere e fine invariati) → nessun avviso, anche se passata', async () => {
    const { editNeedsWarnings } = await edit();
    expect(editNeedsWarnings(existing, same)).toBe(false);
  });

  test('cambia l\'orario, il barbiere o la fine (servizio o durata) → avvisi', async () => {
    const { editNeedsWarnings } = await edit();
    expect(editNeedsWarnings(existing, { ...same, startsAt: at('11:00'), endsAt: at('11:30') })).toBe(true);
    expect(editNeedsWarnings(existing, { ...same, barberId: MARIO })).toBe(true);
    expect(editNeedsWarnings(existing, { ...same, endsAt: at('10:45') })).toBe(true);
  });

  test.each(['completed', 'no_show', 'cancelled_by_customer', 'cancelled_by_shop'] as const)(
    'prenotazione %s (non confirmed) → nessun avviso anche se spostata',
    async (status) => {
      const { editNeedsWarnings } = await edit();
      expect(editNeedsWarnings({ ...existing, status }, { ...same, startsAt: at('11:00'), endsAt: at('11:30') })).toBe(
        false,
      );
    },
  );
});

// ---------------------------------------------------------------------------
// defaultWeekBarber – SPEC §6.1, decisione punto 5
// ---------------------------------------------------------------------------
describe('defaultWeekBarber (SPEC §6.1: vista settimanale dell\'admin senza ?barbiere=)', () => {
  const barbers = [
    { id: SARA, displayName: 'Sara', isActive: true },
    { id: LUCA, displayName: 'Luca', isActive: false },
    { id: MARIO, displayName: 'Mario', isActive: true },
  ];

  test('l\'admin che è anche barbiere parte dalla propria scheda', async () => {
    const { defaultWeekBarber } = await view();
    expect(defaultWeekBarber({ ownBarberId: SARA, barbers })).toBe(SARA);
  });

  test('altrimenti il primo barbiere attivo in ordine di nome (i disattivati sono saltati)', async () => {
    const { defaultWeekBarber } = await view();
    expect(defaultWeekBarber({ ownBarberId: null, barbers })).toBe(MARIO);
  });

  test('nessun barbiere attivo → null', async () => {
    const { defaultWeekBarber } = await view();
    expect(defaultWeekBarber({ ownBarberId: null, barbers: [] })).toBeNull();
    expect(defaultWeekBarber({ ownBarberId: null, barbers: [{ id: LUCA, displayName: 'Luca', isActive: false }] })).toBeNull();
  });
});
