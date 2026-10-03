// Test di accettazione – FETTA 3 (SPEC §11: "Admin: servizi, barbieri, orari, assenze, chiusure").
// Schemi Zod delle server action dell'area admin (CLAUDE.md – Sicurezza: "Ogni server action
// valida l'input con Zod").
// Sezioni: SPEC §3.1 (impostazioni), §3.2 (servizi), §3.3 (barbieri), §3.4 (orari), §3.5 (assenze
// e chiusure), §6.4–6.6, §6.8 + decisioni approvate per la fetta 3 (punto A).
// I dati arrivano da FormData: numeri come stringhe, checkbox già convertite in booleani dalla
// server action, servizi abilitati come array (formData.getAll).
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { describe, expect, test } from 'vitest';

// ---------------------------------------------------------------------------
// Interfacce attese (il codice ancora non esiste)
// ---------------------------------------------------------------------------
type ParseResult = { success: boolean; data?: unknown };
type Schema = { safeParse: (input: unknown) => ParseResult };
type SchemasModule = {
  serviceSchema: Schema;
  barberSchema: Schema;
  weeklyHoursSchema: Schema;
  timeOffSchema: Schema;
  closureSchema: Schema;
  settingsSchema: Schema;
  staffAccountSchema: Schema;
};
type SchemaName = keyof SchemasModule;
type Row = Record<string, unknown>;

const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;

const SCHEMAS = '@/lib/admin/schemas';

const parseWith = async (name: SchemaName, input: unknown): Promise<ParseResult> => {
  const mod = await load<SchemasModule>(SCHEMAS);
  expect(mod[name], `src/lib/admin/schemas.ts deve esportare ${name}`).toBeDefined();
  return mod[name].safeParse(input);
};

const accept = async (name: SchemaName, input: unknown): Promise<Row> => {
  const result = await parseWith(name, input);
  expect(result.success, `${name} doveva accettare ${JSON.stringify(input)}`).toBe(true);
  return result.data as Row;
};

const reject = async (name: SchemaName, input: unknown): Promise<void> => {
  const result = await parseWith(name, input);
  expect(result.success, `${name} doveva rifiutare ${JSON.stringify(input)}`).toBe(false);
};

const UUID_A = '50000000-0000-4000-8000-000000000001';
const UUID_B = '50000000-0000-4000-8000-000000000002';

// ---------------------------------------------------------------------------
// serviceSchema – SPEC §3.2, §6.4
// ---------------------------------------------------------------------------
describe('serviceSchema – servizi (SPEC §3.2, §6.4)', () => {
  const valid = {
    name: 'Taglio sfumato',
    description: 'Sfumatura alta o bassa',
    durationMin: '30',
    price: '12,50',
    isActive: true,
  };

  // SPEC §3.2: durata in minuti, prezzo in centesimi (intero)
  test('accetta un servizio valido e restituisce durata intera e prezzo in centesimi', async () => {
    const data = await accept('serviceSchema', valid);
    expect(data).toMatchObject({
      name: 'Taglio sfumato',
      description: 'Sfumatura alta o bassa',
      durationMin: 30,
      priceCents: 1250,
      isActive: true,
    });
    expect(Number.isInteger(data.priceCents)).toBe(true);
  });

  test.each([
    ['12', 1200],
    ['12,5', 1250],
    ['12.50', 1250],
    ['0', 0],
    ['19,99', 1999],
    ['1,15', 115],
  ])('prezzo %j → priceCents %i', async (price, expected) => {
    expect((await accept('serviceSchema', { ...valid, price })).priceCents).toBe(expected);
  });

  test('toglie gli spazi ai bordi del nome', async () => {
    expect((await accept('serviceSchema', { ...valid, name: '  Barba  ' })).name).toBe('Barba');
  });

  // SPEC §3.2: la descrizione è facoltativa
  test.each([
    ['mancante', undefined],
    ['vuota', ''],
    ['solo spazi', '   '],
    ['null', null],
  ])('descrizione %s → nessuna descrizione (null o assente)', async (_label, description) => {
    const data = await accept('serviceSchema', { ...valid, description });
    expect(data.description ?? null).toBeNull();
  });

  test('il servizio può essere salvato disattivato', async () => {
    expect((await accept('serviceSchema', { ...valid, isActive: false })).isActive).toBe(false);
  });

  test('accetta la durata massima di 480 minuti', async () => {
    expect((await accept('serviceSchema', { ...valid, durationMin: '480' })).durationMin).toBe(480);
  });

  test.each([
    ['nome mancante', { name: undefined }],
    ['nome vuoto', { name: '' }],
    ['nome di soli spazi', { name: '   ' }],
    ['nome più lungo di 100 caratteri', { name: 'a'.repeat(101) }],
    ['descrizione più lunga di 500 caratteri', { description: 'a'.repeat(501) }],
    ['durata mancante', { durationMin: undefined }],
    ['durata vuota', { durationMin: '' }],
    ['durata zero', { durationMin: '0' }],
    ['durata negativa', { durationMin: '-15' }],
    ['durata non intera', { durationMin: '30.5' }],
    ['durata testuale', { durationMin: 'mezz\'ora' }],
    ['durata oltre 480 minuti', { durationMin: '481' }],
    ['prezzo mancante', { price: undefined }],
    ['prezzo vuoto', { price: '' }],
    ['prezzo negativo', { price: '-1' }],
    ['prezzo con tre decimali', { price: '1,005' }],
    ['prezzo testuale', { price: 'gratis' }],
    ['prezzo con separatore delle migliaia', { price: '1.234,50' }],
    ['isActive non booleano', { isActive: 'forse' }],
  ])('rifiuta: %s', async (_label, overrides) => {
    await reject('serviceSchema', { ...valid, ...overrides });
  });

  // CLAUDE.md regola 3: l'importo non arriva mai già in centesimi o in float dal client
  test('non lascia passare campi non previsti (priceCents, sortOrder, id)', async () => {
    const result = await parseWith('serviceSchema', {
      ...valid,
      priceCents: 1,
      price_cents: 1,
      sortOrder: -1,
      id: UUID_A,
    });
    if (result.success) {
      const data = result.data as Row;
      expect(data.priceCents).toBe(1250);
      expect(data).not.toHaveProperty('price_cents');
      expect(data).not.toHaveProperty('sortOrder');
      expect(data).not.toHaveProperty('id');
    } else {
      expect(result.success).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// barberSchema – SPEC §3.3, §6.5
// ---------------------------------------------------------------------------
describe('barberSchema – barbieri (SPEC §3.3, §6.5)', () => {
  const valid = {
    displayName: 'Marco',
    photoUrl: 'https://example.com/foto/marco.jpg',
    bio: 'Specialista in barba',
    isActive: true,
    serviceIds: [UUID_A, UUID_B],
  };

  test('accetta un barbiere valido con foto https e servizi abilitati', async () => {
    const data = await accept('barberSchema', valid);
    expect(data).toMatchObject({
      displayName: 'Marco',
      photoUrl: 'https://example.com/foto/marco.jpg',
      bio: 'Specialista in barba',
      isActive: true,
    });
    expect([...(data.serviceIds as string[])].sort()).toEqual([UUID_A, UUID_B].sort());
  });

  test('toglie gli spazi ai bordi di nome e URL della foto', async () => {
    const data = await accept('barberSchema', {
      ...valid,
      displayName: '  Marco  ',
      photoUrl: '  https://example.com/marco.jpg  ',
    });
    expect(data.displayName).toBe('Marco');
    expect(data.photoUrl).toBe('https://example.com/marco.jpg');
  });

  // SPEC §3.3: foto e bio facoltative
  test.each([
    ['mancante', undefined],
    ['vuota', ''],
    ['solo spazi', '   '],
  ])('foto %s → nessuna foto (null o assente)', async (_label, photoUrl) => {
    const data = await accept('barberSchema', { ...valid, photoUrl });
    expect(data.photoUrl ?? null).toBeNull();
  });

  test.each([
    ['mancante', undefined],
    ['vuota', ''],
  ])('bio %s → nessuna bio (null o assente)', async (_label, bio) => {
    const data = await accept('barberSchema', { ...valid, bio });
    expect(data.bio ?? null).toBeNull();
  });

  // Un barbiere appena assunto può non avere ancora servizi abilitati
  test('accetta un elenco di servizi vuoto', async () => {
    expect((await accept('barberSchema', { ...valid, serviceIds: [] })).serviceIds).toEqual([]);
  });

  // Decisione fetta 3: la foto si mostra ai clienti, quindi solo URL https:// validi
  test.each([
    ['http', 'http://example.com/foto.jpg'],
    ['javascript', 'javascript:alert(1)'],
    ['javascript con maiuscole', 'JavaScript:alert(1)'],
    ['data', 'data:image/png;base64,iVBORw0KGgo='],
    ['ftp', 'ftp://example.com/foto.jpg'],
    ['file', 'file:///etc/passwd'],
    ['relativo', '/foto/marco.jpg'],
    ['protocollo relativo', '//example.com/foto.jpg'],
    ['senza host', 'https://'],
    ['testo qualsiasi', 'non è un url'],
    ['più lungo di 2048 caratteri', `https://example.com/${'a'.repeat(2048)}`],
  ])('rifiuta una foto %s', async (_label, photoUrl) => {
    await reject('barberSchema', { ...valid, photoUrl });
  });

  test.each([
    ['nome mancante', { displayName: undefined }],
    ['nome vuoto', { displayName: '' }],
    ['nome di soli spazi', { displayName: '   ' }],
    ['nome più lungo di 100 caratteri', { displayName: 'a'.repeat(101) }],
    ['bio più lunga di 500 caratteri', { bio: 'a'.repeat(501) }],
    ['servizio con id non valido', { serviceIds: ['non-un-uuid'] }],
    ['servizi non in un array', { serviceIds: UUID_A }],
    ['isActive non booleano', { isActive: 'sì' }],
  ])('rifiuta: %s', async (_label, overrides) => {
    await reject('barberSchema', { ...valid, ...overrides });
  });

  // ADR 001: barbers.profile_id si gestisce solo dalla server action degli account staff
  test('non lascia passare profile_id né id', async () => {
    const result = await parseWith('barberSchema', {
      ...valid,
      profileId: UUID_A,
      profile_id: UUID_A,
      id: UUID_B,
    });
    if (result.success) {
      const data = result.data as Row;
      expect(data).not.toHaveProperty('profileId');
      expect(data).not.toHaveProperty('profile_id');
      expect(data).not.toHaveProperty('id');
    } else {
      expect(result.success).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// weeklyHoursSchema – SPEC §3.4
// Decisione fetta 3: elenco piatto di fasce { weekday (ISO 1–7), start 'HH:mm', end 'HH:mm' },
// lo stesso formato passato a set_working_hours.
// ---------------------------------------------------------------------------
describe('weeklyHoursSchema – orari settimanali a più fasce (SPEC §3.4)', () => {
  const slot = (weekday: number | string, start: string, end: string) => ({ weekday, start, end });

  // SPEC §3.4: "una o più fasce (es. 09:00–13:00 e 15:00–19:30)"
  test('accetta due fasce nello stesso giorno', async () => {
    const data = (await accept('weeklyHoursSchema', [
      slot(2, '09:00', '13:00'),
      slot(2, '15:00', '19:30'),
    ])) as unknown as Row[];
    expect(data).toHaveLength(2);
    expect(data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ weekday: 2, start: '09:00', end: '13:00' }),
        expect.objectContaining({ weekday: 2, start: '15:00', end: '19:30' }),
      ]),
    );
  });

  test('il giorno arriva come stringa dal form e diventa un numero', async () => {
    const data = (await accept('weeklyHoursSchema', [slot('3', '09:00', '13:00')])) as unknown as Row[];
    expect(data[0]?.weekday).toBe(3);
  });

  test('accetta una settimana intera, dal lunedì (1) alla domenica (7)', async () => {
    const week = [1, 2, 3, 4, 5, 6, 7].map((day) => slot(day, '09:00', '18:00'));
    expect(await accept('weeklyHoursSchema', week)).toHaveLength(7);
  });

  // Un barbiere può non lavorare mai (es. in aspettativa): nessuna fascia
  test('accetta un elenco vuoto', async () => {
    expect(await accept('weeklyHoursSchema', [])).toEqual([]);
  });

  // Fasce che si toccano non si sovrappongono (intervalli [inizio, fine))
  test('accetta fasce contigue', async () => {
    await accept('weeklyHoursSchema', [slot(2, '09:00', '13:00'), slot(2, '13:00', '15:00')]);
  });

  test('accetta fasce uguali in giorni diversi', async () => {
    await accept('weeklyHoursSchema', [slot(2, '09:00', '13:00'), slot(3, '09:00', '13:00')]);
  });

  test('accetta una fascia che finisce alle 23:59', async () => {
    await accept('weeklyHoursSchema', [slot(5, '18:00', '23:59')]);
  });

  test.each([
    ['inizio uguale alla fine', [slot(2, '09:00', '09:00')]],
    ['inizio dopo la fine', [slot(2, '13:00', '09:00')]],
    ['fasce sovrapposte', [slot(2, '09:00', '13:00'), slot(2, '12:00', '15:00')]],
    ['fascia contenuta in un\'altra', [slot(2, '09:00', '18:00'), slot(2, '10:00', '11:00')]],
    ['fasce identiche', [slot(2, '09:00', '13:00'), slot(2, '09:00', '13:00')]],
    ['fasce sovrapposte non in ordine', [slot(4, '15:00', '19:30'), slot(4, '09:00', '16:00')]],
    ['giorno 0', [slot(0, '09:00', '13:00')]],
    ['giorno 8', [slot(8, '09:00', '13:00')]],
    ['giorno non intero', [slot(1.5, '09:00', '13:00')]],
    ['giorno testuale', [slot('lunedì', '09:00', '13:00')]],
    // Decisione fetta 3: niente fascia che termina a mezzanotte ("24:00"); massimo 23:59
    ['fine 24:00', [slot(5, '18:00', '24:00')]],
    ['ora 25:00', [slot(5, '18:00', '25:00')]],
    ['minuti 60', [slot(5, '09:60', '13:00')]],
    ['ora senza zero iniziale', [slot(5, '9:00', '13:00')]],
    ['ora vuota', [slot(5, '', '13:00')]],
    ['ora testuale', [slot(5, 'mattina', '13:00')]],
    ['non un elenco', slot(2, '09:00', '13:00')],
  ])('rifiuta: %s', async (_label, input) => {
    await reject('weeklyHoursSchema', input);
  });
});

// ---------------------------------------------------------------------------
// timeOffSchema / closureSchema – SPEC §3.5, §6.5, §6.6
// Decisione fetta 3: due modalità.
//   { mode: 'allDay', fromDate: 'YYYY-MM-DD', toDate: 'YYYY-MM-DD', reason? }  (Y incluso)
//   { mode: 'timed',  start: 'YYYY-MM-DDTHH:mm', end: 'YYYY-MM-DDTHH:mm', reason? }
// Date e ore sono locali del negozio: la conversione in UTC la fa la server action con
// src/lib/admin/local-time.ts e la timezone di shop_settings.
// ---------------------------------------------------------------------------
describe.each(['timeOffSchema', 'closureSchema'] as const)('%s – periodi (SPEC §3.5)', (name) => {
  const allDay = { mode: 'allDay', fromDate: '2026-12-24', toDate: '2026-12-26', reason: 'Ferie' };
  const timed = { mode: 'timed', start: '2026-11-12T10:00', end: '2026-11-12T11:30', reason: 'Visita' };

  test('accetta un periodo a giornata intera', async () => {
    expect(await accept(name, allDay)).toMatchObject(allDay);
  });

  test('accetta un periodo a giornata intera di un solo giorno (dal = al)', async () => {
    await accept(name, { ...allDay, toDate: allDay.fromDate });
  });

  // SPEC §3.5 / §12: "anche parziale nella giornata", "Assenza parziale a metà mattina"
  test('accetta un periodo parziale nella giornata', async () => {
    expect(await accept(name, timed)).toMatchObject(timed);
  });

  test('accetta un periodo con orario su più giorni', async () => {
    await accept(name, { ...timed, start: '2026-11-12T15:00', end: '2026-11-14T12:00' });
  });

  test.each([
    ['mancante', undefined],
    ['vuoto', ''],
    ['solo spazi', '   '],
  ])('motivo %s → nessun motivo (null o assente)', async (_label, reason) => {
    const data = await accept(name, { ...allDay, reason });
    expect(data.reason ?? null).toBeNull();
  });

  test('toglie gli spazi ai bordi del motivo', async () => {
    expect((await accept(name, { ...allDay, reason: '  Ferie  ' })).reason).toBe('Ferie');
  });

  test.each([
    ['fine giornata intera prima dell\'inizio', { ...allDay, fromDate: '2026-12-26', toDate: '2026-12-24' }],
    ['data inesistente', { ...allDay, fromDate: '2026-02-30' }],
    ['data in altro formato', { ...allDay, fromDate: '24/12/2026' }],
    ['data mancante', { ...allDay, toDate: undefined }],
    ['fine con orario uguale all\'inizio', { ...timed, end: timed.start }],
    ['fine con orario prima dell\'inizio', { ...timed, start: '2026-11-12T11:30', end: '2026-11-12T10:00' }],
    ['orario non valido', { ...timed, start: '2026-11-12T25:00' }],
    ['orario mancante', { ...timed, end: undefined }],
    ['modalità mancante', { fromDate: '2026-12-24', toDate: '2026-12-26' }],
    ['modalità sconosciuta', { ...allDay, mode: 'settimana' }],
    ['motivo più lungo di 200 caratteri', { ...allDay, reason: 'a'.repeat(201) }],
  ])('rifiuta: %s', async (_label, input) => {
    await reject(name, input);
  });
});

// ---------------------------------------------------------------------------
// settingsSchema – SPEC §3.1, §6.8
// ---------------------------------------------------------------------------
describe('settingsSchema – impostazioni del negozio (SPEC §3.1, §6.8)', () => {
  const valid = {
    name: 'Barber Shop',
    address: 'Via Roma 1, 00100 Roma',
    phone: '+39 06 1234567',
    logoUrl: 'https://example.com/logo.png',
    timezone: 'Europe/Rome',
    slotGranularityMin: '15',
    minAdvanceMin: '60',
    maxHorizonDays: '30',
    cancelLimitMin: '120',
    bufferMin: '0',
    noShowBlockThreshold: '3',
    privacyPolicyVersion: '2026-10',
  };

  test('accetta i valori di default della SPEC §3.1 e converte i numeri', async () => {
    const data = await accept('settingsSchema', valid);
    expect(data).toMatchObject({
      name: 'Barber Shop',
      address: 'Via Roma 1, 00100 Roma',
      logoUrl: 'https://example.com/logo.png',
      timezone: 'Europe/Rome',
      slotGranularityMin: 15,
      minAdvanceMin: 60,
      maxHorizonDays: 30,
      cancelLimitMin: 120,
      bufferMin: 0,
      noShowBlockThreshold: 3,
      privacyPolicyVersion: '2026-10',
    });
  });

  // SPEC §3.1: "no_show_block_threshold ... 0 = disattivato"
  test('accetta no_show_block_threshold = 0 (blocco disattivato)', async () => {
    expect((await accept('settingsSchema', { ...valid, noShowBlockThreshold: '0' })).noShowBlockThreshold).toBe(0);
  });

  test('accetta orizzonte di 1 giorno', async () => {
    expect((await accept('settingsSchema', { ...valid, maxHorizonDays: '1' })).maxHorizonDays).toBe(1);
  });

  test('accetta zero per anticipo minimo, limite di cancellazione e buffer', async () => {
    const data = await accept('settingsSchema', { ...valid, minAdvanceMin: '0', cancelLimitMin: '0', bufferMin: '0' });
    expect(data).toMatchObject({ minAdvanceMin: 0, cancelLimitMin: 0, bufferMin: 0 });
  });

  // Decisione fetta 3 (utente): granularità solo fra 5, 10, 15, 20, 30, 60 minuti
  test.each([
    ['5', 5],
    ['10', 10],
    ['15', 15],
    ['20', 20],
    ['30', 30],
    ['60', 60],
  ])('accetta la granularità %s', async (slotGranularityMin, expected) => {
    expect((await accept('settingsSchema', { ...valid, slotGranularityMin })).slotGranularityMin).toBe(expected);
  });

  test.each(['America/New_York', 'UTC', 'Europe/London'])('accetta la timezone IANA %s', async (timezone) => {
    expect((await accept('settingsSchema', { ...valid, timezone })).timezone).toBe(timezone);
  });

  test('indirizzo, telefono e logo sono facoltativi', async () => {
    const data = await accept('settingsSchema', { ...valid, address: '', phone: '', logoUrl: '' });
    expect(data.address ?? null).toBeNull();
    expect(data.phone ?? null).toBeNull();
    expect(data.logoUrl ?? null).toBeNull();
  });

  test('toglie gli spazi ai bordi di nome e versione dell\'informativa', async () => {
    const data = await accept('settingsSchema', { ...valid, name: '  Da Mario  ', privacyPolicyVersion: ' 2026-11 ' });
    expect(data.name).toBe('Da Mario');
    expect(data.privacyPolicyVersion).toBe('2026-11');
  });

  test.each([
    ['nome vuoto', { name: '' }],
    ['nome di soli spazi', { name: '   ' }],
    ['nome mancante', { name: undefined }],
    ['nome più lungo di 100 caratteri', { name: 'a'.repeat(101) }],
    ['logo http', { logoUrl: 'http://example.com/logo.png' }],
    ['logo javascript', { logoUrl: 'javascript:alert(1)' }],
    ['logo data', { logoUrl: 'data:image/png;base64,iVBORw0KGgo=' }],
    ['timezone inesistente', { timezone: 'Mars/Olympus_Mons' }],
    ['timezone vuota', { timezone: '' }],
    ['timezone testuale', { timezone: 'ora di Roma' }],
    ['granularità 0', { slotGranularityMin: '0' }],
    ['granularità negativa', { slotGranularityMin: '-15' }],
    ['granularità 1', { slotGranularityMin: '1' }],
    ['granularità 7', { slotGranularityMin: '7' }],
    ['granularità 25', { slotGranularityMin: '25' }],
    ['granularità 45', { slotGranularityMin: '45' }],
    ['granularità 90', { slotGranularityMin: '90' }],
    ['granularità 120', { slotGranularityMin: '120' }],
    ['granularità non intera', { slotGranularityMin: '7.5' }],
    ['granularità vuota', { slotGranularityMin: '' }],
    ['anticipo minimo negativo', { minAdvanceMin: '-1' }],
    ['anticipo minimo non intero', { minAdvanceMin: '1.5' }],
    ['orizzonte negativo', { maxHorizonDays: '-1' }],
    // Decisione fetta 3 (utente): max_horizon_days >= 1
    ['orizzonte zero', { maxHorizonDays: '0' }],
    ['orizzonte testuale', { maxHorizonDays: 'trenta' }],
    ['limite di cancellazione negativo', { cancelLimitMin: '-30' }],
    ['buffer negativo', { bufferMin: '-5' }],
    ['buffer vuoto', { bufferMin: '' }],
    ['soglia no-show negativa', { noShowBlockThreshold: '-1' }],
    ['soglia no-show non intera', { noShowBlockThreshold: '2.5' }],
    ['versione dell\'informativa vuota', { privacyPolicyVersion: '' }],
    ['versione dell\'informativa di soli spazi', { privacyPolicyVersion: '   ' }],
    ['versione dell\'informativa mancante', { privacyPolicyVersion: undefined }],
  ])('rifiuta: %s', async (_label, overrides) => {
    await reject('settingsSchema', { ...valid, ...overrides });
  });
});

// ---------------------------------------------------------------------------
// staffAccountSchema – SPEC §2, §5.5 (staff senza auto-registrazione), decisione fetta 3 (C)
// ---------------------------------------------------------------------------
describe('staffAccountSchema – account staff creati dall\'admin (SPEC §2, §5.5)', () => {
  const valid = {
    email: 'nuovo.barbiere@example.com',
    password: 'Password-2026',
    displayName: 'Nuovo Barbiere',
    barberId: UUID_A,
  };

  test('accetta email, password di almeno 10 caratteri, nome e barbiere', async () => {
    expect(await accept('staffAccountSchema', valid)).toMatchObject(valid);
  });

  test('toglie gli spazi ai bordi dell\'email, non tocca la password', async () => {
    const data = await accept('staffAccountSchema', {
      ...valid,
      email: '  nuovo.barbiere@example.com ',
      password: ' spazi-ai-bordi ',
    });
    expect(data.email).toBe('nuovo.barbiere@example.com');
    expect(data.password).toBe(' spazi-ai-bordi ');
  });

  // supabase/config.toml: minimum_password_length = 10 (fetta 2)
  test('accetta una password di esattamente 10 caratteri', async () => {
    await accept('staffAccountSchema', { ...valid, password: 'a'.repeat(10) });
  });

  test.each([
    ['email non valida', { email: 'nuovo.barbiere' }],
    ['email vuota', { email: '' }],
    ['password di 9 caratteri', { password: 'a'.repeat(9) }],
    ['password vuota', { password: '' }],
    ['password mancante', { password: undefined }],
    ['nome vuoto', { displayName: '   ' }],
    ['nome più lungo di 100 caratteri', { displayName: 'a'.repeat(101) }],
    ['barbiere mancante', { barberId: undefined }],
    ['barbiere non valido', { barberId: 'barbiere-1' }],
  ])('rifiuta: %s', async (_label, overrides) => {
    await reject('staffAccountSchema', { ...valid, ...overrides });
  });

  // Decisione fetta 3: l'account creato dall'admin è sempre un barbiere
  test('non lascia passare un ruolo inviato dal client', async () => {
    const result = await parseWith('staffAccountSchema', { ...valid, role: 'admin' });
    if (result.success) expect(result.data).not.toHaveProperty('role');
    else expect(result.success).toBe(false);
  });
});
