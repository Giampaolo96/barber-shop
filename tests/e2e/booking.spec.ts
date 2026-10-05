// Test di accettazione e2e – FETTA 5 (SPEC §11: "Prenotazione e cancellazione end-to-end con Playwright").
// Flussi principali del cliente: SPEC §5.1 (home con "Prenota" e prossima prenotazione), §5.2 (flusso
// in max 4 schermate), §5.3 (Le mie prenotazioni, cancellazione fino al limite, "Chiama il negozio"),
// §5.5 (login richiesto per prenotare), §12 (cliente bloccato) + decisioni approvate per la fetta 5.
//
// Rotte attese:
//   /prenota                                   scelta del servizio (solo servizi attivi con almeno un
//                                              barbiere attivo abilitato)
//   /prenota/barbiere?servizio=<id>            barbieri abilitati + "Nessuna preferenza"; saltata se il
//                                              servizio ha un solo barbiere abilitato
//   /prenota/orario?servizio=&barbiere=<id|any> striscia dei giorni (all'apertura è selezionato il primo
//                                              giorno con orari) e griglia degli orari "HH:MM"
//   /prenota/riepilogo?servizio=&barbiere=&inizio=<ISO>  riepilogo, nota facoltativa, conferma
//   /prenotazioni                              future e passate; dopo la conferma banner "Prenotazione
//                                              confermata"
// Testi attesi (da mettere in src/i18n/it.ts): "Prenota", "Prossima prenotazione", "Nessuna preferenza",
// "Conferma prenotazione", campo con etichetta che contiene "Note", "Prenotazione confermata",
// "Cancella", "Prenotazione cancellata", "Chiama il negozio" (link tel:), messaggio per il cliente
// bloccato che contiene "non puoi prenotare online".
//
// Prerequisiti: Supabase locale con il seed (`npx supabase db reset`), Mailpit su
// http://127.0.0.1:54324, NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (ambiente o
// .env.local). I dati (servizi, barbieri, orari, prenotazioni) sono creati per ogni test con nomi
// univoci tramite l'admin demo (RLS attiva) e rimossi alla fine; i clienti nuovi hanno email univoche.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

import {
  CUSTOMER_EMAIL,
  SEED,
  acceptDialogs,
  adminApi,
  cleanup,
  createBarber,
  createService,
  expectPath,
  s,
  uniqueEmail,
  uniqueName,
  type AdminApi,
} from './admin-helpers';

const MAILPIT_URL = 'http://127.0.0.1:54324';
const TZ = 'Europe/Rome';
const TIME = /^\d{2}:\d{2}$/;

// ---------------------------------------------------------------------------
// Login del cliente con magic link (Mailpit), come in auth.spec.ts
// ---------------------------------------------------------------------------
type MailpitSummary = { ID: string; Created: string };

/**
 * Id dell'email più recente arrivata a `to` (null se nessuna). La ricerca di Mailpit restituisce i
 * messaggi dal più recente e al massimo 50 per pagina: contarli non funziona con la casella piena,
 * il più recente sì.
 */
const newestEmailId = async (request: APIRequestContext, to: string): Promise<string | null> => {
  const response = await request.get(`${MAILPIT_URL}/api/v1/search`, { params: { query: `to:"${to}"`, limit: '1' } });
  expect(response.ok(), 'Mailpit non raggiungibile su http://127.0.0.1:54324').toBe(true);
  return ((await response.json()) as { messages: MailpitSummary[] }).messages[0]?.ID ?? null;
};

/** Link /auth/confirm dell'email più recente arrivata a `to`, diversa da `previousId`. */
const latestConfirmLink = async (request: APIRequestContext, to: string, previousId: string | null): Promise<string> => {
  let newest: string | null = null;
  await expect
    .poll(
      async () => {
        newest = await newestEmailId(request, to);
        return newest !== null && newest !== previousId;
      },
      { message: `nessuna email arrivata a ${to}`, timeout: 10_000 },
    )
    .toBe(true);
  const message = (await (await request.get(`${MAILPIT_URL}/api/v1/message/${newest}`)).json()) as { HTML: string };
  const href = [...message.HTML.matchAll(/href="([^"]+)"/g)]
    .map((m) => (m[1] ?? '').replace(/&amp;/g, '&'))
    .find((h) => h.includes('/auth/confirm?'));
  expect(href, "link /auth/confirm nell'email").toBeDefined();
  const url = new URL(href ?? 'http://invalid.invalid');
  return `${url.pathname}${url.search}`;
};

/**
 * Chiede il magic link dalla pagina di login già aperta (così resta l'eventuale destinazione di
 * ritorno), apre il link e conferma.
 */
const loginFromCurrentPage = async (page: Page, email: string): Promise<void> => {
  await expectPath(page, '/accedi');
  const before = await newestEmailId(page.request, email);
  await page.getByLabel(s('auth.customerLogin.emailLabel')).fill(email);
  await page.getByRole('button', { name: s('auth.customerLogin.submit') }).click();
  await expect(page.getByText(s('auth.customerLogin.linkSent'))).toBeVisible();
  await page.goto(await latestConfirmLink(page.request, email, before));
  await page.locator('main form').getByRole('button', { name: s('auth.confirmLink.submit') }).click();
};

const loginCustomer = async (page: Page, email: string): Promise<void> => {
  await page.goto('/accedi');
  await loginFromCurrentPage(page, email);
  await expectPath(page, '/');
};

/** Cliente nuovo con profilo completo; restituisce l'id del profilo (letto dall'admin). */
const signUpCustomer = async (page: Page, api: AdminApi, label: string): Promise<string> => {
  const email = uniqueEmail(label);
  const fullName = uniqueName('Cliente');
  await page.goto('/accedi');
  await loginFromCurrentPage(page, email);
  await expectPath(page, '/profilo/completa');
  await page.getByLabel(s('auth.completeProfile.fullNameLabel')).fill(fullName);
  await page.getByLabel(s('auth.completeProfile.phoneLabel')).fill(`+39 333 ${Math.floor(1_000_000 + Math.random() * 8_999_999)}`);
  await page.getByLabel(s('auth.completeProfile.privacyConsentLabel')).check();
  await page.getByRole('button', { name: s('auth.completeProfile.submit') }).click();
  await expectPath(page, '/');
  const rows = await api.get<Array<{ id: string }>>(
    `/rest/v1/profiles?select=id&full_name=eq.${encodeURIComponent(fullName)}`,
  );
  expect(rows).toHaveLength(1);
  return rows[0]?.id ?? '';
};

// ---------------------------------------------------------------------------
// Dati di prova
// ---------------------------------------------------------------------------
type Created = { services: string[]; barbers: string[]; bookings: string[] };

/** Barbieri con orario 06:00–23:00 tutti i giorni, abilitati al servizio. */
const createBarbers = async (api: AdminApi, data: Created, serviceId: string, names: string[]): Promise<string[]> => {
  const ids: string[] = [];
  for (const name of names) {
    const id = await createBarber(api, name, [serviceId]);
    data.barbers.push(id);
    ids.push(id);
  }
  await api.post(
    '/rest/v1/working_hours?select=id',
    ids.flatMap((barber_id) =>
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ barber_id, weekday, start_time: '06:00', end_time: '23:00' })),
    ),
  );
  return ids;
};

const newService = async (api: AdminApi, data: Created, label: string): Promise<{ id: string; name: string }> => {
  const name = uniqueName(label);
  const id = await createService(api, { name, durationMin: 30, priceCents: 2000 });
  data.services.push(id);
  return { id, name };
};

type BookingRow = {
  id: string;
  customer_id: string | null;
  barber_id: string;
  status: string;
  source: string;
  notes: string | null;
  starts_at: string;
};
const bookingsOfService = (api: AdminApi, serviceId: string): Promise<BookingRow[]> =>
  api.get<BookingRow[]>(
    `/rest/v1/bookings?select=id,customer_id,barber_id,status,source,notes,starts_at&service_id=eq.${serviceId}`,
  );

const localTime = (iso: string): string => formatInTimeZone(new Date(iso), TZ, 'HH:mm');
const localDay = (offsetDays: number): string => {
  const today = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// Interfaccia
// ---------------------------------------------------------------------------
const main = (page: Page): Locator => page.locator('main');

/** Scelta (servizio, barbiere, "Nessuna preferenza"): link o pulsante che contiene il testo. */
const choice = (page: Page, text: string): Locator => {
  const name = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return main(page).getByRole('link', { name }).or(main(page).getByRole('button', { name })).first();
};

/** Ultimo orario della griglia del giorno selezionato (lontano dall'anticipo minimo). */
const lastSlot = (page: Page): Locator =>
  main(page).getByRole('button', { name: TIME }).or(main(page).getByRole('link', { name: TIME })).last();

const confirmButton = (page: Page): Locator => page.getByRole('button', { name: 'Conferma prenotazione' });

/**
 * Click dopo aver atteso che l'elemento sia visibile (timeout di expect): se manca, il test fallisce
 * subito con un messaggio chiaro e resta il tempo per la pulizia dei dati.
 */
const tap = async (locator: Locator): Promise<void> => {
  await expect(locator).toBeVisible();
  await locator.click();
};

/** Sceglie l'ultimo orario e lo conferma dal riepilogo; restituisce l'ora scelta (HH:MM). */
const pickLastSlotAndConfirm = async (page: Page, note?: string): Promise<string> => {
  await expect(lastSlot(page)).toBeVisible();
  const time = (await lastSlot(page).innerText()).trim();
  await tap(lastSlot(page));
  await expectPath(page, '/prenota/riepilogo');
  await expect(main(page)).toContainText(time);
  if (note !== undefined) await page.getByLabel(/note/i).fill(note);
  await tap(confirmButton(page));
  await expectPath(page, '/prenotazioni');
  await expect(page.getByText('Prenotazione confermata')).toBeVisible();
  return time;
};

// ---------------------------------------------------------------------------
// 1. Cliente demo: prenotazione con barbiere scelto (SPEC §5.1, §5.2, §5.3)
// ---------------------------------------------------------------------------
test('il cliente demo prenota con un barbiere scelto: la prenotazione è in "Le mie prenotazioni" e in home', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const service = await newService(api, data, 'Taglio');
    const barberNames = [uniqueName('Primo'), uniqueName('Secondo')];
    const [chosen] = await createBarbers(api, data, service.id, barberNames);
    // Servizio attivo senza barbieri: non prenotabile, non compare
    const orphan = await newService(api, data, 'Senza barbieri');

    await loginCustomer(page, CUSTOMER_EMAIL);
    await tap(main(page).getByRole('link', { name: 'Prenota', exact: true }));
    await expectPath(page, '/prenota');
    await expect(choice(page, service.name)).toBeVisible();
    await expect(main(page).getByText(orphan.name)).toHaveCount(0);

    await tap(choice(page, service.name));
    await expectPath(page, '/prenota/barbiere');
    await expect(choice(page, 'Nessuna preferenza')).toBeVisible();
    await expect(choice(page, barberNames[1] ?? '')).toBeVisible();
    await tap(choice(page, barberNames[0] ?? ''));
    await expectPath(page, '/prenota/orario');
    expect(new URL(page.url()).searchParams.get('barbiere')).toBe(chosen);

    const note = `Nota ${uniqueName('e2e')}`;
    const time = await pickLastSlotAndConfirm(page, note);

    // Database: online, confermata, del cliente demo, con il barbiere scelto e la nota
    const rows = await bookingsOfService(api, service.id);
    data.bookings.push(...rows.map((r) => r.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      customer_id: SEED.customerProfile,
      barber_id: chosen,
      status: 'confirmed',
      source: 'online',
      notes: note,
    });
    expect(localTime(rows[0]?.starts_at ?? '')).toBe(time);

    // "Le mie prenotazioni": servizio, barbiere e orario
    await expect(main(page).getByText(service.name).first()).toBeVisible();
    await expect(main(page).getByText(barberNames[0] ?? '').first()).toBeVisible();
    await expect(main(page)).toContainText(time);

    // Home: è la prossima prenotazione del cliente (la prima futura confermata)
    const upcoming = await api.get<Array<{ id: string }>>(
      `/rest/v1/bookings?select=id&customer_id=eq.${SEED.customerProfile}&status=eq.confirmed` +
        `&starts_at=gte.${encodeURIComponent(new Date().toISOString())}&order=starts_at&limit=1`,
    );
    expect(upcoming[0]?.id, 'la nuova prenotazione è la prima futura del cliente demo').toBe(rows[0]?.id);
    await page.goto('/');
    await expect(main(page).getByText('Prossima prenotazione').first()).toBeVisible();
    await expect(main(page).getByText(service.name).first()).toBeVisible();
    await expect(main(page)).toContainText(time);
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 2. "Nessuna preferenza" (SPEC §4, §5.2)
// ---------------------------------------------------------------------------
test('"Nessuna preferenza": la prenotazione viene creata con un barbiere assegnato', async ({ page, request }) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const service = await newService(api, data, 'Barba');
    const barberNames = [uniqueName('Uno'), uniqueName('Due')];
    const barbers = await createBarbers(api, data, service.id, barberNames);
    const customerId = await signUpCustomer(page, api, 'qualsiasi');

    await page.goto('/prenota');
    await tap(choice(page, service.name));
    await expectPath(page, '/prenota/barbiere');
    await tap(choice(page, 'Nessuna preferenza'));
    await expectPath(page, '/prenota/orario');
    expect(new URL(page.url()).searchParams.get('barbiere')).toBe('any');

    await pickLastSlotAndConfirm(page);

    const rows = await bookingsOfService(api, service.id);
    data.bookings.push(...rows.map((r) => r.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customer_id: customerId, status: 'confirmed', source: 'online' });
    expect(barbers).toContain(rows[0]?.barber_id);

    const assignedName = barberNames[barbers.indexOf(rows[0]?.barber_id ?? '')] ?? '';
    await expect(main(page).getByText(service.name).first()).toBeVisible();
    await expect(main(page).getByText(assignedName).first()).toBeVisible();
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 3. Cancellazione (SPEC §5.3, §3.1 cancel_limit_min)
// ---------------------------------------------------------------------------
test('il cliente cancella una propria prenotazione futura; entro il limite vede "Chiama il negozio"', async ({
  page,
  request,
}) => {
  acceptDialogs(page);
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const far = await newService(api, data, 'Lontana');
    const near = await newService(api, data, 'Vicina');
    const [barber] = await createBarbers(api, data, far.id, [uniqueName('Barbiere')]);
    await api.post('/rest/v1/barber_services?select=barber_id', { barber_id: barber, service_id: near.id });
    const customerId = await signUpCustomer(page, api, 'cancella');

    // Prenotazione online fra tre giorni alle 10:00, confermata dal riepilogo
    const startsAt = fromZonedTime(`${localDay(3)}T10:00:00`, TZ).toISOString();
    await page.goto(
      `/prenota/riepilogo?servizio=${far.id}&barbiere=${barber}&inizio=${encodeURIComponent(startsAt)}`,
    );
    await expect(main(page).getByText(far.name).first()).toBeVisible();
    await tap(confirmButton(page));
    await expectPath(page, '/prenotazioni');
    await expect(page.getByText('Prenotazione confermata')).toBeVisible();
    const [booking] = await bookingsOfService(api, far.id);
    expect(booking).toMatchObject({ customer_id: customerId, status: 'confirmed', source: 'online' });
    data.bookings.push(booking?.id ?? '');

    // Prenotazione fra 30 minuti (manuale, dallo staff): oltre il limite di cancellazione
    const soon = new Date(Math.ceil((Date.now() + 30 * 60_000) / 60_000) * 60_000).toISOString();
    const [manual] = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
      customer_id: customerId,
      barber_id: barber,
      service_id: near.id,
      starts_at: soon,
      source: 'manual',
      status: 'confirmed',
    });
    data.bookings.push(manual?.id ?? '');

    await page.goto('/prenotazioni');
    const farItem = main(page).getByRole('listitem').filter({ hasText: far.name });
    const nearItem = main(page).getByRole('listitem').filter({ hasText: near.name });

    // SPEC §5.3: oltre il limite niente "Cancella", ma il telefono del negozio
    const [settings] = await api.get<Array<{ phone: string }>>('/rest/v1/shop_settings?select=phone');
    const call = nearItem.getByRole('link', { name: 'Chiama il negozio' });
    await expect(call).toBeVisible();
    const href = (await call.getAttribute('href')) ?? '';
    expect(href.startsWith('tel:')).toBe(true);
    expect(href.slice(4).replace(/[^\d+]/g, '')).toBe((settings?.phone ?? '').replace(/[^\d+]/g, ''));
    await expect(nearItem.getByRole('button', { name: 'Cancella' })).toHaveCount(0);

    // Cancellazione della prenotazione lontana
    await tap(farItem.getByRole('button', { name: 'Cancella' }));
    await expect(page.getByText('Prenotazione cancellata')).toBeVisible();
    await expect
      .poll(async () => (await bookingsOfService(api, far.id))[0]?.status)
      .toBe('cancelled_by_customer');
    await page.reload();
    await expect(main(page).getByRole('listitem').filter({ hasText: far.name })).toBeVisible();
    await expect(
      main(page).getByRole('listitem').filter({ hasText: far.name }).getByRole('button', { name: 'Cancella' }),
    ).toHaveCount(0);
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 4. Accesso: login richiesto con ritorno a /prenota; cliente bloccato (SPEC §5.5, §6.7, §12)
// ---------------------------------------------------------------------------
test('anonimo su /prenota va al login e poi torna a /prenota; il cliente bloccato non può confermare', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const service = await newService(api, data, 'Unico barbiere');
    const [barber] = await createBarbers(api, data, service.id, [uniqueName('Solo')]);

    // Cliente già registrato con profilo completo, poi senza sessione
    const email = uniqueEmail('ritorno');
    const fullName = uniqueName('Cliente');
    await page.goto('/accedi');
    await loginFromCurrentPage(page, email);
    await expectPath(page, '/profilo/completa');
    await page.getByLabel(s('auth.completeProfile.fullNameLabel')).fill(fullName);
    await page.getByLabel(s('auth.completeProfile.phoneLabel')).fill('+39 333 7654321');
    await page.getByLabel(s('auth.completeProfile.privacyConsentLabel')).check();
    await page.getByRole('button', { name: s('auth.completeProfile.submit') }).click();
    await expectPath(page, '/');
    await page.context().clearCookies();

    // SPEC §5.5: /prenota richiede il login; dopo il login si torna a /prenota
    await page.goto('/prenota');
    await expectPath(page, '/accedi');
    await loginFromCurrentPage(page, email);
    await expectPath(page, '/prenota');

    // Un solo barbiere abilitato: il passo del barbiere si salta
    await tap(choice(page, service.name));
    await expectPath(page, '/prenota/orario');
    expect(new URL(page.url()).searchParams.get('barbiere')).toBe(barber);
    await expect(lastSlot(page)).toBeVisible();

    // L'admin blocca il cliente (SPEC §6.7)
    const [profile] = await api.get<Array<{ id: string }>>(
      `/rest/v1/profiles?select=id&full_name=eq.${encodeURIComponent(fullName)}`,
    );
    await api.patch(`/rest/v1/profiles?id=eq.${profile?.id}`, { is_blocked: true });

    await tap(lastSlot(page));
    await expectPath(page, '/prenota/riepilogo');
    await expect(page.getByText(/non puoi prenotare online/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Conferma prenotazione', disabled: false })).toHaveCount(0);
    expect(await bookingsOfService(api, service.id)).toEqual([]);
  } finally {
    await cleanup(api, data);
  }
});
