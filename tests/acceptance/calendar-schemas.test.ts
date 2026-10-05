// Test di accettazione – FETTA 6 (SPEC §11: "Calendario admin + prenotazioni manuali + cambi stato"),
// schemi Zod delle server action del calendario.
// Sezioni: SPEC §3.6 (stati, nota del cliente separata dalla nota staff, prezzo e durata solo
// dall'admin), §5.5 (telefono in E.164), §6.2 (ricerca cliente o nome + telefono), §6.3, CLAUDE.md
// regola 3 (centesimi) e Sicurezza (Zod su ogni input) + decisioni approvate per la fetta 6 (punti 4, 5).
//
// Interfaccia attesa: src/lib/calendar/schemas.ts
//   manualBookingSchema – input (FormData già convertito in oggetto; confirmedWarnings come array):
//     { barberId: uuid, serviceId: uuid, date: 'YYYY-MM-DD', time: 'HH:MM' (minuti multipli di 5),
//       customerKind: 'registered' | 'guest',
//       customerId: uuid                      (obbligatorio con 'registered'),
//       guestName: 1–100 dopo il trim         (obbligatorio con 'guest'),
//       guestPhone: telefono → E.164 (IT)     (obbligatorio con 'guest'),
//       staffNote?: ≤ 500 dopo il trim, vuota → null,
//       confirmedWarnings?: Array<'outside_hours'|'time_off'|'closure'|'past'>, default [] }
//     Chiavi non previste scartate (niente notes del cliente, prezzo, durata, stato, source).
//   updateBookingSchema (solo admin):
//     { id: uuid, barberId: uuid, serviceId: uuid, date, time (passo 5'), durationMin: '1'–'480' → number,
//       price: euro ('25,50') → priceCents: number, confirmedWarnings?: come sopra }
//     Chiavi non previste scartate (niente cambio di cliente).
//   bookingStatusSchema: { id: uuid, status: uno dei 5 stati di booking_status }
//   staffNoteSchema: { bookingId: uuid, note: ≤ 500 dopo il trim, vuota → null }
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { describe, expect, test } from 'vitest';

type SafeParse = { success: boolean; data?: Record<string, unknown> };
type Schema = { safeParse: (input: unknown) => SafeParse };
type SchemasModule = {
  manualBookingSchema: Schema;
  updateBookingSchema: Schema;
  bookingStatusSchema: Schema;
  staffNoteSchema: Schema;
};

const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;
const schemas = () => load<SchemasModule>('@/lib/calendar/schemas');

const BARBER = 'b0000000-0000-4000-8000-000000000002';
const SERVICE = '50000000-0000-4000-8000-000000000001';
const CUSTOMER = 'a0000000-0000-4000-8000-000000000003';
const BOOKING = 'bd000000-0000-4000-8000-000000000601';

const guest = {
  barberId: BARBER,
  serviceId: SERVICE,
  date: '2027-01-12',
  time: '10:00',
  customerKind: 'guest',
  guestName: '  Paolo Neri  ',
  guestPhone: '333 123 4567',
};
const registered = {
  barberId: BARBER,
  serviceId: SERVICE,
  date: '2027-01-12',
  time: '10:00',
  customerKind: 'registered',
  customerId: CUSTOMER,
};
const update = {
  id: BOOKING,
  barberId: BARBER,
  serviceId: SERVICE,
  date: '2027-01-12',
  time: '11:05',
  durationMin: '45',
  price: '25,50',
};

const ok = (schema: Schema, input: unknown): Record<string, unknown> => {
  const result = schema.safeParse(input);
  expect(result.success, `input valido rifiutato: ${JSON.stringify(input)}`).toBe(true);
  return result.data ?? {};
};
const ko = (schema: Schema, input: unknown): void => {
  expect(schema.safeParse(input).success, `input non valido accettato: ${JSON.stringify(input)}`).toBe(false);
};

describe('manualBookingSchema (SPEC §6.2)', () => {
  test('ospite: nome senza spazi ai lati, telefono in E.164, nota staff vuota → null, nessun avviso confermato', async () => {
    const { manualBookingSchema } = await schemas();
    const data = ok(manualBookingSchema, { ...guest, staffNote: '   ' });
    expect(data).toMatchObject({
      barberId: BARBER,
      serviceId: SERVICE,
      date: '2027-01-12',
      time: '10:00',
      customerKind: 'guest',
      guestName: 'Paolo Neri',
      guestPhone: '+393331234567',
      staffNote: null,
      confirmedWarnings: [],
    });
  });

  test('cliente registrato: serve customerId uuid', async () => {
    const { manualBookingSchema } = await schemas();
    expect(ok(manualBookingSchema, registered)).toMatchObject({ customerKind: 'registered', customerId: CUSTOMER });
    ko(manualBookingSchema, { ...registered, customerId: undefined });
    ko(manualBookingSchema, { ...registered, customerId: 'not-a-uuid' });
  });

  test('ospite: nome 1–100 caratteri e telefono valido obbligatori', async () => {
    const { manualBookingSchema } = await schemas();
    ok(manualBookingSchema, { ...guest, guestName: 'x'.repeat(100) });
    ko(manualBookingSchema, { ...guest, guestName: 'x'.repeat(101) });
    ko(manualBookingSchema, { ...guest, guestName: '   ' });
    ko(manualBookingSchema, { ...guest, guestPhone: '123' });
    ko(manualBookingSchema, { ...guest, guestPhone: '' });
    ko(manualBookingSchema, { ...guest, customerKind: 'other' });
  });

  test('decisione fetta 6: orario con passo di 5 minuti, data e ora valide', async () => {
    const { manualBookingSchema } = await schemas();
    ok(manualBookingSchema, { ...guest, time: '10:05' });
    ok(manualBookingSchema, { ...guest, time: '23:55' });
    ko(manualBookingSchema, { ...guest, time: '10:07' });
    ko(manualBookingSchema, { ...guest, time: '24:00' });
    ko(manualBookingSchema, { ...guest, time: '10:00:00' });
    ko(manualBookingSchema, { ...guest, date: '2027-02-30' });
    ko(manualBookingSchema, { ...guest, date: '12/01/2027' });
  });

  test('id di barbiere e servizio devono essere uuid', async () => {
    const { manualBookingSchema } = await schemas();
    ko(manualBookingSchema, { ...guest, barberId: 'luca' });
    ko(manualBookingSchema, { ...guest, serviceId: '' });
  });

  test('SPEC §3.6: nota interna dello staff al massimo 500 caratteri', async () => {
    const { manualBookingSchema } = await schemas();
    expect(ok(manualBookingSchema, { ...guest, staffNote: ` ${'n'.repeat(500)} ` }).staffNote).toBe('n'.repeat(500));
    ko(manualBookingSchema, { ...guest, staffNote: 'n'.repeat(501) });
  });

  test('decisione fetta 6: avvisi confermati solo fra i codici noti', async () => {
    const { manualBookingSchema } = await schemas();
    expect(
      ok(manualBookingSchema, { ...guest, confirmedWarnings: ['outside_hours', 'time_off', 'closure', 'past'] })
        .confirmedWarnings,
    ).toEqual(['outside_hours', 'time_off', 'closure', 'past']);
    ko(manualBookingSchema, { ...guest, confirmedWarnings: ['barber_busy'] });
    ko(manualBookingSchema, { ...guest, confirmedWarnings: ['overlap'] });
  });

  test('SPEC §3.6 + decisione fetta 6: niente nota del cliente, prezzo, durata, stato o source dal modulo', async () => {
    const { manualBookingSchema } = await schemas();
    const data = ok(manualBookingSchema, {
      ...guest,
      notes: 'nota visibile al cliente',
      priceCents: 1,
      durationMin: 5,
      status: 'completed',
      source: 'online',
    });
    for (const key of ['notes', 'priceCents', 'durationMin', 'status', 'source']) {
      expect(data, `chiave non prevista accettata: ${key}`).not.toHaveProperty(key);
    }
  });
});

describe('updateBookingSchema (SPEC §6.3, solo admin)', () => {
  test('prezzo in centesimi interi e durata come numero', async () => {
    const { updateBookingSchema } = await schemas();
    expect(ok(updateBookingSchema, update)).toMatchObject({
      id: BOOKING,
      barberId: BARBER,
      serviceId: SERVICE,
      date: '2027-01-12',
      time: '11:05',
      durationMin: 45,
      priceCents: 2550,
      confirmedWarnings: [],
    });
  });

  test('decisione fetta 6: durata 1–480 minuti', async () => {
    const { updateBookingSchema } = await schemas();
    ok(updateBookingSchema, { ...update, durationMin: '1' });
    ok(updateBookingSchema, { ...update, durationMin: '480' });
    ko(updateBookingSchema, { ...update, durationMin: '0' });
    ko(updateBookingSchema, { ...update, durationMin: '481' });
    ko(updateBookingSchema, { ...update, durationMin: '30.5' });
  });

  test('CLAUDE.md regola 3: prezzo non negativo, al massimo due decimali', async () => {
    const { updateBookingSchema } = await schemas();
    expect(ok(updateBookingSchema, { ...update, price: '0' }).priceCents).toBe(0);
    ko(updateBookingSchema, { ...update, price: '-1' });
    ko(updateBookingSchema, { ...update, price: '10,999' });
    ko(updateBookingSchema, { ...update, price: 'abc' });
  });

  test('id uuid e passo di 5 minuti', async () => {
    const { updateBookingSchema } = await schemas();
    ko(updateBookingSchema, { ...update, id: '1' });
    ko(updateBookingSchema, { ...update, time: '11:03' });
  });

  test('decisione fetta 6: la modifica non cambia il cliente', async () => {
    const { updateBookingSchema } = await schemas();
    const data = ok(updateBookingSchema, { ...update, customerId: CUSTOMER, guestName: 'Altro', status: 'confirmed' });
    for (const key of ['customerId', 'guestName', 'status']) expect(data).not.toHaveProperty(key);
  });
});

describe('bookingStatusSchema (SPEC §3.6)', () => {
  test.each(['confirmed', 'completed', 'cancelled_by_customer', 'cancelled_by_shop', 'no_show'])(
    'stato %s ammesso dallo schema (il ruolo lo controlla la server action)',
    async (status) => {
      const { bookingStatusSchema } = await schemas();
      expect(ok(bookingStatusSchema, { id: BOOKING, status })).toMatchObject({ id: BOOKING, status });
    },
  );

  test('stato sconosciuto o id non valido → rifiutato', async () => {
    const { bookingStatusSchema } = await schemas();
    ko(bookingStatusSchema, { id: BOOKING, status: 'deleted' });
    ko(bookingStatusSchema, { id: 'x', status: 'completed' });
  });
});

describe('staffNoteSchema (SPEC §3.6: note interne dello staff)', () => {
  test('al massimo 500 caratteri dopo il trim; vuota → null', async () => {
    const { staffNoteSchema } = await schemas();
    expect(ok(staffNoteSchema, { bookingId: BOOKING, note: '  Cliente puntuale  ' }).note).toBe('Cliente puntuale');
    expect(ok(staffNoteSchema, { bookingId: BOOKING, note: '   ' }).note).toBeNull();
    ok(staffNoteSchema, { bookingId: BOOKING, note: 'n'.repeat(500) });
    ko(staffNoteSchema, { bookingId: BOOKING, note: 'n'.repeat(501) });
    ko(staffNoteSchema, { bookingId: 'x', note: 'ok' });
  });
});
