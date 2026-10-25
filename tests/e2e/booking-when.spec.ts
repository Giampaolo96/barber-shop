// modificato in fetta 8f con l'approvazione dell'utente (2026-10-25)
// modificato in fetta 8g con l'approvazione dell'utente (2026-10-25): tolto "Primo libero" (test, helper e riga del contratto).
// Test di accettazione e2e – FETTA 8e (SPEC §11: "Prenotazione da telefono: servizio → quando →
// conferma"). Regole: SPEC §5.2 (flusso in 3 schermate, pagina "Quando?", striscia dei giorni,
// sezioni per barbiere, barbiere senza posti, vecchi URL), §4, §9 (tap target ≥ 44 px,
// testi in italiano) + decisioni approvate per la fetta 8e (docs/PROGRESS.md, "Fetta 8e").
// Tutti i test a 390×844 (riferimento telefono di SPEC §5.2).
//
// Rotte attese:
//   /prenota                         ogni servizio porta a /prenota/quando?servizio=<id> (niente passo barbiere)
//   /prenota/quando?servizio=<id>[&giorno=YYYY-MM-DD][&barbiere=<uuid>]
//                                    h1 it.booking.when.title ("Quando?"), "Passo 2 di 3"
//   /prenota/riepilogo?servizio=&barbiere=<uuid>&inizio=<ISO>   "Passo 3 di 3"; "Indietro" (e "Cambia
//                                    orario" in caso di errore) → /prenota/quando?servizio=&giorno=<giorno locale>
//   /prenota/barbiere, /prenota/orario  redirect a /prenota/quando (servizio, barbiere uuid, giorno valido)
// Accesso (decisione 8e: come oggi, SPEC §5.3 e §5.5): /prenota/quando richiede login e profilo
// completo (anonimo → /accedi e ritorno a "Quando?" dopo il login); il cliente bloccato vede
// it.booking.errors.blocked già su "Quando?", senza orari.
// Contratto dell'interfaccia di "Quando?":
//   - striscia: <nav aria-label=it.booking.time.daysLabel>, un elemento per giorno da oggi a oggi +
//     max_horizon_days; giorni selezionabili = link con `giorno=<data>` nell'href; giorno selezionato
//     aria-current="date"; giorno chiuso non link, aria-disabled="true", testo per screen reader
//     it.booking.when.dayClosed ("{day}, chiuso"); sticky in alto; Tab entra sul giorno selezionato,
//     ←/→ spostano il focus, Invio seleziona; il giorno selezionato finisce nell'URL (`giorno`).
//   - una colonna per barbiere e per giorno, in una fila orizzontale continua (fetta 8f, regione
//     it.booking.when.rowLabel): <section role="group"> con nome it.booking.when.columnLabel ("Orari di
//     <nome>, <giorno>", giorno = formatDayLabel, es. "mer 21 ott"), data-day e data-barber, con un
//     heading che contiene il nome; la bio non si mostra; nella colonna del preferito dall'URL il testo
//     it.booking.when.preferred (per lo screen reader; a vista "Il tuo"). Sugli schermi alti almeno
//     600 px scorrono solo le colonne, la pagina no; sotto scorre la pagina intera. Dettagli della
//     fila in ./when-row-helpers.ts e booking-when-row.spec.ts.
//   - orari: link (o pulsanti) con nome accessibile it.booking.when.slotLabel ("9:30 con <nome>"),
//     alti almeno 44 px.
//   - barbiere senza posti: it.booking.when.columnNoSlots ("Nessun orario") e link con nome
//     it.booking.when.nextFree ("prossimo: mar 20, 9:30") a /prenota/quando con quel giorno; senza orari
//     nel periodo solo columnNoSlots.
//
// Prerequisiti: Supabase locale con il seed, Mailpit. Dati (servizi, barbieri, orari) creati per ogni
// test con nomi univoci tramite l'admin demo (RLS attiva) e rimossi alla fine; clienti nuovi con email
// univoche. Nessuna chiusura del negozio (globali): i giorni chiusi si ottengono con gli orari dei barbieri.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { it as itLocale } from 'date-fns/locale';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

import {
  adminApi,
  cleanup,
  createBarber,
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
import { selectedDate, whenColumn } from './when-row-helpers';

test.use({ viewport: { width: 390, height: 844 } });

const TZ = 'Europe/Rome';
const WHEN_PATH = '/prenota/quando';

// ---------------------------------------------------------------------------
// Login del cliente (magic link via Mailpit), come in booking.spec.ts
// ---------------------------------------------------------------------------
const latestConfirmLink = async (request: APIRequestContext, to: string, previousId: string | null): Promise<string> => {
  const href = confirmHref(await waitForNewEmail(request, to, previousId));
  expect(href, "link /auth/confirm nell'email").toBeDefined();
  const url = new URL(href ?? 'http://invalid.invalid');
  return `${url.pathname}${url.search}`;
};

/** Cliente nuovo con profilo completo, già loggato in `page`; restituisce email e nome. */
const signUpCustomer = async (page: Page, label: string): Promise<{ email: string; fullName: string }> => {
  const fullName = uniqueName('Cliente');
  const email = uniqueEmail(label);
  await page.goto('/accedi');
  const before = await newestEmailId(page.request, email);
  await page.getByLabel(s('auth.customerLogin.emailLabel')).fill(email);
  await page.getByRole('button', { name: s('auth.customerLogin.submit') }).click();
  await expect(page.getByText(s('auth.customerLogin.linkSent'))).toBeVisible();
  await page.goto(await latestConfirmLink(page.request, email, before));
  await page.locator('main form').getByRole('button', { name: s('auth.confirmLink.submit') }).click();
  await expectPath(page, '/profilo/completa');
  await page.getByLabel(s('auth.completeProfile.fullNameLabel')).fill(fullName);
  await page.getByLabel(s('auth.completeProfile.phoneLabel')).fill(`+39 333 ${Math.floor(1_000_000 + Math.random() * 8_999_999)}`);
  await page.getByLabel(s('auth.completeProfile.privacyConsentLabel')).check();
  await page.getByRole('button', { name: s('auth.completeProfile.submit') }).click();
  await expectPath(page, '/');
  return { email, fullName };
};

// ---------------------------------------------------------------------------
// Dati di prova
// ---------------------------------------------------------------------------
type Created = { services: string[]; barbers: string[]; bookings: string[] };
type Hours = { weekdays: number[]; start: string; end: string };
const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7];

const newService = async (api: AdminApi, data: Created, label: string): Promise<{ id: string; name: string }> => {
  const name = uniqueName(label);
  const id = await createService(api, { name, durationMin: 30, priceCents: 2000 });
  data.services.push(id);
  return { id, name };
};

/** Barbiere abilitato al servizio con le fasce date (nessuna fascia = non lavora mai). */
const newBarber = async (api: AdminApi, data: Created, serviceId: string, name: string, hours: Hours | null): Promise<string> => {
  const id = await createBarber(api, name, [serviceId]);
  data.barbers.push(id);
  if (hours && hours.weekdays.length > 0) {
    await api.post(
      '/rest/v1/working_hours?select=id',
      hours.weekdays.map((weekday) => ({ barber_id: id, weekday, start_time: hours.start, end_time: hours.end })),
    );
  }
  return id;
};

type BookingRow = { id: string; barber_id: string; status: string; starts_at: string };
const bookingsOfService = (api: AdminApi, serviceId: string): Promise<BookingRow[]> =>
  api.get<BookingRow[]>(`/rest/v1/bookings?select=id,barber_id,status,starts_at&service_id=eq.${serviceId}`);

type Settings = { slot_granularity_min: number; max_horizon_days: number };
const shopSettings = async (api: AdminApi): Promise<Settings> => {
  const [row] = await api.get<Settings[]>('/rest/v1/shop_settings?select=slot_granularity_min,max_horizon_days');
  expect(row, 'shop_settings').toBeDefined();
  return row as Settings;
};

// ---------------------------------------------------------------------------
// Date e orari nella timezone del negozio
// ---------------------------------------------------------------------------
const today = (): string => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
/** Giorno della settimana ISO (1 = lunedì … 7 = domenica), come working_hours.weekday. */
const isoWeekday = (date: string): number => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const localInstant = (date: string, time: string): number => fromZonedTime(`${date}T${time}:00`, TZ).getTime();
/** "H:mm" dell'ultimo inizio di un servizio di 30' in una fascia che finisce alle 23:00. */
const lastStartBefore23 = (granularity: number): string => {
  const minutes = Math.floor((23 * 60 - 30) / granularity) * granularity;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
};
/** Testo atteso di it.booking.when.nextFree per l'istante locale (es. "mar 20, 9:30"). */
const nextFreeText = (date: string, time: string): string =>
  sf('booking.when.nextFree', {
    when: formatInTimeZone(new Date(localInstant(date, time)), TZ, 'EEE d, H:mm', { locale: itLocale }),
  });

// ---------------------------------------------------------------------------
// Interfaccia
// ---------------------------------------------------------------------------
const main = (page: Page): Locator => page.locator('main');
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const tap = async (locator: Locator): Promise<void> => {
  await expect(locator).toBeVisible();
  await locator.click();
};

const linkOrButton = (scope: Locator, name: string | RegExp): Locator => {
  const exact = typeof name === 'string';
  return scope
    .getByRole('link', { name, exact })
    .or(scope.getByRole('button', { name, exact }))
    .first();
};

const daysNav = (page: Page): Locator => page.getByRole('navigation', { name: s('booking.time.daysLabel'), exact: true });
/** Elementi della striscia, in ordine: giorni selezionabili (link) e giorni chiusi (aria-disabled). */
const dayItems = (page: Page): Locator => daysNav(page).locator('a[href], [aria-disabled="true"]');
const dayLink = (page: Page, date: string): Locator => daysNav(page).locator(`a[href*="giorno=${date}"]`);
const selectedDay = (page: Page): Locator => daysNav(page).locator('[aria-current="date"]');

/** Colonna del barbiere nel giorno `day` (fetta 8f: una colonna per barbiere e per giorno). */
const barberSection = (page: Page, name: string, day: string): Locator => whenColumn(page, name, day);

const slot = (scope: Locator, time: string, barber: string): Locator =>
  linkOrButton(scope, sf('booking.when.slotLabel', { time, barber }));

/** Indici (in `names`) dei barbieri nell'ordine delle colonne del giorno `day`. */
const sectionOrder = (page: Page, names: string[], day: string): Promise<number[]> =>
  main(page)
    .locator(`section[data-day="${day}"]`)
    .evaluateAll(
      (sections, list) =>
        sections
          .map((section) => {
            const heading = section.querySelector('h1, h2, h3, h4, h5, h6');
            const text = heading?.textContent ?? '';
            return list.findIndex((name) => text.includes(name));
          })
          .filter((index) => index >= 0),
      names,
    );

const searchParam = (page: Page, name: string): string | null => new URL(page.url()).searchParams.get(name);

const expectWhenUrl = async (page: Page, params: Record<string, string | null>): Promise<void> => {
  await expectPath(page, WHEN_PATH);
  for (const [name, value] of Object.entries(params)) {
    await expect.poll(() => searchParam(page, name), { message: `parametro ${name}` }).toBe(value);
  }
};

const hrefParams = async (link: Locator): Promise<{ pathname: string; params: Record<string, string> }> => {
  const href = (await link.getAttribute('href')) ?? '';
  const url = new URL(href, 'http://localhost');
  return { pathname: url.pathname, params: Object.fromEntries(url.searchParams) };
};

// ---------------------------------------------------------------------------
// 1. Flusso completo a 390 px (SPEC §5.2): servizio → "Quando?" → riepilogo → conferma
// ---------------------------------------------------------------------------
test('flusso 8e: dal listino a "Quando?", cambio giorno (anche da tastiera), orario del secondo barbiere, conferma; niente overflow e striscia sticky', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const settings = await shopSettings(api);
    expect(settings.max_horizon_days, 'periodo prenotabile sufficiente per il test').toBeGreaterThanOrEqual(5);
    const service = await newService(api, data, 'Quando');
    const alfa = uniqueName('Alfa');
    const beta = uniqueName('Beta');
    await newBarber(api, data, service.id, alfa, { weekdays: ALL_WEEK, start: '06:00', end: '23:00' });
    const betaId = await newBarber(api, data, service.id, beta, { weekdays: ALL_WEEK, start: '06:00', end: '23:00' });
    await signUpCustomer(page, 'quando');

    // SPEC §5.2: dal listino si va direttamente a "Quando?", anche con più barbieri
    await page.goto('/prenota');
    await tap(main(page).getByRole('link', { name: new RegExp(escapeRegExp(service.name)) }));
    await expectWhenUrl(page, { servizio: service.id });
    await expect(page.getByRole('heading', { level: 1, name: s('booking.when.title'), exact: true })).toBeVisible();
    await expect(main(page).getByText(sf('booking.step', { current: 2, total: 3 }), { exact: true })).toBeVisible();

    // Striscia: un giorno da oggi a oggi + max_horizon_days, un solo giorno selezionato
    const nav = daysNav(page);
    await expect(nav).toBeVisible();
    await expect(dayItems(page)).toHaveCount(settings.max_horizon_days + 1);
    await expect(selectedDay(page)).toHaveCount(1);

    // Cambio giorno con un tocco: dopo-domani (i barbieri lavorano tutti i giorni)
    const day = plusDays(today(), 2);
    await expect(dayItems(page).nth(2)).toHaveAttribute('href', new RegExp(`giorno=${day}`));
    await tap(dayLink(page, day));
    await expectWhenUrl(page, { servizio: service.id, giorno: day });
    await expect(dayLink(page, day)).toHaveAttribute('aria-current', 'date');

    // Sezioni per nome (nessun preferito, cliente senza storico), senza "Il tuo barbiere"
    expect(await sectionOrder(page, [alfa, beta], day)).toEqual([0, 1]);
    await expect(main(page).getByText(s('booking.when.preferred'))).toHaveCount(0);

    // Tastiera: Tab entra sul giorno selezionato
    // (gli altri giorni non sono tappe del Tab: da quello selezionato Tab e Maiusc+Tab escono dalla striscia)
    await dayLink(page, day).focus();
    await page.keyboard.press('Tab');
    await expect(nav.locator(':focus')).toHaveCount(0);
    await page.keyboard.press('Shift+Tab');
    await expect(dayLink(page, day)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(nav.locator(':focus')).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(dayLink(page, day)).toBeFocused();
    // ←/→ spostano il focus senza selezionare, Invio seleziona
    const next = plusDays(day, 1);
    await page.keyboard.press('ArrowRight');
    await expect(dayLink(page, next)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(dayLink(page, day)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(dayLink(page, day)).toHaveAttribute('aria-current', 'date');
    await page.keyboard.press('Enter');
    await expectWhenUrl(page, { servizio: service.id, giorno: next });
    await expect(dayLink(page, next)).toHaveAttribute('aria-current', 'date');

    // SPEC §5.2: riferimento 390 px, nessuno scorrimento orizzontale della pagina
    const time = lastStartBefore23(settings.slot_granularity_min);
    const target = slot(barberSection(page, beta, next), time, beta);
    await expect(target).toBeVisible();
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll, 'nessun overflow orizzontale').toBeLessThanOrEqual(overflow.client);

    // A 390×844 scorrono solo le colonne: la pagina non scorre e la striscia resta visibile
    const pageScrolls = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
    expect(pageScrolls, 'a 390×844 la pagina non scorre in verticale').toBe(false);
    await expect(nav).toBeInViewport();

    // Striscia sticky: sotto i 600 px di altezza scorre la pagina intera e la striscia resta in cima
    await page.setViewportSize({ width: 390, height: 560 });
    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
    expect(scrollable, 'a 390×560 la pagina con due barbieri scorre in verticale').toBe(true);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const navBox = await nav.boundingBox();
    expect(navBox, 'striscia dei giorni presente').not.toBeNull();
    expect(navBox?.y ?? -100, 'striscia in cima al viewport').toBeGreaterThanOrEqual(-1);
    expect(navBox?.y ?? 1000, 'striscia in cima al viewport').toBeLessThanOrEqual(24);
    await expect(nav).toBeInViewport();
    await page.setViewportSize({ width: 390, height: 844 });

    // SPEC §9: tap target ≥ 44 px; tocco sull'orario del secondo barbiere
    await target.scrollIntoViewIfNeeded();
    const slotBox = await target.boundingBox();
    expect(slotBox?.height ?? 0, 'orario alto almeno 44 px').toBeGreaterThanOrEqual(44);
    await tap(target);

    // Riepilogo: barbiere e orario scelti, passo 3 di 3, "Indietro" a "Quando?" sullo stesso giorno
    await expectPath(page, '/prenota/riepilogo');
    const expectedStart = localInstant(next, time.padStart(5, '0'));
    expect(searchParam(page, 'servizio')).toBe(service.id);
    expect(searchParam(page, 'barbiere')).toBe(betaId);
    expect(new Date(searchParam(page, 'inizio') ?? '').getTime()).toBe(expectedStart);
    await expect(main(page)).toContainText(beta);
    await expect(main(page)).toContainText(time);
    await expect(main(page).getByText(sf('booking.step', { current: 3, total: 3 }), { exact: true })).toBeVisible();
    const back = await hrefParams(main(page).getByRole('link', { name: s('booking.back'), exact: true }));
    expect(back.pathname).toBe(WHEN_PATH);
    expect(back.params.servizio).toBe(service.id);
    expect(back.params.giorno).toBe(next);

    // Conferma: riga in DB con il barbiere e l'ora scelti
    await tap(page.getByRole('button', { name: s('booking.summary.confirm'), exact: true }));
    await expect
      .poll(() => new URL(page.url()).pathname, { message: 'percorso atteso: /prenotazioni/<id>/confermata' })
      .toMatch(/^\/prenotazioni\/[0-9a-f-]{36}\/confermata$/);
    const rows = await bookingsOfService(api, service.id);
    data.bookings.push(...rows.map((r) => r.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ barber_id: betaId, status: 'confirmed' });
    expect(new Date(rows[0]?.starts_at ?? '').getTime()).toBe(expectedStart);
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 3. Barbiere senza posti e giorno chiuso (SPEC §5.2)
// ---------------------------------------------------------------------------
test('barbiere senza posti: "Nessun orario" con il link al prossimo giorno; senza orari solo il testo; giorno chiuso disattivato', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const settings = await shopSettings(api);
    expect(settings.max_horizon_days, 'periodo prenotabile sufficiente per il test').toBeGreaterThanOrEqual(6);
    const day = plusDays(today(), 2); // D: A non lavora, B sì
    const closed = plusDays(today(), 5); // E: nessuno lavora
    const service = await newService(api, data, 'Pieno');
    const a = uniqueName('Assente');
    const b = uniqueName('Presente');
    const c = uniqueName('Senza orari');
    const others = (...excluded: string[]): number[] => ALL_WEEK.filter((w) => !excluded.map(isoWeekday).includes(w));
    await newBarber(api, data, service.id, a, { weekdays: others(day, closed), start: '06:00', end: '23:00' });
    await newBarber(api, data, service.id, b, { weekdays: others(closed), start: '06:00', end: '23:00' });
    await newBarber(api, data, service.id, c, null);
    await signUpCustomer(page, 'pieno');

    await page.goto(`${WHEN_PATH}?servizio=${service.id}&giorno=${day}`);
    await expectWhenUrl(page, { servizio: service.id, giorno: day });
    await expect(dayLink(page, day)).toHaveAttribute('aria-current', 'date');

    // B ha orari nel giorno
    await expect(slot(barberSection(page, b, day), '6:00', b)).toBeVisible();

    // A: "Nessun orario" e "prossimo: <giorno>, 6:00" verso il giorno dopo
    const sectionA = barberSection(page, a, day);
    await expect(sectionA.getByText(s('booking.when.columnNoSlots'), { exact: true })).toBeVisible();
    await expect(sectionA.getByRole('link', { name: /^\d{1,2}:\d{2} con / })).toHaveCount(0);
    const nextDay = plusDays(day, 1);
    const nextLink = sectionA.getByRole('link', { name: nextFreeText(nextDay, '06:00') });
    await expect(nextLink).toBeVisible();

    // C: solo "Nessun orario", senza link "prossimo"
    const sectionC = barberSection(page, c, day);
    await expect(sectionC.getByText(s('booking.when.columnNoSlots'), { exact: true })).toBeVisible();
    const nextPrefix = new RegExp(`^${escapeRegExp(s('booking.when.nextFree').split('{when}')[0] ?? '')}`);
    await expect(sectionC.getByRole('link', { name: nextPrefix })).toHaveCount(0);
    await expect(sectionC.getByText(nextPrefix)).toHaveCount(0);

    // Giorno chiuso (nessuno dei tre lavora): non è un link, è disattivato e lo dice agli screen reader
    await expect(dayLink(page, closed)).toHaveCount(0);
    const closedItem = dayItems(page).nth(5);
    await expect(closedItem).toHaveAttribute('aria-disabled', 'true');
    expect(await closedItem.evaluate((el) => el.matches('a[href]'))).toBe(false);
    const closedSuffix = s('booking.when.dayClosed').replace('{day}', '');
    expect(
      await closedItem.evaluate((el) => `${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`),
    ).toContain(closedSuffix);

    // Il link "prossimo" porta al giorno dopo, dove A ha orari
    await tap(nextLink);
    await expectWhenUrl(page, { servizio: service.id, giorno: nextDay });
    await expect(dayLink(page, nextDay)).toHaveAttribute('aria-current', 'date');
    await expect(slot(barberSection(page, a, nextDay), '6:00', a)).toBeVisible();
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 4. Vecchi URL (SPEC §5.2)
// ---------------------------------------------------------------------------
test('vecchi URL: /prenota/barbiere e /prenota/orario portano a "Quando?"; il barbiere dell\'URL è il primo, evidenziato; "any" si scarta', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const service = await newService(api, data, 'Vecchi URL');
    const alfa = uniqueName('Alfa');
    const beta = uniqueName('Beta');
    const alfaId = await newBarber(api, data, service.id, alfa, { weekdays: ALL_WEEK, start: '06:00', end: '23:00' });
    const betaId = await newBarber(api, data, service.id, beta, { weekdays: ALL_WEEK, start: '06:00', end: '23:00' });
    // Bio di Alfa: nella vista a colonne di "Quando?" non si mostra
    const bioFirstLine = 'Sfumature e barba alla vecchia maniera, con rifinitura a rasoio e panno caldo';
    const bioHidden = 'Riga della bio da non mostrare';
    // select esplicito: barbers ha grant di colonna (CLAUDE.md – Sicurezza)
    await api.patch(`/rest/v1/barbers?id=eq.${alfaId}&select=id`, { bio: `
  ${bioFirstLine}  
${bioHidden}` });
    await signUpCustomer(page, 'vecchiurl');
    const day = plusDays(today(), 3);

    await page.goto(`/prenota/barbiere?servizio=${service.id}`);
    await expectWhenUrl(page, { servizio: service.id, barbiere: null });

    await page.goto(`/prenota/orario?servizio=${service.id}&barbiere=${betaId}&giorno=${day}`);
    await expectWhenUrl(page, { servizio: service.id, barbiere: betaId, giorno: day });
    await expect(dayLink(page, day)).toHaveAttribute('aria-current', 'date');
    // Il preferito dall'URL viene prima anche se l'ordine per nome lo metterebbe dopo
    expect(await sectionOrder(page, [alfa, beta], day)).toEqual([1, 0]);
    await expect(barberSection(page, beta, day).getByText(s('booking.when.preferred'))).toBeVisible();
    await expect(barberSection(page, alfa, day).getByText(s('booking.when.preferred'))).toHaveCount(0);

    // Bio: né la prima riga né le altre compaiono nella colonna
    await expect(main(page).getByText(bioFirstLine)).toHaveCount(0);
    await expect(main(page).getByText(bioHidden)).toHaveCount(0);

    await page.goto(`/prenota/orario?servizio=${service.id}&barbiere=any&giorno=${day}`);
    await expectWhenUrl(page, { servizio: service.id, barbiere: null, giorno: day });
    expect(await sectionOrder(page, [alfa, beta], day)).toEqual([0, 1]);

    // Senza servizio valido si torna al listino
    await page.goto('/prenota/orario?barbiere=any');
    await expectPath(page, '/prenota');
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 5. Accesso come oggi (decisione 8e; SPEC §5.3, §5.5)
// ---------------------------------------------------------------------------
test('accesso: anonimo su "Quando?" va al login e poi torna lì; il cliente bloccato è fermato già su "Quando?"', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const service = await newService(api, data, 'Accesso');
    const name = uniqueName('Unico');
    await newBarber(api, data, service.id, name, { weekdays: ALL_WEEK, start: '06:00', end: '23:00' });
    const { email, fullName } = await signUpCustomer(page, 'accesso');
    await page.context().clearCookies();

    // Anonimo: login richiesto, poi ritorno a "Quando?" con lo stesso servizio
    await page.goto(`${WHEN_PATH}?servizio=${service.id}`);
    await expectPath(page, '/accedi');
    const before = await newestEmailId(page.request, email);
    await page.getByLabel(s('auth.customerLogin.emailLabel')).fill(email);
    await page.getByRole('button', { name: s('auth.customerLogin.submit') }).click();
    await expect(page.getByText(s('auth.customerLogin.linkSent'))).toBeVisible();
    await page.goto(await latestConfirmLink(page.request, email, before));
    await page.locator('main form').getByRole('button', { name: s('auth.confirmLink.submit') }).click();
    await expectPath(page, WHEN_PATH);
    expect(searchParam(page, 'servizio')).toBe(service.id);
    await expect(barberSection(page, name, await selectedDate(page))).toBeVisible();

    // L'admin blocca il cliente: "Quando?" mostra l'avviso e nessun orario
    const [profile] = await api.get<Array<{ id: string }>>(
      `/rest/v1/profiles?select=id&full_name=eq.${encodeURIComponent(fullName)}`,
    );
    expect(profile, 'profilo del cliente').toBeDefined();
    await api.patch(`/rest/v1/profiles?id=eq.${profile?.id}`, { is_blocked: true });
    await page.reload();
    await expect(main(page).getByText(s('booking.errors.blocked'))).toBeVisible();
    await expect(main(page).getByRole('link', { name: new RegExp(`con ${escapeRegExp(name)}$`) })).toHaveCount(0);
    await expect(main(page).getByRole('button', { name: new RegExp(`con ${escapeRegExp(name)}$`) })).toHaveCount(0);
  } finally {
    await cleanup(api, data);
  }
});
