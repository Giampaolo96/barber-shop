// Rifiniture della fetta 8e dopo la review (migliorie approvate dall'utente il 2026-10-16; SPEC §5.2,
// ADR 012). A 390×844 come booking-when.spec.ts.
//   - ultimo appuntamento: la sezione del barbiere dell'ultimo appuntamento già iniziato è la prima,
//     le cancellate non contano (lettura reale con la RLS);
//   - riepilogo aperto da un vecchio link con barbiere=any: it.booking.summary.anyBarber;
//   - orario preso nel frattempo: "Cambia orario" riporta a "Quando?" sullo stesso giorno;
//   - "Indietro" del riepilogo conserva il barbiere preferito (parametro `preferito`);
//   - dopo "prossimo: …" il focus va sull'intestazione del barbiere e una regione aria-live annuncia
//     il giorno (it.booking.when.dayAnnounce);
//   - giorno "senza posti": bordo tratteggiato e data con contrasto ≥ 4,5:1.
// Dati creati tramite l'admin demo (RLS attiva) e rimossi alla fine; clienti nuovi con email univoche.

import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
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

test.use({ viewport: { width: 390, height: 844 } });

const TZ = 'Europe/Rome';
const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7];

type Created = { services: string[]; barbers: string[]; bookings: string[] };
type Hours = { weekdays: number[]; start: string; end: string };

const latestConfirmLink = async (request: APIRequestContext, to: string, previousId: string | null): Promise<string> => {
  const href = confirmHref(await waitForNewEmail(request, to, previousId));
  expect(href, "link /auth/confirm nell'email").toBeDefined();
  const url = new URL(href ?? 'http://invalid.invalid');
  return `${url.pathname}${url.search}`;
};

/** Cliente nuovo con profilo completo, già loggato; restituisce l'id del profilo. */
const signUpCustomer = async (page: Page, api: AdminApi, label: string): Promise<string> => {
  const email = uniqueEmail(label);
  const fullName = uniqueName('Cliente');
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
  const [profile] = await api.get<Array<{ id: string }>>(
    `/rest/v1/profiles?select=id&full_name=eq.${encodeURIComponent(fullName)}`,
  );
  expect(profile, 'profilo del cliente').toBeDefined();
  return profile?.id ?? '';
};

const newService = async (api: AdminApi, data: Created, label: string): Promise<{ id: string; name: string }> => {
  const name = uniqueName(label);
  const id = await createService(api, { name, durationMin: 30, priceCents: 2000 });
  data.services.push(id);
  return { id, name };
};

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

const insertBooking = async (
  api: AdminApi,
  data: Created,
  row: { customer_id?: string; guest_name?: string; guest_phone?: string; barber_id: string; service_id: string; starts_at: string; status: string },
): Promise<string> => {
  const [created] = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', { source: 'manual', ...row });
  expect(created, 'prenotazione creata').toBeDefined();
  data.bookings.push(created?.id ?? '');
  return created?.id ?? '';
};

const today = (): string => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
const isoWeekday = (date: string): number => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const at = (date: string, time: string): string => fromZonedTime(`${date}T${time}:00`, TZ).toISOString();

const main = (page: Page): Locator => page.locator('main');
const sectionOrder = (page: Page, names: string[]): Promise<number[]> =>
  main(page)
    .locator('section')
    .evaluateAll(
      (sections, list) =>
        sections
          .map((section) => list.findIndex((name) => (section.querySelector('h2')?.textContent ?? '').includes(name)))
          .filter((index) => index >= 0),
      names,
    );
const hrefParams = async (link: Locator): Promise<{ pathname: string; params: Record<string, string> }> => {
  const url = new URL((await link.getAttribute('href')) ?? '', 'http://localhost');
  return { pathname: url.pathname, params: Object.fromEntries(url.searchParams) };
};

// ---------------------------------------------------------------------------
// 1. Ultimo appuntamento (miglioria 1 e 2)
// ---------------------------------------------------------------------------
test('ultimo appuntamento: il suo barbiere è la prima sezione; una cancellazione più recente non conta', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const service = await newService(api, data, 'Ultimo');
    const alfa = uniqueName('Alfa');
    const zeta = uniqueName('Zeta');
    const alfaId = await newBarber(api, data, service.id, alfa, { weekdays: ALL_WEEK, start: '06:00', end: '23:00' });
    const zetaId = await newBarber(api, data, service.id, zeta, { weekdays: ALL_WEEK, start: '06:00', end: '23:00' });
    const customerId = await signUpCustomer(page, api, 'ultimo');

    // Senza storico: ordine per nome
    await page.goto(`/prenota/quando?servizio=${service.id}`);
    expect(await sectionOrder(page, [alfa, zeta])).toEqual([0, 1]);

    // Appuntamento completato con Zeta 10 giorni fa, cancellazione con Alfa 2 giorni fa
    await insertBooking(api, data, {
      customer_id: customerId,
      barber_id: zetaId,
      service_id: service.id,
      starts_at: at(plusDays(today(), -10), '10:00'),
      status: 'completed',
    });
    await insertBooking(api, data, {
      customer_id: customerId,
      barber_id: alfaId,
      service_id: service.id,
      starts_at: at(plusDays(today(), -2), '10:00'),
      status: 'cancelled_by_customer',
    });

    await page.reload();
    expect(await sectionOrder(page, [alfa, zeta])).toEqual([1, 0]);
    // Il barbiere dell'ultimo appuntamento non è "Il tuo barbiere" (quello è solo il preferito dall'URL)
    await expect(main(page).getByText(s('booking.when.preferred'))).toHaveCount(0);
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 2. Riepilogo: barbiere=any, "Cambia orario" dopo l'errore, preferito conservato (migliorie 9, 11)
// ---------------------------------------------------------------------------
test('riepilogo: "qualsiasi" dai vecchi link, "Cambia orario" sullo stesso giorno dopo l\'errore, preferito conservato', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const service = await newService(api, data, 'Riepilogo');
    const name = uniqueName('Unico');
    const barberId = await newBarber(api, data, service.id, name, { weekdays: ALL_WEEK, start: '06:00', end: '23:00' });
    await signUpCustomer(page, api, 'riepilogo');
    const day = plusDays(today(), 3);
    const startsAt = at(day, '10:00');

    // Vecchio link con barbiere=any: il riepilogo lo accetta e lo spiega
    await page.goto(`/prenota/riepilogo?servizio=${service.id}&barbiere=any&inizio=${encodeURIComponent(startsAt)}`);
    await expect(main(page).getByText(s('booking.summary.anyBarber'), { exact: true })).toBeVisible();

    // Preferito conservato: "Indietro" torna a "Quando?" con giorno e barbiere
    await page.goto(
      `/prenota/riepilogo?servizio=${service.id}&barbiere=${barberId}&inizio=${encodeURIComponent(startsAt)}&preferito=${barberId}`,
    );
    const back = main(page).getByRole('link', { name: s('booking.back'), exact: true });
    expect(await hrefParams(back)).toEqual({
      pathname: '/prenota/quando',
      params: { servizio: service.id, giorno: day, barbiere: barberId },
    });

    // L'orario viene preso nel frattempo (prenotazione dello staff): errore e "Cambia orario"
    await insertBooking(api, data, {
      guest_name: 'Ospite e2e',
      guest_phone: '+393330000000',
      barber_id: barberId,
      service_id: service.id,
      starts_at: startsAt,
      status: 'confirmed',
    });
    await page.getByRole('button', { name: s('booking.summary.confirm'), exact: true }).click();
    const change = main(page).getByRole('link', { name: s('booking.summary.changeTime'), exact: true });
    await expect(change).toBeVisible();
    expect(await hrefParams(change)).toEqual({
      pathname: '/prenota/quando',
      params: { servizio: service.id, giorno: day, barbiere: barberId },
    });
    await change.click();
    await expectPath(page, '/prenota/quando');
    await expect(page.getByRole('navigation', { name: s('booking.time.daysLabel') }).locator('[aria-current="date"]')).toHaveAttribute(
      'href',
      new RegExp(`giorno=${day}`),
    );
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 3. Accessibilità: focus e annuncio dopo "prossimo: …", contrasto dei giorni "senza posti" (6, 8)
// ---------------------------------------------------------------------------
/** Rapporto di contrasto WCAG fra due colori CSS rgb()/rgba(). */
const contrast = (fg: string, bg: string): number => {
  const lum = (css: string): number => {
    const [r, g, b] = (css.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map((v) => {
      const c = Number(v) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  };
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

test('"prossimo: …" porta il focus sull\'intestazione del barbiere e annuncia il giorno; giorno "senza posti" leggibile', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const service = await newService(api, data, 'Focus');
    const day = plusDays(today(), 3);
    const next = plusDays(day, 1);
    const full = plusDays(day, 2);
    const alfa = uniqueName('Alfa');
    // Alfa lavora solo il giorno dopo `day`; Beta lavora `day` e `full` (dove è tutto preso)
    await newBarber(api, data, service.id, alfa, { weekdays: [isoWeekday(next)], start: '09:00', end: '12:00' });
    const betaId = await newBarber(api, data, service.id, uniqueName('Beta'), {
      weekdays: [isoWeekday(day), isoWeekday(full)],
      start: '09:00',
      end: '09:30',
    });
    await insertBooking(api, data, {
      guest_name: 'Ospite e2e',
      guest_phone: '+393330000000',
      barber_id: betaId,
      service_id: service.id,
      starts_at: at(full, '09:00'),
      status: 'confirmed',
    });
    await signUpCustomer(page, api, 'focus');

    await page.goto(`/prenota/quando?servizio=${service.id}&giorno=${day}`);
    const alfaSection = main(page).locator('section').filter({ has: page.getByRole('heading', { name: alfa }) });
    await alfaSection.getByRole('link', { name: /^prossimo: / }).click();

    await expect(page.locator('main [aria-current="date"]')).toHaveAttribute('href', new RegExp(`giorno=${next}`));
    await expect(alfaSection.getByRole('heading', { name: alfa })).toBeFocused();
    const live = main(page).locator('[aria-live="polite"]');
    await expect(live).toHaveText(new RegExp(sf('booking.when.dayAnnounce', { day: '.+' })));

    // Giorno "senza posti": link, bordo tratteggiato, data con contrasto ≥ 4,5:1
    const fullDay = page.getByRole('navigation', { name: s('booking.time.daysLabel') }).locator(`a[href*="giorno=${full}"]`);
    await expect(fullDay).toBeVisible();
    const style = await fullDay.evaluate((el) => {
      const number = el.querySelector('.font-display') as HTMLElement;
      let bg = getComputedStyle(el).backgroundColor;
      for (let node: Element | null = el; node && /rgba\(0, 0, 0, 0\)|transparent/.test(bg); node = node.parentElement) {
        bg = getComputedStyle(node).backgroundColor;
      }
      return { border: getComputedStyle(el).borderStyle, color: getComputedStyle(number).color, bg };
    });
    expect(style.border).toBe('dashed');
    expect(contrast(style.color, style.bg), `${style.color} su ${style.bg}`).toBeGreaterThanOrEqual(4.5);
  } finally {
    await cleanup(api, data);
  }
});
