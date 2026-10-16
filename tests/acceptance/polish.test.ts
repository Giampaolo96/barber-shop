// Test di accettazione – FETTA 8b (rifinitura estetica), logica pura e testi.
// La fetta non è ancora in docs/SPEC.md: le regole vengono dalle decisioni approvate dall'utente
// per la fetta 8b (citate come "8b: ...") e dalle sezioni SPEC §5.1 (home, prossima prenotazione),
// §5.2 (flusso di prenotazione), §5.3 (Le mie prenotazioni), §6.1 (calendario dello staff), §9
// (testi in italiano centralizzati), §12 (cambio d'ora), CLAUDE.md regola 2 (timezone del negozio,
// mai l'ora del server).
//
// Interfacce attese (funzioni pure, nessun I/O, nessun "adesso" implicito):
//   src/lib/booking/countdown.ts
//     bookingCountdown(startsAt: Date | string, now: Date, timezone: string)
//       : { kind: "today" } | { kind: "tomorrow" } | { kind: "days"; days: number }
//       differenza in giorni di CALENDARIO nella timezone data (non blocchi di 24 ore)
//     seeYouPhrase(startsAt: Date | string, now: Date, timezone: string): string
//       "oggi" | "domani" | nome del giorno minuscolo entro 6 giorni di calendario ("sabato") |
//       "il <giorno senza zero> <mese>" oltre ("il 24 ottobre"), con elisione "l'8 ottobre",
//       "l'11 ottobre" e "il 1° novembre" per il primo del mese; testi da src/i18n/it.ts
//   src/lib/booking/format.ts
//     firstBioLine(bio: string | null): string | null   prima riga non vuota dopo il trim, o null
//   src/lib/booking/paths.ts
//     confirmationPath(id) = "/prenotazioni/<id>/confermata"
//     calendarFilePath(id) = "/prenotazioni/<id>/calendario.ics"
//   src/lib/booking/ics.ts
//     buildBookingIcs({ id, startsAt, endsAt, serviceName, shopName, address, now, uidHost }): string
//       startsAt/endsAt: Date | string (timestamptz), address: string | null, now: Date
//   src/lib/calendar/now-line.ts
//     nowLineMinutes(now: Date, day: "YYYY-MM-DD", timezone: string, startMin: number, endMin: number)
//       : number | null   minuti dall'inizio della griglia; null se day non è oggi nella timezone
//                         o se l'ora locale è fuori da [startMin, endMin] (bordi inclusi)
//   src/themes/mosca/identity.ts
//     calendarUidHost = "mosca-barber-shop" (costante separata, esportata da src/themes/active.ts;
//     appIdentity resta solo colori, test M5 della fetta 8)
//   Testi in src/i18n/it.ts (chiavi nuove o con valore nuovo):
//     it.booking.service.title = "Il listino", it.booking.service.subtitle = "Scegli il servizio"
//     it.home.ticket = { title: "Il tuo prossimo appuntamento", today: "Oggi", tomorrow: "Domani",
//                        inDays: "Tra {count} giorni", manage: "Gestisci" }
//     it.booking.confirmation = { title: "Prenotazione confermata", seeYou: "Ci vediamo {when}",
//                        today: "oggi", tomorrow: "domani", onDate: "il {date}", onDateElided: "l'{date}",
//                        addToCalendar: "Aggiungi al calendario", myBookings: "Le mie prenotazioni",
//                        backHome: "Torna alla home" }
//     it.booking.list.empty (testo dello stato vuoto), it.booking.list.emptyCta = "Prenota"
//     it.admin.stats.toUpdate.empty = "Nessun appuntamento da aggiornare" (valore nuovo)
//     it.admin.calendar.emptyDay = "Nessun appuntamento in questo giorno" (vista giorno vuota)
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { describe, expect, test } from 'vitest';

import { it as texts } from '@/i18n/it';

type Countdown = { kind: 'today' } | { kind: 'tomorrow' } | { kind: 'days'; days: number };
type CountdownModule = {
  bookingCountdown: (startsAt: Date | string, now: Date, timezone: string) => Countdown;
  seeYouPhrase: (startsAt: Date | string, now: Date, timezone: string) => string;
};
type FormatModule = { firstBioLine: (bio: string | null) => string | null };
type PathsModule = { confirmationPath: (id: string) => string; calendarFilePath: (id: string) => string };
type IcsInput = {
  id: string;
  startsAt: Date | string;
  endsAt: Date | string;
  serviceName: string;
  shopName: string;
  address: string | null;
  now: Date;
  uidHost: string;
};
type IcsModule = { buildBookingIcs: (input: IcsInput) => string };
type NowLineModule = {
  nowLineMinutes: (now: Date, day: string, timezone: string, startMin: number, endMin: number) => number | null;
};
type ThemeModule = { calendarUidHost: unknown; appIdentity: Record<string, unknown> };

const load = async <T>(specifier: string): Promise<T> => (await import(/* @vite-ignore */ specifier)) as T;
const countdown = () => load<CountdownModule>('@/lib/booking/countdown');
const format = () => load<FormatModule>('@/lib/booking/format');
const paths = () => load<PathsModule>('@/lib/booking/paths');
const ics = () => load<IcsModule>('@/lib/booking/ics');
const nowLine = () => load<NowLineModule>('@/lib/calendar/now-line');

const ROME = 'Europe/Rome';
const NEW_YORK = 'America/New_York';
const d = (iso: string): Date => new Date(iso);

/** Stringa di `it` per percorso; undefined se la chiave manca (i test lo segnalano). */
const text = (path: string): unknown => {
  let node: unknown = texts;
  for (const key of path.split('.')) {
    node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined;
  }
  return node;
};

// ---------------------------------------------------------------------------
// bookingCountdown – 8b: biglietto della prossima prenotazione in home (SPEC §5.1)
// ---------------------------------------------------------------------------
describe('bookingCountdown (8b, SPEC §5.1; CLAUDE.md regola 2)', () => {
  test('stesso giorno locale, più tardi → today', async () => {
    const { bookingCountdown } = await countdown();
    // 10:00 → 17:00 del 12 ottobre a Roma (ora legale, UTC+2)
    expect(bookingCountdown('2026-10-12T15:00:00Z', d('2026-10-12T08:00:00Z'), ROME)).toEqual({ kind: 'today' });
  });

  test('stesso giorno, già iniziata da qualche minuto → today', async () => {
    const { bookingCountdown } = await countdown();
    expect(bookingCountdown('2026-10-12T08:00:00Z', d('2026-10-12T08:10:00Z'), ROME)).toEqual({ kind: 'today' });
  });

  test('23:59 → 00:01 del giorno dopo (2 minuti) → tomorrow', async () => {
    const { bookingCountdown } = await countdown();
    expect(bookingCountdown('2026-10-12T22:01:00Z', d('2026-10-12T21:59:00Z'), ROME)).toEqual({ kind: 'tomorrow' });
  });

  test('vale il giorno di Roma, non quello UTC: 00:30 e 22:00 dello stesso giorno locale → today', async () => {
    const { bookingCountdown } = await countdown();
    // now = 22:30Z del 12 = 00:30 del 13 a Roma; appuntamento alle 22:00 del 13 (20:00Z)
    expect(bookingCountdown('2026-10-13T20:00:00Z', d('2026-10-12T22:30:00Z'), ROME)).toEqual({ kind: 'today' });
  });

  test('giorni di calendario, non blocchi di 24 ore: 33 ore ma due giorni dopo → days 2', async () => {
    const { bookingCountdown } = await countdown();
    // 23:00 del 12 → 08:00 del 14
    expect(bookingCountdown('2026-10-14T06:00:00Z', d('2026-10-12T21:00:00Z'), ROME)).toEqual({ kind: 'days', days: 2 });
  });

  test('37 ore ma il giorno dopo → tomorrow', async () => {
    const { bookingCountdown } = await countdown();
    // 08:00 del 12 → 21:00 del 13
    expect(bookingCountdown('2026-10-13T19:00:00Z', d('2026-10-12T06:00:00Z'), ROME)).toEqual({ kind: 'tomorrow' });
  });

  test('SPEC §12 cambio d\'ora: 24/10 12:00 → 26/10 09:00 attraversa il ritorno all\'ora solare → days 2', async () => {
    const { bookingCountdown } = await countdown();
    expect(bookingCountdown('2026-10-26T08:00:00Z', d('2026-10-24T10:00:00Z'), ROME)).toEqual({ kind: 'days', days: 2 });
  });

  test('SPEC §12: il 25/10/2026 (25 ore) dalle 00:30 alle 23:30 è sempre oggi', async () => {
    const { bookingCountdown } = await countdown();
    // 00:30 ora legale = 22:30Z del 24; 23:30 ora solare = 22:30Z del 25 (24 ore reali dopo)
    expect(bookingCountdown('2026-10-25T22:30:00Z', d('2026-10-24T22:30:00Z'), ROME)).toEqual({ kind: 'today' });
  });

  test('SPEC §12: 24/10 23:30 → 25/10 23:30 (25 ore reali) → tomorrow', async () => {
    const { bookingCountdown } = await countdown();
    expect(bookingCountdown('2026-10-25T22:30:00Z', d('2026-10-24T21:30:00Z'), ROME)).toEqual({ kind: 'tomorrow' });
  });

  test('SPEC §12: 27/03/2027 23:30 → 28/03 23:00 (22 ore e mezza, passaggio all\'ora legale) → tomorrow', async () => {
    const { bookingCountdown } = await countdown();
    expect(bookingCountdown('2027-03-28T21:00:00Z', d('2027-03-27T22:30:00Z'), ROME)).toEqual({ kind: 'tomorrow' });
  });

  test('SPEC §12: dal 27/03/2027 al 30/03 attraverso il passaggio all\'ora legale → days 3', async () => {
    const { bookingCountdown } = await countdown();
    expect(bookingCountdown('2027-03-30T07:00:00Z', d('2027-03-27T12:00:00Z'), ROME)).toEqual({ kind: 'days', days: 3 });
  });

  test('usa la timezone indicata, non quella del server: stesso istante, New York tomorrow, Roma today', async () => {
    const { bookingCountdown } = await countdown();
    // now = 03:00Z del 12 = 23:00 dell'11 a New York, 05:00 del 12 a Roma; appuntamento 14:00Z del 12
    const now = d('2026-10-12T03:00:00Z');
    expect(bookingCountdown('2026-10-12T14:00:00Z', now, NEW_YORK)).toEqual({ kind: 'tomorrow' });
    expect(bookingCountdown('2026-10-12T14:00:00Z', now, ROME)).toEqual({ kind: 'today' });
  });

  test('accetta Date e stringa ISO; più giorni e cambio d\'anno', async () => {
    const { bookingCountdown } = await countdown();
    expect(bookingCountdown(d('2026-10-22T08:00:00Z'), d('2026-10-12T08:00:00Z'), ROME)).toEqual({ kind: 'days', days: 10 });
    expect(bookingCountdown('2027-01-02T10:00:00.000Z', d('2026-12-30T10:00:00Z'), ROME)).toEqual({ kind: 'days', days: 3 });
  });
});

// ---------------------------------------------------------------------------
// seeYouPhrase – 8b: "Ci vediamo <giorno>" nella pagina di conferma
// ---------------------------------------------------------------------------
describe('seeYouPhrase (8b, pagina di conferma; CLAUDE.md regola 2)', () => {
  // Domenica 11 ottobre 2026, 10:00 a Roma
  const NOW = d('2026-10-11T08:00:00Z');

  test('oggi e domani', async () => {
    const { seeYouPhrase } = await countdown();
    expect(seeYouPhrase('2026-10-11T16:00:00Z', NOW, ROME)).toBe('oggi');
    expect(seeYouPhrase('2026-10-12T16:00:00Z', NOW, ROME)).toBe('domani');
  });

  test('entro 6 giorni di calendario il nome del giorno in minuscolo', async () => {
    const { seeYouPhrase } = await countdown();
    expect(seeYouPhrase('2026-10-13T08:00:00Z', NOW, ROME)).toBe('martedì');
    expect(seeYouPhrase('2026-10-17T08:00:00Z', NOW, ROME)).toBe('sabato');
  });

  test('oltre 6 giorni "il <giorno> <mese>", giorno senza zero iniziale', async () => {
    const { seeYouPhrase } = await countdown();
    expect(seeYouPhrase('2026-10-18T08:00:00Z', NOW, ROME)).toBe('il 18 ottobre');
    expect(seeYouPhrase('2026-10-24T08:00:00Z', NOW, ROME)).toBe('il 24 ottobre');
    expect(seeYouPhrase('2027-01-05T10:00:00Z', d('2026-12-28T10:00:00Z'), ROME)).toBe('il 5 gennaio');
  });

  // Aggiunta approvata dall'utente (8b): articolo eliso davanti a 8 e 11, "1°" per il primo del mese
  test('oltre 6 giorni con elisione: "l\'8 ottobre", "l\'11 ottobre"', async () => {
    const { seeYouPhrase } = await countdown();
    // giovedì 1 ottobre 2026, 10:00 a Roma: l'8 è a 7 giorni, l'11 a 10
    const now = d('2026-10-01T08:00:00Z');
    expect(seeYouPhrase('2026-10-08T08:00:00Z', now, ROME)).toBe("l'8 ottobre");
    expect(seeYouPhrase('2026-10-11T08:00:00Z', now, ROME)).toBe("l'11 ottobre");
  });

  test('oltre 6 giorni, primo del mese: "il 1° novembre"', async () => {
    const { seeYouPhrase } = await countdown();
    // 20 ottobre → 1 novembre (12 giorni); 23:30Z del 31/10 è già il 1° novembre a Roma (ora solare)
    const now = d('2026-10-20T08:00:00Z');
    expect(seeYouPhrase('2026-11-01T09:00:00Z', now, ROME)).toBe('il 1° novembre');
    expect(seeYouPhrase('2026-10-31T23:30:00Z', now, ROME)).toBe('il 1° novembre');
  });

  test('giorno locale del negozio: 22:30Z del 13 è mercoledì 14 a Roma', async () => {
    const { seeYouPhrase } = await countdown();
    expect(seeYouPhrase('2026-10-13T22:30:00Z', NOW, ROME)).toBe('mercoledì');
  });

  test('usa la timezone indicata: stesso istante, New York "domani", Roma "oggi"', async () => {
    const { seeYouPhrase } = await countdown();
    const now = d('2026-10-12T03:00:00Z');
    expect(seeYouPhrase('2026-10-12T14:00:00Z', now, NEW_YORK)).toBe('domani');
    expect(seeYouPhrase('2026-10-12T14:00:00Z', now, ROME)).toBe('oggi');
  });

  test('SPEC §12: giorni di calendario anche attraverso il cambio d\'ora', async () => {
    const { seeYouPhrase } = await countdown();
    // sabato 24/10 23:30 → domenica 25/10 23:30 (25 ore reali)
    expect(seeYouPhrase('2026-10-25T22:30:00Z', d('2026-10-24T21:30:00Z'), ROME)).toBe('domani');
    // sabato 24/10 12:00 → lunedì 26/10 09:00
    expect(seeYouPhrase('2026-10-26T08:00:00Z', d('2026-10-24T10:00:00Z'), ROME)).toBe('lunedì');
  });
});

// ---------------------------------------------------------------------------
// firstBioLine – 8b: scheda del barbiere (SPEC §5.2)
// ---------------------------------------------------------------------------
describe('firstBioLine (8b, SPEC §5.2)', () => {
  test('null, vuota o solo spazi e a capo → null', async () => {
    const { firstBioLine } = await format();
    expect(firstBioLine(null)).toBeNull();
    expect(firstBioLine('')).toBeNull();
    expect(firstBioLine('   \n \t \r\n  ')).toBeNull();
  });

  test('prima riga non vuota, senza spazi ai bordi', async () => {
    const { firstBioLine } = await format();
    expect(firstBioLine('Barbiere da 20 anni\nAma il jazz')).toBe('Barbiere da 20 anni');
    expect(firstBioLine('\n\n   Specialista in sfumature  \nAltro')).toBe('Specialista in sfumature');
    expect(firstBioLine('  Una sola riga  ')).toBe('Una sola riga');
  });

  test('a capo di Windows (\\r\\n, da un textarea) come separatore', async () => {
    const { firstBioLine } = await format();
    expect(firstBioLine('Prima\r\nSeconda')).toBe('Prima');
    expect(firstBioLine('\r\n  \r\nTerza\r\n')).toBe('Terza');
  });
});

// ---------------------------------------------------------------------------
// Percorsi – 8b: pagina di conferma e file del calendario
// ---------------------------------------------------------------------------
describe('percorsi della conferma (8b)', () => {
  const ID = 'c0ffee00-0000-4000-8000-000000000001';

  test('confirmationPath e calendarFilePath', async () => {
    const { confirmationPath, calendarFilePath } = await paths();
    expect(confirmationPath(ID)).toBe(`/prenotazioni/${ID}/confermata`);
    expect(calendarFilePath(ID)).toBe(`/prenotazioni/${ID}/calendario.ics`);
  });
});

// ---------------------------------------------------------------------------
// buildBookingIcs – 8b: "Aggiungi al calendario" (RFC 5545)
// ---------------------------------------------------------------------------
describe('buildBookingIcs (8b, RFC 5545; CLAUDE.md regola 2)', () => {
  const BASE: IcsInput = {
    id: 'c0ffee00-0000-4000-8000-000000000001',
    startsAt: '2026-10-24T08:00:00.000Z',
    endsAt: '2026-10-24T08:30:00.000Z',
    serviceName: 'Taglio',
    shopName: 'Mosca Barber Shop',
    address: 'Via Roma 1, 00100 Roma',
    now: d('2026-10-11T08:30:15Z'),
    uidHost: 'mosca-barber-shop',
  };

  /** Righe logiche: si annulla il folding (CRLF seguito da spazio o tab). */
  const logicalLines = (output: string): string[] =>
    output
      .replace(/\r\n[ \t]/g, '')
      .split('\r\n')
      .filter((line) => line !== '');
  const property = (output: string, name: string): string[] =>
    logicalLines(output).filter((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`));
  const build = async (overrides: Partial<IcsInput> = {}): Promise<string> =>
    (await ics()).buildBookingIcs({ ...BASE, ...overrides });

  test('righe terminate da CRLF, nessun LF o CR isolato, termina con CRLF', async () => {
    const output = await build();
    expect(output.endsWith('\r\n')).toBe(true);
    expect(output).not.toMatch(/(?<!\r)\n/);
    expect(output).not.toMatch(/\r(?!\n)/);
  });

  test('struttura: VCALENDAR con VERSION:2.0 e PRODID, un solo VEVENT', async () => {
    const lines = logicalLines(await build());
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines.at(-1)).toBe('END:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines.some((line) => /^PRODID:\S/.test(line))).toBe(true);
    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines.filter((line) => line === 'END:VEVENT')).toHaveLength(1);
    expect(lines.indexOf('BEGIN:VEVENT')).toBeLessThan(lines.indexOf('END:VEVENT'));
  });

  test('UID = <id>@<uidHost>, stabile al variare di now; DTSTAMP da now in UTC', async () => {
    const first = await build();
    const later = await build({ now: d('2026-10-20T17:05:09Z') });
    expect(property(first, 'UID')).toEqual([`UID:${BASE.id}@mosca-barber-shop`]);
    expect(property(later, 'UID')).toEqual(property(first, 'UID'));
    expect(property(first, 'DTSTAMP')).toEqual(['DTSTAMP:20261011T083015Z']);
    expect(property(later, 'DTSTAMP')).toEqual(['DTSTAMP:20261020T170509Z']);
    // L'host viene dal parametro, non da altro
    expect(property(await build({ uidHost: 'altro-negozio' }), 'UID')).toEqual([`UID:${BASE.id}@altro-negozio`]);
  });

  test('DTSTART e DTEND in UTC con Z, senza TZID; accetta anche Date', async () => {
    const output = await build();
    expect(property(output, 'DTSTART')).toEqual(['DTSTART:20261024T080000Z']);
    expect(property(output, 'DTEND')).toEqual(['DTEND:20261024T083000Z']);
    const withDates = await build({ startsAt: d('2026-10-24T08:00:00Z'), endsAt: d('2026-10-24T08:30:00Z') });
    expect(property(withDates, 'DTSTART')).toEqual(['DTSTART:20261024T080000Z']);
    expect(property(withDates, 'DTEND')).toEqual(['DTEND:20261024T083000Z']);
  });

  test('SPEC §12 cambio d\'ora: istanti esatti in UTC nei giorni del 25/10/2026 e 28/03/2027', async () => {
    const fall = await build({ startsAt: '2026-10-25T10:00:00+01:00', endsAt: '2026-10-25T10:30:00+01:00' });
    expect(property(fall, 'DTSTART')).toEqual(['DTSTART:20261025T090000Z']);
    expect(property(fall, 'DTEND')).toEqual(['DTEND:20261025T093000Z']);
    // Appuntamento a cavallo dell'ora ripetuta: 02:30 ora legale → 02:15 ora solare (45 minuti)
    const across = await build({ startsAt: '2026-10-25T02:30:00+02:00', endsAt: '2026-10-25T02:15:00+01:00' });
    expect(property(across, 'DTSTART')).toEqual(['DTSTART:20261025T003000Z']);
    expect(property(across, 'DTEND')).toEqual(['DTEND:20261025T011500Z']);
    const spring = await build({ startsAt: '2027-03-28T10:00:00+02:00', endsAt: '2027-03-28T10:45:00+02:00' });
    expect(property(spring, 'DTSTART')).toEqual(['DTSTART:20270328T080000Z']);
    expect(property(spring, 'DTEND')).toEqual(['DTEND:20270328T084500Z']);
  });

  test('SUMMARY "<servizio> – <negozio>" e LOCATION dall\'indirizzo (virgola con escape)', async () => {
    const output = await build();
    expect(property(output, 'SUMMARY')).toEqual(['SUMMARY:Taglio – Mosca Barber Shop']);
    expect(property(output, 'LOCATION')).toEqual(['LOCATION:Via Roma 1\\, 00100 Roma']);
  });

  test('senza indirizzo nessuna LOCATION', async () => {
    expect(property(await build({ address: null }), 'LOCATION')).toEqual([]);
  });

  test('escape RFC 5545 di \\ ; , e a capo (anche CRLF di un textarea)', async () => {
    const output = await build({
      serviceName: 'Taglio, barba; rifinitura \\ extra',
      shopName: 'Mosca, Barber',
      address: 'Via Roma 1\nScala B; interno 2',
    });
    expect(property(output, 'SUMMARY')).toEqual(['SUMMARY:Taglio\\, barba\\; rifinitura \\\\ extra – Mosca\\, Barber']);
    expect(property(output, 'LOCATION')).toEqual(['LOCATION:Via Roma 1\\nScala B\\; interno 2']);

    const crlf = await build({ address: 'Via Roma 1\r\nScala B' });
    expect(crlf).not.toMatch(/(?<!\r)\n/);
    expect(crlf).not.toMatch(/\r(?!\n)/);
    expect(property(crlf, 'LOCATION')).toEqual(['LOCATION:Via Roma 1\\nScala B']);
  });

  /** Ogni riga fisica ≤ 75 ottetti UTF-8, nessun carattere spezzato, folding reversibile. */
  const expectFolded = (output: string): void => {
    const physical = output.split('\r\n').filter((line) => line !== '');
    for (const line of physical) {
      expect(Buffer.byteLength(line, 'utf8'), `riga di ${Buffer.byteLength(line, 'utf8')} ottetti: ${line}`).toBeLessThanOrEqual(75);
    }
    expect(output).not.toContain('�');
    expect(output).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  };

  test('righe lunghe spezzate a 75 ottetti con continuazione che inizia con uno spazio', async () => {
    const serviceName = 'Taglio sfumato con rifinitura à la française e barba modellata è perfetta '.repeat(3).trim() + ' 💈';
    const address = 'Piazza della Città Vecchia 12, Scala B, Interno 4, 00100 Roma (citofono «Mosca» – secondo piano)';
    const output = await build({ serviceName, address });
    expectFolded(output);
    expect(output).toMatch(/\r\n /);
    expect(property(output, 'SUMMARY')).toEqual([`SUMMARY:${serviceName} – Mosca Barber Shop`]);
    expect(property(output, 'LOCATION')).toEqual([`LOCATION:${address.replace(/,/g, '\\,')}`]);
  });

  test('i caratteri multibyte al limite dei 75 ottetti non si spezzano ("–" e "è")', async () => {
    // "SUMMARY:" (8) + 65 "A" + " " = 74 ottetti: il "–" (3 ottetti) cade a cavallo del limite
    const dash = await build({ serviceName: 'A'.repeat(65) });
    expectFolded(dash);
    expect(property(dash, 'SUMMARY')).toEqual([`SUMMARY:${'A'.repeat(65)} – Mosca Barber Shop`]);
    // "SUMMARY:" (8) + 66 "A" = 74 ottetti: la "è" (2 ottetti) cade a cavallo del limite
    const accent = await build({ serviceName: `${'A'.repeat(66)}èèè` });
    expectFolded(accent);
    expect(property(accent, 'SUMMARY')).toEqual([`SUMMARY:${'A'.repeat(66)}èèè – Mosca Barber Shop`]);
  });

  test('nessun dato personale del cliente: niente nome, telefono, email, note, ATTENDEE o ORGANIZER', async () => {
    const withExtras = {
      ...BASE,
      customerName: 'Mario Rossi',
      fullName: 'Mario Rossi',
      phone: '+39 333 1234567',
      email: 'mario.rossi@example.com',
      notes: 'Nota segreta del cliente',
    } as IcsInput;
    const output = (await ics()).buildBookingIcs(withExtras);
    const unfolded = output.replace(/\r\n[ \t]/g, '');
    for (const secret of ['Mario Rossi', '333 1234567', '3331234567', 'mario.rossi@example.com', 'Nota segreta']) {
      expect(unfolded).not.toContain(secret);
    }
    expect(logicalLines(output).filter((line) => /^(ATTENDEE|ORGANIZER|CONTACT)[:;]/.test(line))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// nowLineMinutes – 8b: linea dell'ora attuale nella vista giorno (SPEC §6.1)
// ---------------------------------------------------------------------------
describe('nowLineMinutes (8b, SPEC §6.1; CLAUDE.md regola 2)', () => {
  const START = 9 * 60; // griglia 09:00–20:00
  const END = 20 * 60;

  test('oggi dentro la griglia: minuti dall\'inizio della griglia', async () => {
    const { nowLineMinutes } = await nowLine();
    // 10:15 a Roma (ora legale) = 08:15Z
    expect(nowLineMinutes(d('2026-10-12T08:15:00Z'), '2026-10-12', ROME, START, END)).toBe(75);
  });

  test('bordi inclusi: all\'inizio 0, alla fine endMin - startMin', async () => {
    const { nowLineMinutes } = await nowLine();
    expect(nowLineMinutes(d('2026-10-12T07:00:00Z'), '2026-10-12', ROME, START, END)).toBe(0);
    expect(nowLineMinutes(d('2026-10-12T18:00:00Z'), '2026-10-12', ROME, START, END)).toBe(END - START);
  });

  test('fuori dalla griglia → null', async () => {
    const { nowLineMinutes } = await nowLine();
    expect(nowLineMinutes(d('2026-10-12T06:59:00Z'), '2026-10-12', ROME, START, END)).toBeNull();
    expect(nowLineMinutes(d('2026-10-12T18:01:00Z'), '2026-10-12', ROME, START, END)).toBeNull();
  });

  test('il giorno mostrato non è oggi → null', async () => {
    const { nowLineMinutes } = await nowLine();
    expect(nowLineMinutes(d('2026-10-12T08:15:00Z'), '2026-10-13', ROME, START, END)).toBeNull();
    expect(nowLineMinutes(d('2026-10-12T08:15:00Z'), '2026-10-11', ROME, START, END)).toBeNull();
  });

  test('"oggi" è il giorno di Roma, non quello UTC: 22:30Z del 12 = 00:30 del 13', async () => {
    const { nowLineMinutes } = await nowLine();
    const now = d('2026-10-12T22:30:00Z');
    expect(nowLineMinutes(now, '2026-10-12', ROME, 0, 24 * 60)).toBeNull();
    expect(nowLineMinutes(now, '2026-10-13', ROME, 0, 24 * 60)).toBe(30);
  });

  test('SPEC §12: 25/10/2026, ora solare dopo il cambio', async () => {
    const { nowLineMinutes } = await nowLine();
    // 10:15 ora solare = 09:15Z (con l'offset dell'ora legale verrebbe 135, con quello UTC 15)
    expect(nowLineMinutes(d('2026-10-25T09:15:00Z'), '2026-10-25', ROME, START, END)).toBe(75);
    // 03:30 locali dopo il cambio (02:30Z), griglia dalle 03:00
    expect(nowLineMinutes(d('2026-10-25T02:30:00Z'), '2026-10-25', ROME, 3 * 60, END)).toBe(30);
  });

  test('SPEC §12: 28/03/2027, ora legale dopo il cambio', async () => {
    const { nowLineMinutes } = await nowLine();
    // 03:30 ora legale = 01:30Z; griglia dalle 03:00
    expect(nowLineMinutes(d('2027-03-28T01:30:00Z'), '2027-03-28', ROME, 3 * 60, END)).toBe(30);
    expect(nowLineMinutes(d('2027-03-28T08:15:00Z'), '2027-03-28', ROME, START, END)).toBe(75);
  });

  test('usa la timezone indicata, non quella del server', async () => {
    const { nowLineMinutes } = await nowLine();
    // 02:00Z del 12 = 22:00 dell'11 a New York (EDT, UTC-4)
    const now = d('2026-10-12T02:00:00Z');
    expect(nowLineMinutes(now, '2026-10-11', NEW_YORK, START, 23 * 60)).toBe(13 * 60);
    expect(nowLineMinutes(now, '2026-10-12', NEW_YORK, START, 23 * 60)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Identità del tema – 8b: host dell'UID del calendario
// ---------------------------------------------------------------------------
describe('calendarUidHost (8b)', () => {
  test('il tema Mosca esporta calendarUidHost = "mosca-barber-shop", fuori da appIdentity', async () => {
    // Il file dell'identità, non @/themes/active: quello carica next/font, non eseguibile in Vitest.
    const theme = await load<ThemeModule>('@/themes/mosca/identity');
    expect(theme.calendarUidHost).toBe('mosca-barber-shop');
    expect(theme.appIdentity).not.toHaveProperty('calendarUidHost');
  });
});

// ---------------------------------------------------------------------------
// Testi – 8b, SPEC §9 (tutti in src/i18n/it.ts)
// ---------------------------------------------------------------------------
describe('testi della fetta 8b in src/i18n/it.ts (SPEC §9)', () => {
  test.each([
    ['booking.service.title', 'Il listino'],
    ['booking.service.subtitle', 'Scegli il servizio'],
    ['home.ticket.title', 'Il tuo prossimo appuntamento'],
    ['home.ticket.today', 'Oggi'],
    ['home.ticket.tomorrow', 'Domani'],
    ['home.ticket.inDays', 'Tra {count} giorni'],
    ['home.ticket.manage', 'Gestisci'],
    ['booking.confirmation.title', 'Prenotazione confermata'],
    ['booking.confirmation.seeYou', 'Ci vediamo {when}'],
    ['booking.confirmation.today', 'oggi'],
    ['booking.confirmation.tomorrow', 'domani'],
    ['booking.confirmation.onDate', 'il {date}'],
    ['booking.confirmation.onDateElided', "l'{date}"],
    ['booking.confirmation.addToCalendar', 'Aggiungi al calendario'],
    ['booking.confirmation.myBookings', 'Le mie prenotazioni'],
    ['booking.confirmation.backHome', 'Torna alla home'],
    ['booking.list.emptyCta', 'Prenota'],
    // Stati vuoti dell'area staff (aggiunta approvata dall'utente, 8b)
    ['admin.stats.toUpdate.empty', 'Nessun appuntamento da aggiornare'],
    ['admin.calendar.emptyDay', 'Nessun appuntamento in questo giorno'],
  ])('it.%s = %j', (path, value) => {
    expect(text(path)).toBe(value);
  });

  test('it.booking.list.empty: testo dello stato vuoto di "Le mie prenotazioni"', () => {
    const value = text('booking.list.empty');
    expect(typeof value).toBe('string');
    expect((value as string).trim()).not.toBe('');
  });
});
