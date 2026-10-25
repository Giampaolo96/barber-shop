// Test di accettazione e2e – FETTA 8f ("Quando?": fila continua di giorni; comportamento approvato
// modificato in fetta 8f con l'approvazione dell'utente (2026-10-25): replaceState di Next (__NA) esclusi dal conteggio; avanzi di giri interrotti rimossi in beforeAll.
// dall'utente il 2026-10-25). SPEC §5.2 (striscia dei giorni, colonne per barbiere, scorrimento).
// A 390×844 (riferimento telefono), l'ultimo test anche a 1280×800.
//
// Contratto (dettagli in ./when-row-helpers.ts):
//   - la fila (regione it.booking.when.rowLabel, data-when-columns) è UNA fila orizzontale: per ogni
//     giorno non chiuso le colonne dei barbieri nell'ordine, poi quelle del giorno dopo; i giorni chiusi
//     non ci sono. Scroll-snap x non mandatory, snap-align start sulle colonne, scroll-padding-left 16 px:
//     a fila agganciata la colonna più a sinistra parte a x = 16;
//   - giorno selezionato (aria-current nella striscia) = giorno della colonna più a sinistra visibile,
//     esclusi i 16 px di margine; la striscia lo segue durante lo scorrimento, URL (replaceState) solo a
//     scorrimento fermo;
//   - tocco su un giorno della striscia, "Indietro", ?giorno=: prima colonna del giorno al bordo, colonne
//     del giorno in cima; limiti a sinistra (scrollLeft 0) e a destra;
//   - desktop (≥ 1024 px): pulsanti it.booking.when.prevDay / nextDay fuori dalla fila, frecce ←/→ con il
//     focus nella fila.
//   - ?giorno= non valido, fuori periodo, passato o chiuso: si apre sul primo giorno con orari (come
//     initialDay di src/lib/booking/when.ts), senza mostrare il valore grezzo.
// Dati: ogni test crea il suo servizio e i suoi barbieri (orari solo per loro: mar–sab 06:00–23:00, molti
// orari per colonna; domenica e lunedì chiusi) e li rimuove alla fine; shop_settings è solo letto
// (max_horizon_days ≥ 14 richiesto, mai modificato). Nessun dato condiviso: il file gira in parallelo.
// Le date si scelgono da domani in poi (oggi può essere già chiuso a fine giornata).
// Clienti nuovi con email univoche.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { formatInTimeZone } from 'date-fns-tz';

import {
  DESKTOP,
  adminApi,
  cleanup,
  createBarber,
  createService,
  expectPath,
  plusDays,
  s,
  uniqueEmail,
  uniqueName,
  type AdminApi,
} from './admin-helpers';
import { confirmHref, newestEmailId, waitForNewEmail } from './mailpit';
import {
  columnScroller,
  dayColumns,
  dayPartsOf,
  daysStrip,
  expectAtEdge,
  leftOf,
  rowScrollLeft,
  scrollColumnTo,
  scrollRow,
  selectedDate,
  settle,
  stripDays,
  whenColumn,
  whenRow,
} from './when-row-helpers';

test.use({ viewport: { width: 390, height: 844 } });

const TZ = 'Europe/Rome';
const WHEN_PATH = '/prenota/quando';
/** Martedì–sabato (working_hours.weekday ISO): domenica e lunedì chiusi. */
const TUE_SAT = [2, 3, 4, 5, 6];
const EDGE = 16;

type Created = { services: string[]; barbers: string[]; bookings: string[] };
type Barber = { id: string; name: string };

// ---------------------------------------------------------------------------
// Login del cliente (magic link via Mailpit), come in booking-when-columns.spec.ts
// ---------------------------------------------------------------------------
const latestConfirmLink = async (request: APIRequestContext, to: string, previousId: string | null): Promise<string> => {
  const href = confirmHref(await waitForNewEmail(request, to, previousId));
  expect(href, "link /auth/confirm nell'email").toBeDefined();
  const url = new URL(href ?? 'http://invalid.invalid');
  return `${url.pathname}${url.search}`;
};

/** Cliente nuovo con profilo completo, già loggato in `page`. */
const signUpCustomer = async (page: Page, label: string): Promise<void> => {
  const email = uniqueEmail(label);
  await page.goto('/accedi');
  const before = await newestEmailId(page.request, email);
  await page.getByLabel(s('auth.customerLogin.emailLabel')).fill(email);
  await page.getByRole('button', { name: s('auth.customerLogin.submit') }).click();
  await expect(page.getByText(s('auth.customerLogin.linkSent'))).toBeVisible();
  await page.goto(await latestConfirmLink(page.request, email, before));
  await page.locator('main form').getByRole('button', { name: s('auth.confirmLink.submit') }).click();
  await expectPath(page, '/profilo/completa');
  await page.getByLabel(s('auth.completeProfile.fullNameLabel')).fill(uniqueName('Cliente'));
  await page.getByLabel(s('auth.completeProfile.phoneLabel')).fill(`+39 333 ${Math.floor(1_000_000 + Math.random() * 8_999_999)}`);
  await page.getByLabel(s('auth.completeProfile.privacyConsentLabel')).check();
  await page.getByRole('button', { name: s('auth.completeProfile.submit') }).click();
  await expectPath(page, '/');
};

// ---------------------------------------------------------------------------
// Dati di prova e date
// ---------------------------------------------------------------------------
const today = (): string => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
/** Giorno della settimana ISO (1 = lunedì … 7 = domenica), come working_hours.weekday. */
const isoWeekday = (date: string): number => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

const horizonDays = async (api: AdminApi): Promise<number> => {
  const [row] = await api.get<Array<{ max_horizon_days: number }>>('/rest/v1/shop_settings?select=max_horizon_days');
  const horizon = row?.max_horizon_days ?? 0;
  expect(horizon, 'periodo prenotabile sufficiente per il test').toBeGreaterThanOrEqual(14);
  return horizon;
};

/** Servizio di 30' con `count` barbieri (ordine per nome = ordine di creazione) che lavorano mar–sab. */
const rowService = async (
  api: AdminApi,
  data: Created,
  count = 4,
): Promise<{ serviceId: string; barbers: Barber[]; days: string[] }> => {
  const horizon = await horizonDays(api);
  const serviceId = await createService(api, { name: uniqueName('Fila'), durationMin: 30, priceCents: 2000 });
  data.services.push(serviceId);
  const barbers: Barber[] = [];
  for (const label of ['Alfa', 'Beta', 'Delta', 'Gamma'].slice(0, count)) {
    const name = uniqueName(label);
    const id = await createBarber(api, name, [serviceId]);
    data.barbers.push(id);
    await api.post(
      '/rest/v1/working_hours?select=id',
      TUE_SAT.map((weekday) => ({ barber_id: id, weekday, start_time: '06:00', end_time: '23:00' })),
    );
    barbers.push({ id, name });
  }
  // Giorni della fila da domani alla fine del periodo: solo martedì–sabato
  const days = Array.from({ length: horizon }, (_, i) => plusDays(today(), i + 1)).filter((d) => TUE_SAT.includes(isoWeekday(d)));
  return { serviceId, barbers, days };
};

/**
 * Avanzi di giri interrotti (pulizia saltata per un timeout): servizi "E2E Fila …" più vecchi di 10
 * minuti, con i loro barbieri e prenotazioni. Il tag di uniqueName comincia con Date.now() in base 36:
 * i dati dei test in corso negli altri worker sono più recenti e restano.
 */
test.beforeAll(async ({ request }) => {
  const api = await adminApi(request);
  const prefix = uniqueName('Fila').replace(/[^ ]+$/, '');
  const services = await api.get<Array<{ id: string; name: string }>>(
    `/rest/v1/services?select=id,name&name=like.${encodeURIComponent(`${prefix}*`)}`,
  );
  const stale = services.filter((s) => {
    const createdAt = parseInt((s.name.slice(prefix.length).match(/^[0-9a-z]{8}/) ?? ['0'])[0], 36);
    return Date.now() - createdAt > 10 * 60_000;
  });
  if (stale.length === 0) return;
  const links = await api.get<Array<{ barber_id: string }>>(
    `/rest/v1/barber_services?select=barber_id&service_id=in.(${stale.map((s) => s.id).join(',')})`,
  );
  await cleanup(api, { barbers: [...new Set(links.map((l) => l.barber_id))], services: stale.map((s) => s.id) });
});

const whenUrl = (serviceId: string, day: string, preferredId?: string): string =>
  `${WHEN_PATH}?servizio=${serviceId}&giorno=${day}${preferredId ? `&barbiere=${preferredId}` : ''}`;

const urlDay = (page: Page): string | null => new URL(page.url()).searchParams.get('giorno');

/** Apre "Quando?" sul giorno e attende la sua prima colonna al bordo (x = 16). */
const openOn = async (page: Page, url: string, firstColumn: Locator): Promise<void> => {
  await page.goto(url);
  await expectAtEdge(firstColumn, EDGE, "all'apertura la prima colonna del giorno è al bordo");
};

/** I giorni attesi della fila sono quelli della striscia, senza altri giorni in mezzo. */
const expectAdjacentInStrip = async (page: Page, from: string, to: string): Promise<void> => {
  const strip = await stripDays(page);
  expect(strip, 'giorni selezionabili della striscia').toEqual(expect.arrayContaining([from, to]));
  expect(strip.filter((d) => d > from && d < to), `nessun giorno della fila fra ${from} e ${to}`).toEqual([]);
};

// ---------------------------------------------------------------------------
// 1. Testata delle colonne: data del giorno, altezza uguale, orari alti
// ---------------------------------------------------------------------------
test('testata di ogni colonna: data del giorno sopra ritratto e nome, testate alte uguali, primo orario sotto i 400 px', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const { serviceId, barbers, days } = await rowService(api, data);
    const [day = '', next = ''] = days;
    // Preferito dall'URL: la sua colonna è la prima, con "Il tuo" sul ritratto
    const preferred = barbers[1] as Barber;
    await signUpCustomer(page, 'testata');
    await openOn(page, whenUrl(serviceId, day, preferred.id), whenColumn(page, preferred.name, day));
    await expectAdjacentInStrip(page, day, next);

    for (const date of [day, next]) {
      const { weekday, day: number } = dayPartsOf(date);
      const tops: number[] = [];
      const headingBottoms: number[] = [];
      for (const barber of barbers) {
        const column = whenColumn(page, barber.name, date);
        await expect(column, `colonna di ${barber.name} il ${date}`).toHaveCount(1);
        // La data piccola (es. "mer 21") sta in testata, prima del nome
        const before = await column.evaluate((section) => {
          const heading = section.querySelector('h2');
          if (!heading) return null;
          const range = document.createRange();
          range.setStart(section, 0);
          range.setEndBefore(heading);
          return range.toString().replace(/\s+/g, ' ').trim();
        });
        expect(before, `testata di ${barber.name} il ${date}`).toMatch(new RegExp(`(^|\\s)${weekday}\\s*${number}(\\s|$)`));
        // L'h2 resta il solo nome (più ", Il tuo barbiere" sul preferito)
        if (barber.id !== preferred.id) {
          await expect(column.getByRole('heading', { level: 2 })).toHaveAccessibleName(barber.name);
        }
        headingBottoms.push(await column.getByRole('heading', { level: 2 }).evaluate((h) => h.getBoundingClientRect().bottom));
        tops.push(await column.getByRole('link').first().evaluate((slot) => slot.getBoundingClientRect().top));
      }
      for (const value of headingBottoms) {
        expect(Math.abs(value - (headingBottoms[0] ?? 0)), `testate alte uguali il ${date}`).toBeLessThanOrEqual(1);
      }
      for (const value of tops) {
        expect(Math.abs(value - (tops[0] ?? 0)), `primi orari allineati il ${date}`).toBeLessThanOrEqual(1);
        expect(value, `primo orario sotto i 400 px dall'alto il ${date}`).toBeLessThan(400);
      }
    }
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 2. Giorno selezionato = giorno della colonna più a sinistra visibile (margine di 16 px escluso)
// ---------------------------------------------------------------------------
test('giorno selezionato: resta finché si vede una colonna del giorno prima, cambia quando esce l\'ultima, torna indietro appena rientra', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const { serviceId, barbers, days } = await rowService(api, data);
    const [day = '', next = ''] = days;
    await signUpCustomer(page, 'selezionato');
    await openOn(page, whenUrl(serviceId, day), whenColumn(page, barbers[0]?.name ?? '', day));
    await expectAdjacentInStrip(page, day, next);
    await expect.poll(() => urlDay(page)).toBe(day);

    // Scorrimenti al pixel: lo snap (proximity) riaggancerebbe la fila alla colonna vicina, quindi in
    // questo test si spegne. Il calcolo del giorno non dipende dallo snap.
    await whenRow(page).evaluate((el) => {
      el.style.scrollSnapType = 'none';
    });
    const lastOfDay = whenColumn(page, barbers.at(-1)?.name ?? '', day);
    const rightOf = (column: Locator) => column.evaluate((el) => el.getBoundingClientRect().right);

    // Dell'ultima colonna del giorno restano visibili 2–3 px oltre il margine: il giorno non cambia
    await scrollRow(page, { by: Math.floor((await rightOf(lastOfDay)) - EDGE - 2) });
    const visible = (await rightOf(lastOfDay)) - EDGE;
    expect(visible, 'pochi px dell\'ultima colonna ancora visibili').toBeGreaterThan(0);
    expect(visible).toBeLessThanOrEqual(3);
    await settle(page);
    expect(await selectedDate(page), 'una colonna del giorno è ancora visibile').toBe(day);
    expect(urlDay(page)).toBe(day);

    // Esce anche l'ultima colonna: il giorno selezionato diventa il successivo
    await scrollRow(page, { by: 4 });
    expect((await rightOf(lastOfDay)) - EDGE, "l'ultima colonna è uscita").toBeLessThanOrEqual(0);
    await expect.poll(() => selectedDate(page), 'giorno dopo selezionato').toBe(next);
    await expect.poll(() => urlDay(page), "giorno dopo nell'URL a scorrimento fermo").toBe(next);

    // Tornando indietro di poco la colonna rientra: di nuovo il giorno prima
    await scrollRow(page, { by: -4 });
    expect((await rightOf(lastOfDay)) - EDGE, "l'ultima colonna è rientrata").toBeGreaterThan(0);
    await expect.poll(() => selectedDate(page), 'di nuovo il giorno prima').toBe(day);
    await expect.poll(() => urlDay(page)).toBe(day);
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 3. Giorni chiusi assenti dalla fila; limite a sinistra
// ---------------------------------------------------------------------------
test('dal sabato si passa al martedì (domenica e lunedì chiusi non sono nella fila); dalla prima colonna non si va più a sinistra', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const { serviceId, barbers, days } = await rowService(api, data);
    const saturday = days.find((d) => isoWeekday(d) === 6 && days.includes(plusDays(d, 3))) ?? '';
    expect(saturday, 'un sabato con il martedì dopo nel periodo').not.toBe('');
    const tuesday = plusDays(saturday, 3);
    await signUpCustomer(page, 'chiusi');
    await openOn(page, whenUrl(serviceId, saturday), whenColumn(page, barbers[0]?.name ?? '', saturday));
    await expectAdjacentInStrip(page, saturday, tuesday);

    // Dopo l'ultima colonna del sabato vengono le colonne del martedì
    const order = await whenRow(page).evaluate((row) =>
      [...row.querySelectorAll<HTMLElement>('section[data-day]')]
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
        .map((section) => section.dataset.day ?? ''),
    );
    const lastSaturday = order.lastIndexOf(saturday);
    expect(lastSaturday, 'colonne del sabato nella fila').toBeGreaterThanOrEqual(0);
    expect(order.slice(lastSaturday + 1, lastSaturday + 1 + barbers.length), 'dopo il sabato, il martedì').toEqual(
      barbers.map(() => tuesday),
    );
    // Né colonne né segnaposto per domenica e lunedì
    await expect(whenRow(page).locator(`[data-day="${plusDays(saturday, 1)}"], [data-day="${plusDays(saturday, 2)}"]`)).toHaveCount(0);

    // Scorrendo la fila fino al martedì il giorno selezionato è martedì
    const firstTuesday = whenColumn(page, barbers[0]?.name ?? '', tuesday);
    await scrollRow(page, { by: (await leftOf(firstTuesday)) - EDGE });
    await expectAtEdge(firstTuesday, EDGE, 'prima colonna del martedì al bordo');
    await expect.poll(() => selectedDate(page)).toBe(tuesday);

    // Limite a sinistra: la prima colonna del primo giorno della fila, non oltre
    const first = (await stripDays(page))[0] ?? '';
    await scrollRow(page, { left: 0 });
    const firstColumn = whenColumn(page, barbers[0]?.name ?? '', first);
    await expectAtEdge(firstColumn, EDGE, 'prima colonna del primo giorno al bordo');
    await scrollRow(page, { by: -300 });
    await page.mouse.move(195, 600);
    await page.mouse.wheel(-400, 0);
    await settle(page);
    expect(await rowScrollLeft(page), 'la fila non va oltre la prima colonna').toBe(0);
    await expectAtEdge(firstColumn, EDGE, 'la prima colonna resta al bordo');
    await expect.poll(() => selectedDate(page)).toBe(first);
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 4. Tocco sulla striscia: prima colonna del giorno al bordo, colonne in cima
// ---------------------------------------------------------------------------
test('tocco su un giorno della striscia: la sua prima colonna va al bordo (x = 16), giorno selezionato e URL aggiornati, colonne in cima', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const { serviceId, barbers, days } = await rowService(api, data);
    const [day = '', next = ''] = days;
    const far = days[6] ?? '';
    expect(far > next, 'un giorno lontano nella fila').toBe(true);
    await signUpCustomer(page, 'striscia');
    await openOn(page, whenUrl(serviceId, day), whenColumn(page, barbers[0]?.name ?? '', day));
    await expectAdjacentInStrip(page, day, next);

    // Le colonne del giorno dopo (già disegnate, vicine) scorse verso il basso
    for (const barber of barbers) {
      const column = whenColumn(page, barber.name, next);
      await expect(column.getByRole('link').first()).toBeAttached();
      await scrollColumnTo(column, 400);
      await expect.poll(async () => (await columnScroller(column))?.scrollTop ?? 0, `${barber.name} scorsa`).toBeGreaterThan(0);
    }

    for (const target of [next, far]) {
      await daysStrip(page).locator(`a[data-day="${target}"]`).click();
      await expect(daysStrip(page).locator(`a[data-day="${target}"]`)).toHaveAttribute('aria-current', 'date');
      await expectAtEdge(whenColumn(page, barbers[0]?.name ?? '', target), EDGE, `prima colonna del ${target} al bordo`);
      await expect.poll(() => urlDay(page), "giorno nell'URL").toBe(target);
      for (const barber of barbers) {
        const column = whenColumn(page, barber.name, target);
        await expect(column.getByRole('link').first()).toBeVisible();
        await expect.poll(async () => (await columnScroller(column))?.scrollTop, `${barber.name} in cima il ${target}`).toBe(0);
      }
    }
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 5. Scorrimento verticale di una colonna
// ---------------------------------------------------------------------------
test('scorrere una colonna in verticale non cambia giorno, URL né posizione della fila', async ({ page, request }) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const { serviceId, barbers, days } = await rowService(api, data);
    const [day = ''] = days;
    await signUpCustomer(page, 'verticale');
    const firstColumn = whenColumn(page, barbers[0]?.name ?? '', day);
    await openOn(page, whenUrl(serviceId, day), firstColumn);
    await settle(page);
    await expect.poll(() => urlDay(page)).toBe(day);
    const scrollLeft = await rowScrollLeft(page);

    const target = whenColumn(page, barbers[1]?.name ?? '', day);
    const box = await target.boundingBox();
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) - 100);
    await page.mouse.wheel(0, 600);
    await expect.poll(async () => (await columnScroller(target))?.scrollTop ?? 0, 'la colonna scorre').toBeGreaterThan(0);
    await settle(page);

    expect(await selectedDate(page), 'giorno selezionato invariato').toBe(day);
    expect(urlDay(page), 'URL invariato').toBe(day);
    expect(await rowScrollLeft(page), 'la fila non si sposta').toBe(scrollLeft);
    await expectAtEdge(firstColumn, EDGE, 'prima colonna ancora al bordo');
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 6. Orario di un giorno successivo raggiunto scorrendo la fila; "Indietro"
// ---------------------------------------------------------------------------
test('orario di un giorno raggiunto scorrendo la fila → riepilogo con quel giorno e quel barbiere; "Indietro" riporta lì, prima colonna al bordo', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const { serviceId, barbers, days } = await rowService(api, data);
    const [day = '', next = ''] = days;
    const chosen = barbers[1] as Barber;
    await signUpCustomer(page, 'scorri');
    await openOn(page, whenUrl(serviceId, day), whenColumn(page, barbers[0]?.name ?? '', day));
    await expectAdjacentInStrip(page, day, next);

    // Scorrendo la fila (non con la striscia) si arriva al giorno dopo
    const firstNext = whenColumn(page, barbers[0]?.name ?? '', next);
    await scrollRow(page, { by: (await leftOf(firstNext)) - EDGE });
    await expectAtEdge(firstNext, EDGE, 'prima colonna del giorno dopo al bordo');
    await expect.poll(() => selectedDate(page)).toBe(next);
    await expect.poll(() => urlDay(page)).toBe(next);

    const slot = whenColumn(page, chosen.name, next).getByRole('link', { name: new RegExp(`^\\d{1,2}:\\d{2} con ${chosen.name}$`) }).nth(1);
    await expect(slot).toBeVisible();
    const time = ((await slot.getAttribute('aria-label')) ?? (await slot.innerText())).split(' ')[0] ?? '';
    await slot.click();
    await expectPath(page, '/prenota/riepilogo');
    const params = new URL(page.url()).searchParams;
    expect(params.get('barbiere')).toBe(chosen.id);
    expect(formatInTimeZone(new Date(params.get('inizio') ?? ''), TZ, 'yyyy-MM-dd'), 'giorno dell\'orario').toBe(next);
    expect(formatInTimeZone(new Date(params.get('inizio') ?? ''), TZ, 'H:mm')).toBe(time);
    await expect(page.locator('main')).toContainText(chosen.name);

    await page.locator('main').getByRole('link', { name: s('booking.back'), exact: true }).click();
    await expectPath(page, WHEN_PATH);
    await expect.poll(() => selectedDate(page)).toBe(next);
    await expect.poll(() => urlDay(page)).toBe(next);
    await expectAtEdge(whenColumn(page, barbers[0]?.name ?? '', next), EDGE, 'dopo "Indietro" prima colonna del giorno al bordo');
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 7. Scorrimento rapido su più giorni: la striscia segue, l'URL cambia una volta sola
// ---------------------------------------------------------------------------
test('scorrimento rapido su più giorni: la striscia segue, replaceState una sola volta (giorno di arrivo), casella selezionata visibile nella striscia', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const { serviceId, barbers, days } = await rowService(api, data);
    const [day = '', next = ''] = days;
    await signUpCustomer(page, 'rapido');
    await openOn(page, whenUrl(serviceId, day), whenColumn(page, barbers[0]?.name ?? '', day));
    await expectAdjacentInStrip(page, day, next);
    await settle(page);
    await expect.poll(() => urlDay(page)).toBe(day);

    const strip = await stripDays(page);
    const arrival = strip[strip.indexOf(day) + 3] ?? '';
    expect(arrival > next, 'giorno di arrivo tre giorni della fila dopo').toBe(true);
    const intermediate = strip.filter((d) => d > day && d < arrival);
    // Distanza fra le prime colonne di due giorni consecutivi della fila: tre giorni = tre passi
    const stride = (await leftOf(whenColumn(page, barbers[0]?.name ?? '', next))) - EDGE;

    // Sequenza dei giorni selezionati nella striscia (MutationObserver su aria-current), contatore di
    // replaceState azzerato subito prima dello scorrimento, poi un solo scrollBy morbido di tre giorni.
    const start = await whenRow(page).evaluate(
      (row, by) =>
        new Promise<{ before: number; target: number; afterOneFrame: number }>((done) => {
          const w = window as unknown as { __replaceStateCalls: number; __selectedDays: string[] };
          w.__selectedDays = [];
          const nav = document.querySelector('nav a[data-day]')?.closest('nav');
          new MutationObserver((records) => {
            for (const record of records) {
              const el = record.target as HTMLElement;
              if (el.getAttribute('aria-current') === 'date') w.__selectedDays.push(el.dataset.day ?? '');
            }
          }).observe(nav ?? document.body, { attributes: true, attributeFilter: ['aria-current'], subtree: true });
          // Contatore delle chiamate a history.replaceState, installato dopo l'idratazione: avvolge anche
          // la versione di Next, quindi conta le chiamate della pagina e non quelle interne del router
          // (che usano il riferimento originale salvato all'avvio). Azzerato subito prima dello scorrimento.
          const replaceState = history.replaceState;
          w.__replaceStateCalls = 0;
          history.replaceState = function (this: History, ...args: Parameters<History['replaceState']>) {
            // Solo le chiamate della pagina: Next, dopo ognuna, ne fa una sua con lo stato interno __NA
            // per allineare il router (modificato in fetta 8f con l'approvazione dell'utente, 2026-10-25).
            const data = args[0] as { __NA?: boolean } | null;
            if (!data?.__NA) w.__replaceStateCalls += 1;
            return replaceState.apply(this, args);
          };
          const before = row.scrollLeft;
          const target = Math.min(before + by, row.scrollWidth - row.clientWidth);
          row.scrollBy({ left: by, behavior: 'smooth' });
          requestAnimationFrame(() => done({ before, target, afterOneFrame: row.scrollLeft }));
        }),
      3 * stride,
    );
    expect(
      Math.abs(start.afterOneFrame - start.target),
      'Chrome senza finestra non anima lo scorrimento morbido: scrollLeft già a destinazione nel frame successivo alla chiamata',
    ).toBeGreaterThan(1);

    // A fila ferma: giorno di arrivo selezionato e nell'URL, una sola chiamata a replaceState
    await expect.poll(() => selectedDate(page), 'giorno di arrivo selezionato').toBe(arrival);
    await expect.poll(() => urlDay(page), "giorno di arrivo nell'URL").toBe(arrival);
    await settle(page);
    expect(await page.evaluate(() => (window as unknown as { __replaceStateCalls: number }).__replaceStateCalls), 'replaceState chiamato una volta sola').toBe(1);
    expect(urlDay(page)).toBe(arrival);

    // La striscia ha seguito lo scorrimento: almeno un giorno intermedio, l'ultimo è quello di arrivo
    const selected = await page.evaluate(() => (window as unknown as { __selectedDays: string[] }).__selectedDays);
    expect(selected.some((d) => intermediate.includes(d)), `giorni intermedi attraversati (${selected.join(', ')})`).toBe(true);
    expect(selected.at(-1), 'ultimo giorno selezionato').toBe(arrival);

    // La casella selezionata è visibile dentro la striscia; la pagina non si è spostata, focus non rubato
    const inside = await daysStrip(page).evaluate((nav) => {
      const current = nav.querySelector<HTMLElement>('a[aria-current="date"]');
      const list = current?.closest('ul');
      if (!current || !list) return null;
      const a = current.getBoundingClientRect();
      const b = list.getBoundingClientRect();
      return a.left >= b.left - 1 && a.right <= b.right + 1;
    });
    expect(inside, 'casella selezionata dentro la striscia').toBe(true);
    expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })), 'la pagina non scorre').toEqual({ x: 0, y: 0 });
    expect(await page.evaluate(() => document.activeElement?.closest('nav') == null), 'focus non spostato nella striscia').toBe(true);
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 8. Nessun overflow a 390 px; desktop: pulsanti e frecce
// ---------------------------------------------------------------------------
test('390 px: nessun overflow, fila con snap non obbligato; 1280 px: "Giorno precedente"/"Giorno successivo" e frecce portano la prima colonna del giorno al bordo', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const { serviceId, barbers } = await rowService(api, data);
    await signUpCustomer(page, 'desktop');
    const prev = page.getByRole('button', { name: s('booking.when.prevDay'), exact: true });
    const nextButton = page.getByRole('button', { name: s('booking.when.nextDay'), exact: true });

    // --- 390 px ---
    await page.goto(`${WHEN_PATH}?servizio=${serviceId}`);
    const strip = await stripDays(page);
    const [first = '', second = '', third = ''] = strip;
    await expectAtEdge(whenColumn(page, barbers[0]?.name ?? '', await selectedDate(page)), EDGE, 'prima colonna del giorno al bordo');
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll, 'nessun overflow orizzontale della pagina').toBeLessThanOrEqual(overflow.client);
    const row = whenRow(page);
    const rowStyle = await row.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        overflowX: style.overflowX,
        snapType: style.scrollSnapType,
        paddingLeft: style.scrollPaddingLeft,
        initialDay: el.getAttribute('data-initial-day'),
        columns: [...el.querySelectorAll<HTMLElement>('section[data-day]')].map((section) => ({
          align: getComputedStyle(section).scrollSnapAlign,
          stop: getComputedStyle(section).scrollSnapStop,
        })),
      };
    });
    expect(rowStyle.overflowX).toBe('auto');
    expect(rowStyle.snapType, 'scroll-snap sull\'asse x').toMatch(/^x\b/);
    expect(rowStyle.snapType, 'snap non obbligato').not.toContain('mandatory');
    expect(rowStyle.paddingLeft).toBe('16px');
    expect(rowStyle.initialDay, 'data-initial-day').toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rowStyle.columns.length).toBeGreaterThan(0);
    for (const column of rowStyle.columns) expect(column).toEqual({ align: 'start', stop: 'normal' });
    // Su telefono niente pulsanti: si scorre con il dito
    await expect(prev).toBeHidden();
    await expect(nextButton).toBeHidden();

    // --- 1280 px: pulsanti fuori dalla fila, frecce con il focus nella fila ---
    await page.setViewportSize(DESKTOP);
    await page.goto(`${WHEN_PATH}?servizio=${serviceId}&giorno=${first}`);
    const firstColumn = whenColumn(page, barbers[0]?.name ?? '', first);
    await expect(firstColumn).toBeVisible();
    await expect.poll(() => rowScrollLeft(page)).toBe(0);
    const edge = await leftOf(firstColumn);
    await expect(prev).toBeVisible();
    await expect(nextButton).toBeVisible();
    await expect(row.getByRole('button'), 'pulsanti fuori dalla fila').toHaveCount(0);
    expect((await prev.boundingBox())?.x ?? 0).toBeLessThan((await nextButton.boundingBox())?.x ?? 0);
    await expect(prev, 'primo giorno della fila: "Giorno precedente" disattivato').toBeDisabled();
    await expect(nextButton).toBeEnabled();

    await nextButton.click();
    await expectAtEdge(whenColumn(page, barbers[0]?.name ?? '', second), edge, 'giorno successivo: prima colonna al bordo');
    await expect.poll(() => selectedDate(page)).toBe(second);
    await expect.poll(() => urlDay(page)).toBe(second);
    await expect(prev).toBeEnabled();

    await row.focus();
    await expect(row, 'la fila è focusabile').toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expectAtEdge(whenColumn(page, barbers[0]?.name ?? '', third), edge, 'freccia →: prima colonna del giorno dopo al bordo');
    await expect.poll(() => selectedDate(page)).toBe(third);
    await page.keyboard.press('ArrowLeft');
    await expectAtEdge(whenColumn(page, barbers[0]?.name ?? '', second), edge, 'freccia ←: prima colonna del giorno prima al bordo');
    await expect.poll(() => selectedDate(page)).toBe(second);

    await prev.click();
    await expectAtEdge(firstColumn, edge, 'giorno precedente: di nuovo il primo giorno');
    await expect.poll(() => selectedDate(page)).toBe(first);
    await expect(prev).toBeDisabled();
    await expect(dayColumns(page, first).first()).toBeVisible();
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 9. ?giorno= non valido, fuori periodo, passato o chiuso → primo giorno con orari
// ---------------------------------------------------------------------------
test('?giorno= non valido (testo, fuori periodo, ieri, domenica chiusa): si apre sul primo giorno con orari, senza errori né overflow, valore grezzo mai mostrato', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const { serviceId, barbers } = await rowService(api, data);
    const horizon = await horizonDays(api);
    const service = (await api.get<Array<{ name: string }>>(`/rest/v1/services?select=name&id=eq.${serviceId}`))[0]?.name ?? '';
    await signUpCustomer(page, 'giornononvalido');

    // Riferimento: il giorno selezionato aprendo senza `giorno` (primo giorno con orari)
    await page.goto(`${WHEN_PATH}?servizio=${serviceId}`);
    const opening = await selectedDate(page);
    await expectAtEdge(whenColumn(page, barbers[0]?.name ?? '', opening), EDGE, 'senza giorno: prima colonna al bordo');

    const sunday = Array.from({ length: horizon }, (_, i) => plusDays(today(), i + 1)).find((d) => isoWeekday(d) === 7) ?? '';
    expect(sunday, 'una domenica (chiusa) entro il periodo').not.toBe('');
    const cases = ['abc', '2099-01-01', plusDays(today(), -1), sunday];

    for (const raw of cases) {
      await test.step(`giorno=${raw}`, async () => {
        errors.length = 0;
        await page.goto(`${WHEN_PATH}?servizio=${serviceId}&giorno=${encodeURIComponent(raw)}`);
        await expect.poll(() => selectedDate(page), 'giorno selezionato nella striscia').toBe(opening);
        await expectAtEdge(whenColumn(page, barbers[0]?.name ?? '', opening), EDGE, 'prima colonna del giorno di apertura al bordo');
        await expect.poll(() => urlDay(page), "giorno di apertura nell'URL").toBe(opening);

        const overflow = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(overflow.scroll, 'nessun overflow orizzontale').toBeLessThanOrEqual(overflow.client);

        // Il valore grezzo non compare nella pagina (tolti i nomi generati di servizio e barbieri, che
        // potrebbero contenerlo per caso) né in data-initial-day
        let text = await page.locator('body').innerText();
        for (const name of [service, ...barbers.map((b) => b.name)]) text = text.split(name).join('');
        expect(text.includes(raw), `"${raw}" non compare nel testo della pagina`).toBe(false);
        const initialDay = await whenRow(page).getAttribute('data-initial-day');
        expect(initialDay, 'data-initial-day').not.toBe(raw);
        expect(initialDay, 'data-initial-day = giorno di apertura').toBe(opening);

        await settle(page);
        expect(errors, 'nessun errore in pagina').toEqual([]);
      });
    }
  } finally {
    await cleanup(api, data);
  }
});
