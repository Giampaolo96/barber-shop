// modificato in fetta 8g con l'approvazione dell'utente (2026-10-30, audit punto 6): aggiunto il nuovo tentativo.
// Test di accettazione e2e – FETTA 8g ("Quando?": orari di tutti i giorni già nella pagina, ricarica in
// background, route handler degli orari, annuncio del giorno; decisioni approvate dall'utente il
// 2026-10-25). SPEC §5.2, CLAUDE.md regola 6 e Sicurezza. A 390×844 (Chromium mobile).
//
// Contratto (oltre a ./when-row-helpers.ts):
//   - dopo l'apertura (e dopo al più UNA richiesta subito dopo l'idratazione, se i giorni dall'8° in poi
//     arrivano a parte) scorrere la fila fino all'ultimo giorno non fa nessuna richiesta di dati;
//   - ogni colonna disegnata (<section data-day data-barber>) contiene orari (link con nome
//     it.booking.when.slotLabel, "9:30 con <nome>") oppure il testo it.booking.when.columnNoSlots: nessuno
//     stato di caricamento;
//   - ricarica in background: a pagina tornata visibile (visibilitychange) dopo più di 2 minuti parte
//     esattamente UNA GET /prenota/quando/orari; prima dei 2 minuti nessuna; durante l'attesa gli orari
//     restano visibili; dopo la risposta compaiono gli orari nuovi;
//   - GET /prenota/quando/orari?servizio=<uuid>&da=YYYY-MM-DD&a=YYYY-MM-DD: senza sessione redirect al
//     login (o 401) senza orari; parametri non validi → 400; 200 con Cache-Control "private, no-store" e
//     JSON { days: [{ date, barbers: [{ barberId, slots, next }] }] } con i soli giorni non chiusi in
//     [da, a]: nessun dato di prenotazioni o clienti;
//   - regione aria-live (in <main>): dopo un tocco sulla striscia, a fila ferma, it.booking.when.dayAnnounce
//     ("Orari di {day}") se il giorno ha orari, it.booking.when.dayAnnounceEmpty ("{day}, nessun orario
//     libero") se non ne ha; day = formatDayLabel ("mer 21 ott").
// Richieste contate (filtro): solo quelle della pagina verso la stessa origine dell'app, di tipo fetch/xhr
// (le server action di Next sono POST fetch con l'header next-action, il route handler è una GET fetch);
// esclusi i percorsi interni del dev server (/_next/…, /__nextjs…, HMR) e i prefetch del router
// (header next-router-prefetch), che non portano orari. Supabase (altra origine) non conta.
// Dati: ogni test crea servizio e barbieri propri (nomi univoci) e li rimuove alla fine; shop_settings è
// solo letto (max_horizon_days ≥ 14). Clienti nuovi con email univoche.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type APIRequestContext, type Locator, type Page, type Request, type Route } from '@playwright/test';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

import {
  adminApi,
  cleanup,
  createBarber,
  createBooking,
  createService,
  expectPath,
  plusDays,
  s,
  sf,
  uniqueEmail,
  uniqueName,
  type AdminApi,
} from './admin-helpers';
import { confirmHref, newestEmailId, waitForNewEmail } from './mailpit';
import { dayLabel, daysStrip, expectAtEdge, scrollRow, settle, stripDays, whenColumn, whenRow } from './when-row-helpers';

test.use({ viewport: { width: 390, height: 844 } });

const TZ = 'Europe/Rome';
const WHEN_PATH = '/prenota/quando';
const SLOTS_PATH = '/prenota/quando/orari';
const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7];
const EDGE = 16;

type Created = { services: string[]; barbers: string[]; bookings: string[] };
type Barber = { id: string; name: string };

// ---------------------------------------------------------------------------
// Login del cliente (magic link via Mailpit), come negli altri e2e di "Quando?"
// ---------------------------------------------------------------------------
const latestConfirmLink = async (request: APIRequestContext, to: string, previousId: string | null): Promise<string> => {
  const href = confirmHref(await waitForNewEmail(request, to, previousId));
  expect(href, "link /auth/confirm nell'email").toBeDefined();
  const url = new URL(href ?? 'http://invalid.invalid');
  return `${url.pathname}${url.search}`;
};

const signUpCustomer = async (page: Page, label: string): Promise<string> => {
  const email = uniqueEmail(label);
  await page.goto('/accedi');
  const before = await newestEmailId(page.request, email);
  await page.getByLabel(s('auth.customerLogin.emailLabel')).fill(email);
  await page.getByRole('button', { name: s('auth.customerLogin.submit') }).click();
  await expect(page.getByText(s('auth.customerLogin.linkSent'))).toBeVisible();
  await page.goto(await latestConfirmLink(page.request, email, before));
  await page.locator('main form').getByRole('button', { name: s('auth.confirmLink.submit') }).click();
  await expectPath(page, '/profilo/completa');
  const fullName = uniqueName('Cliente');
  await page.getByLabel(s('auth.completeProfile.fullNameLabel')).fill(fullName);
  await page.getByLabel(s('auth.completeProfile.phoneLabel')).fill(`+39 333 ${Math.floor(1_000_000 + Math.random() * 8_999_999)}`);
  await page.getByLabel(s('auth.completeProfile.privacyConsentLabel')).check();
  await page.getByRole('button', { name: s('auth.completeProfile.submit') }).click();
  await expectPath(page, '/');
  return fullName;
};

// ---------------------------------------------------------------------------
// Dati e date
// ---------------------------------------------------------------------------
const today = (): string => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
const isoWeekday = (date: string): number => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const localIso = (date: string, time: string): string => fromZonedTime(`${date}T${time}:00`, TZ).toISOString();

const horizonDays = async (api: AdminApi): Promise<number> => {
  const [row] = await api.get<Array<{ max_horizon_days: number }>>('/rest/v1/shop_settings?select=max_horizon_days');
  const horizon = row?.max_horizon_days ?? 0;
  expect(horizon, 'periodo prenotabile sufficiente per il test').toBeGreaterThanOrEqual(14);
  return horizon;
};

/** Servizio di 30' con `count` barbieri (ordine per nome = ordine di creazione), tutti i giorni nella fascia data. */
const serviceWith = async (
  api: AdminApi,
  data: Created,
  count: number,
  hours: { start: string; end: string },
): Promise<{ serviceId: string; barbers: Barber[] }> => {
  const serviceId = await createService(api, { name: uniqueName('Carica'), durationMin: 30, priceCents: 2000 });
  data.services.push(serviceId);
  const barbers: Barber[] = [];
  for (const label of ['Alfa', 'Beta', 'Delta', 'Gamma'].slice(0, count)) {
    const name = uniqueName(label);
    const id = await createBarber(api, name, [serviceId]);
    data.barbers.push(id);
    await api.post(
      '/rest/v1/working_hours?select=id',
      ALL_WEEK.map((weekday) => ({ barber_id: id, weekday, start_time: hours.start, end_time: hours.end })),
    );
    barbers.push({ id, name });
  }
  return { serviceId, barbers };
};

const whenUrl = (serviceId: string, day?: string): string => `${WHEN_PATH}?servizio=${serviceId}${day ? `&giorno=${day}` : ''}`;
const urlDay = (page: Page): string | null => new URL(page.url()).searchParams.get('giorno');
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const slot = (column: Locator, time: string, barber: string): Locator =>
  column.getByRole('link', { name: sf('booking.when.slotLabel', { time, barber }), exact: true });

// ---------------------------------------------------------------------------
// Richieste di dati della pagina (filtro descritto in testa)
// ---------------------------------------------------------------------------
type Tracked = { method: string; path: string };

const isDataRequest = (request: Request, origin: string): boolean => {
  const url = new URL(request.url());
  if (url.origin !== origin) return false;
  if (url.pathname.startsWith('/_next/') || url.pathname.startsWith('/__nextjs')) return false;
  const headers = request.headers();
  if (headers['next-router-prefetch']) return false;
  if (request.method() === 'POST' && headers['next-action']) return true;
  return request.resourceType() === 'fetch' || request.resourceType() === 'xhr';
};

/** Registra le richieste di dati; `quiet` attende che non ce ne siano in corso né di nuove per `ms`. */
const trackRequests = (page: Page, origin: string) => {
  const started: Tracked[] = [];
  const inFlight = new Set<Request>();
  let lastActivity = Date.now();
  page.on('request', (request) => {
    if (!isDataRequest(request, origin)) return;
    started.push({ method: request.method(), path: new URL(request.url()).pathname });
    inFlight.add(request);
    lastActivity = Date.now();
  });
  const done = (request: Request) => {
    if (inFlight.delete(request)) lastActivity = Date.now();
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return {
    started,
    reset: () => {
      started.length = 0;
    },
    quiet: async (ms = 1000) => {
      await expect
        .poll(() => inFlight.size === 0 && Date.now() - lastActivity >= ms, {
          message: `nessuna richiesta di dati in corso né nuova per ${ms} ms`,
          timeout: 20_000,
        })
        .toBe(true);
    },
  };
};

/** Colonne disegnate senza orari né "Nessun orario" (cioè in caricamento o in errore), e giorni disegnati. */
const columnsState = (page: Page): Promise<{ days: string[]; loading: string[] }> => {
  const slotPattern = `^${escapeRegExp(sf('booking.when.slotLabel', { time: 'TIME', barber: 'BARBER' }))
    .replace('TIME', '\\d{1,2}:\\d{2}')
    .replace('BARBER', '.+')}$`;
  return whenRow(page).evaluate(
    (row, { slotPattern, noSlots }) => {
      const re = new RegExp(slotPattern);
      const sections = [...row.querySelectorAll<HTMLElement>('section[data-day]')];
      const loading = sections
        .filter((section) => {
          const hasSlot = [...section.querySelectorAll('a')].some((a) => re.test(a.getAttribute('aria-label') ?? a.textContent ?? ''));
          return !hasSlot && !(section.textContent ?? '').includes(noSlots);
        })
        .map((section) => `${section.dataset.day}/${section.dataset.barber}`);
      return { days: [...new Set(sections.map((section) => section.dataset.day ?? ''))], loading };
    },
    { slotPattern, noSlots: s('booking.when.columnNoSlots') },
  );
};

/** Simula il passaggio della pagina in secondo piano e il ritorno (document.visibilityState + visibilitychange). */
const setVisibility = (page: Page, state: 'hidden' | 'visible'): Promise<void> =>
  page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  }, state);

// ---------------------------------------------------------------------------
// 1. Nessuna richiesta scorrendo la fila fino all'ultimo giorno
// ---------------------------------------------------------------------------
test('scorrendo la fila fino all\'ultimo giorno: 0 richieste, ogni giorno disegnato, nessuna colonna in caricamento', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    await horizonDays(api);
    const { serviceId, barbers } = await serviceWith(api, data, 4, { start: '06:00', end: '23:00' });
    await signUpCustomer(page, 'scorri-tutto');
    const tracker = trackRequests(page, new URL(baseURL ?? 'http://localhost:3000').origin);

    await page.goto(whenUrl(serviceId));
    // Idratata: il giorno di apertura è stato scritto nell'URL a fila ferma
    await expect.poll(() => urlDay(page), "giorno di apertura nell'URL").not.toBeNull();
    const opening = urlDay(page) ?? '';
    await expectAtEdge(whenColumn(page, barbers[0]?.name ?? '', opening), EDGE, 'prima colonna del giorno di apertura al bordo');
    // Al più una richiesta subito dopo l'idratazione: si aspetta che sia finita
    await tracker.quiet();
    tracker.reset();

    const rowDays = await stripDays(page);
    expect(rowDays.length, 'giorni della fila').toBeGreaterThanOrEqual(14);
    const usable = await whenRow(page).evaluate((el) => {
      const style = getComputedStyle(el);
      return el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    });
    const drawn = new Set<string>();
    const check = async (label: string) => {
      const state = await columnsState(page);
      expect(state.loading, `${label}: colonne senza orari né "${s('booking.when.columnNoSlots')}"`).toEqual([]);
      for (const day of state.days) drawn.add(day);
    };

    await check('apertura');
    for (let step = 1; step <= 2 * rowDays.length + 5; step++) {
      const atEnd = await whenRow(page).evaluate((el) => el.scrollLeft >= el.scrollWidth - el.clientWidth - 1);
      if (atEnd) break;
      await scrollRow(page, { by: usable });
      await check(`passo ${step}, subito`);
      await settle(page);
      await check(`passo ${step}, a fila ferma`);
    }
    expect(await whenRow(page).evaluate((el) => el.scrollLeft >= el.scrollWidth - el.clientWidth - 1), 'fine della fila raggiunta').toBe(true);
    await tracker.quiet();

    expect(rowDays.filter((day) => day >= opening && !drawn.has(day)), 'ogni giorno della fila disegnato lungo il percorso').toEqual([]);
    expect(tracker.started, 'nessuna richiesta di dati scorrendo la fila').toEqual([]);
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 2. Ricarica in background dopo più di 2 minuti in secondo piano
// ---------------------------------------------------------------------------
test('pagina di nuovo visibile: prima dei 2 minuti nessuna richiesta; dopo, una sola GET degli orari, orari visibili durante l\'attesa e aggiornati dopo', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    await horizonDays(api);
    const { serviceId, barbers } = await serviceWith(api, data, 2, { start: '09:00', end: '12:00' });
    const alfa = barbers[0] as Barber;
    const day = plusDays(today(), 2);
    await signUpCustomer(page, 'ricarica');

    // Orologio della pagina controllato dal test (installato prima della navigazione su "Quando?")
    await page.clock.install();
    const tracker = trackRequests(page, new URL(baseURL ?? 'http://localhost:3000').origin);
    await page.goto(whenUrl(serviceId, day));
    await expect.poll(() => urlDay(page)).toBe(day);
    const column = whenColumn(page, alfa.name, day);
    await expectAtEdge(column, EDGE, 'prima colonna del giorno al bordo');
    await expect(slot(column, '9:00', alfa.name)).toBeVisible();
    const added = slot(column, '15:00', alfa.name);
    await expect(added).toHaveCount(0);
    await tracker.quiet();
    tracker.reset();

    // Meno di 2 minuti in secondo piano: nessuna richiesta
    await setVisibility(page, 'hidden');
    await page.clock.fastForward('01:00');
    await setVisibility(page, 'visible');
    await tracker.quiet();
    expect(tracker.started, 'dopo 1 minuto nessuna richiesta').toEqual([]);

    // Più di 2 minuti: una GET a /prenota/quando/orari, la cui risposta il test trattiene
    // (solo la prima è trattenuta: eventuali altre passano e il conteggio finale le vede)
    let held: Route | null = null;
    await page.route(`**${SLOTS_PATH}**`, async (route) => {
      if (held) await route.continue();
      else held = route;
    });
    await setVisibility(page, 'hidden');
    await page.clock.fastForward('03:00');
    await setVisibility(page, 'visible');
    await expect.poll(() => held !== null, { message: `GET ${SLOTS_PATH} partita dopo il ritorno`, timeout: 10_000 }).toBe(true);
    const route = held as unknown as Route;
    expect(route.request().method()).toBe('GET');

    // Durante l'attesa gli orari restano visibili (nessuna colonna torna in caricamento)
    await expect(slot(column, '9:00', alfa.name)).toBeVisible();
    expect((await columnsState(page)).loading, 'nessuna colonna in caricamento durante la ricarica').toEqual([]);

    // Nel frattempo Alfa ha una fascia nuova quel giorno della settimana (15:00–16:00)
    await api.post('/rest/v1/working_hours?select=id', [
      { barber_id: alfa.id, weekday: isoWeekday(day), start_time: '15:00', end_time: '16:00' },
    ]);
    await route.continue();
    await expect(added, "l'orario nuovo compare dopo la risposta").toBeVisible();
    await expect(slot(column, '9:00', alfa.name)).toBeVisible();
    await tracker.quiet();
    expect(tracker.started, 'esattamente una richiesta: la GET degli orari').toEqual([{ method: 'GET', path: SLOTS_PATH }]);
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 3. Route handler degli orari: accesso, validazione, risposta privata con soli orari
// ---------------------------------------------------------------------------
test('GET /prenota/quando/orari: senza sessione niente orari; parametri non validi → 400; risposta privata con soli orari e id dei barbieri', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const horizon = await horizonDays(api);
    const { serviceId, barbers } = await serviceWith(api, data, 2, { start: '09:00', end: '12:00' });
    const alfa = barbers[0] as Barber;
    const [d1, d2, d3] = [plusDays(today(), 1), plusDays(today(), 2), plusDays(today(), 3)];
    // Prenotazione di un ospite su Alfa alle 9:00 di d1: non deve uscire nulla di lei
    const bookedAt = localIso(d1, '09:00');
    const bookingId = await createBooking(api, { barberId: alfa.id, serviceId, startsAt: bookedAt });
    data.bookings.push(bookingId);
    const url = (query: string): string => `${SLOTS_PATH}?${query}`;
    const valid = `servizio=${serviceId}&da=${d1}&a=${d3}`;

    // Senza sessione (contesto API senza cookie): redirect al login o 401, mai orari
    const anonymous = await request.get(url(valid), { maxRedirects: 0 });
    const location = anonymous.headers()['location'] ?? '';
    expect(
      anonymous.status() === 401 || (anonymous.status() >= 300 && anonymous.status() < 400 && location.includes('/accedi')),
      `senza sessione: 401 o redirect al login (ricevuto ${anonymous.status()} ${location})`,
    ).toBe(true);
    const anonymousBody = await anonymous.text();
    expect(anonymousBody).not.toContain('slots');
    expect(anonymousBody).not.toContain(alfa.id);

    await signUpCustomer(page, 'orari-route');

    // Parametri non validi → 400
    for (const query of [
      `servizio=${serviceId}&da=${d1}`,
      `servizio=abc&da=${d1}&a=${d3}`,
      `servizio=${serviceId}&da=2027-02-30&a=${d3}`,
      `servizio=${serviceId}&da=${d3}&a=${d1}`,
      `servizio=${serviceId}&da=${plusDays(today(), -1)}&a=${d1}`,
      `servizio=${serviceId}&da=${d1}&a=${plusDays(today(), horizon + 1)}`,
    ]) {
      const response = await page.request.get(url(query), { maxRedirects: 0 });
      expect(response.status(), query).toBe(400);
      expect(await response.text(), query).not.toContain('slots');
    }

    // Risposta valida
    const response = await page.request.get(url(valid), { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['content-type'] ?? '').toContain('application/json');
    expect(headers['cache-control'] ?? '', 'Cache-Control').toContain('private');
    expect(headers['cache-control'] ?? '', 'Cache-Control').toContain('no-store');
    const text = await response.text();
    const body = JSON.parse(text) as { days: Array<{ date: string; barbers: Array<{ barberId: string; slots: string[]; next: string | null }> }> };
    expect(Object.keys(body)).toEqual(['days']);
    expect(body.days.map((d) => d.date), 'i giorni non chiusi in [da, a]').toEqual([d1, d2, d3]);
    for (const day of body.days) {
      expect(Object.keys(day).sort()).toEqual(['barbers', 'date']);
      expect(day.barbers.map((b) => b.barberId).sort()).toEqual(barbers.map((b) => b.id).sort());
      for (const entry of day.barbers) expect(Object.keys(entry).sort()).toEqual(['barberId', 'next', 'slots']);
    }
    const alfaD1 = body.days[0]?.barbers.find((b) => b.barberId === alfa.id);
    expect(alfaD1?.slots.length, 'Alfa ha altri orari il primo giorno').toBeGreaterThan(0);
    expect(alfaD1?.slots.map((iso) => new Date(iso).getTime()), "l'orario prenotato non è libero").not.toContain(new Date(bookedAt).getTime());
    for (const secret of [bookingId, 'E2E Ospite', '+393330000000', 'guest', 'confirmed', 'manual', 'customer', 'status']) {
      expect(text, `nessun dato di prenotazioni o clienti: ${secret}`).not.toContain(secret);
    }
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 4. Annuncio per lo screen reader dopo un tocco sulla striscia
// ---------------------------------------------------------------------------
test('aria-live dopo un tocco sulla striscia: giorno "senza posti" → "{day}, nessun orario libero"; giorno con orari → "Orari di {day}"', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    await horizonDays(api);
    // Un solo orario al giorno per barbiere (9:00): prenotandoli entrambi il giorno è "senza posti"
    const { serviceId, barbers } = await serviceWith(api, data, 2, { start: '09:00', end: '09:30' });
    const start = plusDays(today(), 1);
    const full = plusDays(today(), 3);
    const open = plusDays(today(), 4);
    for (const barber of barbers) {
      data.bookings.push(await createBooking(api, { barberId: barber.id, serviceId, startsAt: localIso(full, '09:00') }));
    }
    await signUpCustomer(page, 'annuncio');
    await page.goto(whenUrl(serviceId, start));
    await expect.poll(() => urlDay(page)).toBe(start);
    await expectAtEdge(whenColumn(page, barbers[0]?.name ?? '', start), EDGE, 'prima colonna del giorno al bordo');
    await settle(page);
    const live = page.locator('main [aria-live="polite"]');

    await daysStrip(page).locator(`a[data-day="${full}"]`).click();
    await expectAtEdge(whenColumn(page, barbers[0]?.name ?? '', full), EDGE, 'giorno senza posti al bordo');
    await expect(live).toHaveText(sf('booking.when.dayAnnounceEmpty', { day: dayLabel(full) }));

    await daysStrip(page).locator(`a[data-day="${open}"]`).click();
    await expectAtEdge(whenColumn(page, barbers[0]?.name ?? '', open), EDGE, 'giorno con orari al bordo');
    await expect(live).toHaveText(sf('booking.when.dayAnnounce', { day: dayLabel(open) }));
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 5. Nuovo tentativo su un giorno: stessa GET, stessi controlli (audit punto 6)
// ---------------------------------------------------------------------------
test('nuovo tentativo su un giorno senza orari in pagina: cliente attivo li riceve dalla GET, cliente bloccato riceve 403 e nessun orario', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    await horizonDays(api);
    const { serviceId, barbers } = await serviceWith(api, data, 2, { start: '09:00', end: '12:00' });
    const alfa = barbers[0] as Barber;
    const active = plusDays(today(), 12);
    const blocked = plusDays(today(), 13);
    const fullName = await signUpCustomer(page, 'riprova');

    // Due giorni lontani (non disegnati all'apertura) arrivano senza orari: solo così parte il nuovo tentativo.
    // Si tocca il payload di React nel browser: una pagina servita da route.fulfill non si idrata (Chromium
    // blocca le richieste verso localhost) e l'HTML dei giorni non disegnati non contiene orari.
    await page.addInitScript((days) => {
      type Chunk = [number, string?];
      const flight: Chunk[] = [];
      (window as unknown as { __next_f: Chunk[] }).__next_f = flight;
      let push = Array.prototype.push.bind(flight) as (chunk: Chunk) => number;
      Object.defineProperty(flight, 'push', {
        get: () => (chunk: Chunk) => {
          for (const day of days) chunk[1] = chunk[1]?.replaceAll(`"date":"${day}","barbers"`, `"date":"tolto-${day}","barbers"`);
          return push(chunk);
        },
        set: (next: (chunk: Chunk) => number) => {
          push = next;
        },
      });
    }, [active, blocked]);
    await page.goto(whenUrl(serviceId));
    // Idratata: il giorno di apertura è stato scritto nell'URL a fila ferma. Prima un tocco ricaricherebbe la pagina
    await expect.poll(() => urlDay(page), "giorno di apertura nell'URL").not.toBeNull();
    await settle(page);

    const retried = (day: string) =>
      page.waitForResponse((response) => response.url().includes(SLOTS_PATH) && response.url().includes(`da=${day}&a=${day}`));

    // Cliente attivo: gli orari arrivano
    let retry = retried(active);
    await daysStrip(page).locator(`a[data-day="${active}"]`).click();
    expect((await retry).status()).toBe(200);
    await expect(slot(whenColumn(page, alfa.name, active), '9:00', alfa.name)).toBeVisible();

    // L'admin blocca il cliente a pagina aperta: il nuovo tentativo non riceve orari
    const [profile] = await api.get<Array<{ id: string }>>(
      `/rest/v1/profiles?select=id&full_name=eq.${encodeURIComponent(fullName)}`,
    );
    expect(profile, 'profilo del cliente').toBeDefined();
    await api.patch(`/rest/v1/profiles?id=eq.${profile?.id}`, { is_blocked: true });

    retry = retried(blocked);
    await daysStrip(page).locator(`a[data-day="${blocked}"]`).click();
    const response = await retry;
    expect(response.status()).toBe(403);
    // Il corpo si legge da una seconda richiesta: quello della risposta del browser non arriva mai a Playwright
    const replay = await page.request.get(response.url());
    expect(replay.status()).toBe(403);
    expect(await replay.json()).toEqual({ error: 'blocked' });
    const column = whenColumn(page, alfa.name, blocked);
    await expect(column.getByText(s('booking.when.dayError'))).toBeVisible();
    await expect(slot(column, '9:00', alfa.name)).toHaveCount(0);
  } finally {
    await cleanup(api, data);
  }
});
