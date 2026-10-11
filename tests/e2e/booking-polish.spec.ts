// Test di accettazione e2e – FETTA 8b (rifinitura estetica). La fetta non è ancora in docs/SPEC.md:
// le regole vengono dalle decisioni approvate dall'utente ("8b: ...") e da SPEC §5.1 (home e prossima
// prenotazione), §5.2 (flusso di prenotazione), §5.3 (Le mie prenotazioni), §9 (tap target ≥ 44px,
// testi in italiano), CLAUDE.md Sicurezza (solo dati propri, RLS) e docs/DESIGN.md (movimento).
//
// Rotte attese:
//   /prenotazioni/<id>/confermata      pagina di conferma, solo per il cliente proprietario: di un altro
//                                      cliente o inesistente → 404; propria cancellata o passata →
//                                      redirect a /prenotazioni
//   /prenotazioni/<id>/calendario.ics  GET, solo prenotazioni proprie confermate e future (altrimenti
//                                      404); anonimo → login; text/calendar; charset=utf-8, attachment
// Testi attesi in src/i18n/it.ts ({when}, {date}, {count} segnaposto):
//   it.booking.service.title "Il listino", it.booking.service.subtitle "Scegli il servizio",
//   it.booking.barber.title "Con chi?", it.booking.barber.any "Nessuna preferenza",
//   it.booking.confirmation.{ title, seeYou "Ci vediamo {when}", today, tomorrow, onDate "il {date}",
//     addToCalendar, myBookings, backHome },
//   it.home.ticket.{ title, today, tomorrow, inDays "Tra {count} giorni", manage "Gestisci" },
//   it.home.noBooking, it.home.withBarber, it.booking.list.empty, it.booking.list.emptyCta "Prenota".
// Nome accessibile di ogni servizio del listino: "<nome>, <durata>, <prezzo>" con la durata di
// it.booking.duration ("30 min") e il prezzo di formatCents ("20,00 €").
//
// Prerequisiti: come tests/e2e/booking.spec.ts (Supabase locale con il seed, Mailpit). Dati creati
// per ogni test tramite l'admin demo (RLS attiva) e rimossi alla fine; clienti nuovi con email univoche.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { it as itLocale } from 'date-fns/locale';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

import {
  SEED,
  adminApi,
  cleanup,
  createService,
  expectPath,
  pathOf,
  s,
  sf,
  uniqueEmail,
  uniqueName,
  type AdminApi,
} from './admin-helpers';
import { confirmHref, newestEmailId, waitForNewEmail } from './mailpit';

const TZ = 'Europe/Rome';
const TIME = /^\d{2}:\d{2}$/;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CONFIRMATION = new RegExp(`^/prenotazioni/(${UUID})/confermata$`);
const UID_HOST = 'mosca-barber-shop';

// ---------------------------------------------------------------------------
// Login del cliente (magic link via Mailpit), come in booking.spec.ts
// ---------------------------------------------------------------------------
const latestConfirmLink = async (request: APIRequestContext, to: string, previousId: string | null): Promise<string> => {
  const href = confirmHref(await waitForNewEmail(request, to, previousId));
  expect(href, "link /auth/confirm nell'email").toBeDefined();
  const url = new URL(href ?? 'http://invalid.invalid');
  return `${url.pathname}${url.search}`;
};

/** Cliente nuovo con profilo completo, già loggato in `page`; restituisce l'id del profilo. */
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
  const rows = await api.get<Array<{ id: string }>>(`/rest/v1/profiles?select=id&full_name=eq.${encodeURIComponent(fullName)}`);
  expect(rows).toHaveLength(1);
  return rows[0]?.id ?? '';
};

// ---------------------------------------------------------------------------
// Dati di prova
// ---------------------------------------------------------------------------
type Created = { services: string[]; barbers: string[]; bookings: string[] };

/** Barbieri (con bio facoltativa) con orario 06:00–23:00 tutti i giorni, abilitati al servizio. */
const createBarbers = async (
  api: AdminApi,
  data: Created,
  serviceId: string,
  barbers: Array<{ name: string; bio?: string }>,
): Promise<string[]> => {
  const ids: string[] = [];
  for (const barber of barbers) {
    const [row] = await api.post<Array<{ id: string }>>('/rest/v1/barbers?select=id', {
      display_name: barber.name,
      bio: barber.bio ?? null,
      is_active: true,
    });
    const id = row?.id ?? '';
    data.barbers.push(id);
    ids.push(id);
    await api.post('/rest/v1/barber_services?select=barber_id', { barber_id: id, service_id: serviceId });
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

/** Prenotazione di un cliente inserita dall'admin (anche passata o cancellata, ADR 001). */
const customerBooking = async (
  api: AdminApi,
  values: { customerId: string; barberId: string; serviceId: string; startsAt: string; status: string },
): Promise<string> => {
  const [row] = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
    customer_id: values.customerId,
    barber_id: values.barberId,
    service_id: values.serviceId,
    starts_at: values.startsAt,
    source: 'manual',
    status: values.status,
  });
  return row?.id ?? '';
};

type BookingRow = { id: string; customer_id: string | null; barber_id: string; starts_at: string; ends_at: string };
const bookingsOfService = (api: AdminApi, serviceId: string): Promise<BookingRow[]> =>
  api.get<BookingRow[]>(`/rest/v1/bookings?select=id,customer_id,barber_id,starts_at,ends_at&service_id=eq.${serviceId}`);

const shopSettings = async (api: AdminApi): Promise<{ name: string; address: string | null }> => {
  const [row] = await api.get<Array<{ name: string; address: string | null }>>('/rest/v1/shop_settings?select=name,address');
  return { name: row?.name ?? '', address: row?.address ?? null };
};

// ---------------------------------------------------------------------------
// Date nella timezone del negozio
// ---------------------------------------------------------------------------
const localDate = (instant: Date | string): string => formatInTimeZone(new Date(instant), TZ, 'yyyy-MM-dd');
const localDay = (offsetDays: number): string => {
  const d = new Date(`${localDate(new Date())}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};
/** Giorni di calendario fra oggi e l'istante, a Roma. */
const calendarDaysFromToday = (instant: string): number =>
  (Date.parse(`${localDate(instant)}T00:00:00Z`) - Date.parse(`${localDate(new Date())}T00:00:00Z`)) / 86_400_000;

/** Conto alla rovescia atteso nel biglietto della home (8b). */
const expectedCountdown = (instant: string): string => {
  const days = calendarDaysFromToday(instant);
  if (days === 0) return s('home.ticket.today');
  if (days === 1) return s('home.ticket.tomorrow');
  return sf('home.ticket.inDays', { count: days });
};

/** "Ci vediamo <...>" atteso nella pagina di conferma (8b). */
const expectedSeeYou = (instant: string): string => {
  const days = calendarDaysFromToday(instant);
  const when =
    days === 0
      ? s('booking.confirmation.today')
      : days === 1
        ? s('booking.confirmation.tomorrow')
        : days <= 6
          ? formatInTimeZone(new Date(instant), TZ, 'EEEE', { locale: itLocale })
          : sf('booking.confirmation.onDate', { date: formatInTimeZone(new Date(instant), TZ, 'd MMMM', { locale: itLocale }) });
  return sf('booking.confirmation.seeYou', { when });
};

const icsUtc = (instant: string): string => new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsEscape = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const unfold = (body: string): string => body.replace(/\r\n[ \t]/g, '');

// ---------------------------------------------------------------------------
// Interfaccia
// ---------------------------------------------------------------------------
const main = (page: Page): Locator => page.locator('main');

const tap = async (locator: Locator): Promise<void> => {
  await expect(locator).toBeVisible();
  await locator.click();
};

const expectTapTarget = async (locator: Locator, label: string): Promise<void> => {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} visibile`).not.toBeNull();
  expect(box?.height ?? 0, `${label}: altezza ≥ 44px (SPEC §9)`).toBeGreaterThanOrEqual(44);
};

const lastSlot = (page: Page): Locator =>
  main(page).getByRole('button', { name: TIME }).or(main(page).getByRole('link', { name: TIME })).last();

const confirmButton = (page: Page): Locator =>
  page.getByRole('button', { name: s('booking.summary.confirm'), exact: true });

/** Id della prenotazione dalla pagina di conferma (attende l'URL /prenotazioni/<id>/confermata). */
const confirmationId = async (page: Page): Promise<string> => {
  await expect.poll(() => pathOf(page), { message: 'percorso atteso: /prenotazioni/<id>/confermata' }).toMatch(CONFIRMATION);
  return CONFIRMATION.exec(pathOf(page))?.[1] ?? '';
};

// ---------------------------------------------------------------------------
// 1. Flusso completo (8b: listino, barbieri, conferma, stato vuoto, biglietto in home)
// ---------------------------------------------------------------------------
test('flusso 8b: stato vuoto, listino, "Con chi?", pagina di conferma con .ics, Le mie prenotazioni e biglietto in home', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const service = await newService(api, data, 'Listino');
    const barberNames = [uniqueName('Primo'), uniqueName('Secondo')];
    const bioFirstLine = 'Sfumature e barba alla vecchia maniera';
    const bioHidden = 'Riga della bio da non mostrare';
    const barbers = await createBarbers(api, data, service.id, [
      { name: barberNames[0] ?? '', bio: `\n  ${bioFirstLine}  \n${bioHidden}` },
      { name: barberNames[1] ?? '' },
    ]);
    const customerId = await signUpCustomer(page, api, 'rifinitura');
    const shop = await shopSettings(api);

    // 8b, SPEC §5.1: senza prenotazioni la home resta col blocco "Nessuna prenotazione", senza biglietto
    await expect(main(page).getByText(s('home.noBooking'))).toBeVisible();
    await expect(main(page).getByText(s('home.ticket.title'))).toHaveCount(0);

    // 8b, SPEC §5.3: stato vuoto di "Le mie prenotazioni" con testo, invito "Prenota" e mosca
    await page.goto('/prenotazioni');
    await expect(main(page).getByText(s('booking.list.empty'))).toBeVisible();
    await expect(main(page).getByTestId('fly').first()).toBeVisible();
    const emptyCta = main(page).getByRole('link', { name: s('booking.list.emptyCta'), exact: true });
    await expect(emptyCta).toHaveAttribute('href', '/prenota');
    await expectTapTarget(emptyCta, 'invito "Prenota" dello stato vuoto');
    await tap(emptyCta);

    // 8b, SPEC §5.2: il listino
    await expectPath(page, '/prenota');
    await expect(page.getByRole('heading', { level: 1, name: s('booking.service.title') })).toBeVisible();
    await expect(main(page).getByText(s('booking.service.subtitle'), { exact: true })).toBeVisible();
    const serviceLink = main(page).getByRole('link', {
      name: `${service.name}, ${sf('booking.duration', { count: 30 })}, 20,00 €`,
      exact: true,
    });
    await expectTapTarget(serviceLink, 'servizio del listino');
    await tap(serviceLink);

    // 8b, SPEC §5.2: "Con chi?", "Nessuna preferenza" prima dei barbieri, prima riga della bio
    await expectPath(page, '/prenota/barbiere');
    await expect(page.getByRole('heading', { level: 1, name: s('booking.barber.title') })).toBeVisible();
    const linkTexts = await main(page)
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.textContent ?? ''));
    const anyIndex = linkTexts.findIndex((t) => t.includes(s('booking.barber.any')));
    const barberIndexes = barberNames.map((name) => linkTexts.findIndex((t) => t.includes(name)));
    expect(anyIndex, '"Nessuna preferenza" presente').toBeGreaterThanOrEqual(0);
    for (const index of barberIndexes) {
      expect(index, 'barbiere presente').toBeGreaterThanOrEqual(0);
      expect(anyIndex, '"Nessuna preferenza" in cima').toBeLessThan(index);
    }
    const chosen = main(page).getByRole('link', { name: new RegExp(barberNames[0] ?? '') });
    await expect(chosen).toContainText(bioFirstLine);
    await expect(main(page).getByText(bioHidden)).toHaveCount(0);
    await expectTapTarget(chosen, 'scheda del barbiere');
    await tap(chosen);

    await expectPath(page, '/prenota/orario');
    await expect(lastSlot(page)).toBeVisible();
    const time = (await lastSlot(page).innerText()).trim();
    await tap(lastSlot(page));
    await expectPath(page, '/prenota/riepilogo');
    await tap(confirmButton(page));

    // 8b: pagina di conferma /prenotazioni/<id>/confermata
    const id = await confirmationId(page);
    const rows = await bookingsOfService(api, service.id);
    data.bookings.push(...rows.map((r) => r.id));
    expect(rows).toHaveLength(1);
    const booking = rows[0] as BookingRow;
    expect(booking).toMatchObject({ id, customer_id: customerId, barber_id: barbers[0] });
    expect(formatInTimeZone(new Date(booking.starts_at), TZ, 'HH:mm')).toBe(time);

    await expect(page.getByRole('heading', { name: s('booking.confirmation.title') })).toBeVisible();
    await expect(main(page).getByText(expectedSeeYou(booking.starts_at), { exact: true })).toBeVisible();
    await expect(main(page)).toContainText(formatInTimeZone(new Date(booking.starts_at), TZ, 'd MMMM', { locale: itLocale }));
    await expect(main(page)).toContainText(time);
    await expect(main(page)).toContainText(service.name);
    await expect(main(page)).toContainText(barberNames[0] ?? '');
    await expect(main(page)).toContainText(shop.name);
    if (shop.address) await expect(main(page)).toContainText(shop.address);

    const addToCalendar = main(page).getByRole('link', { name: s('booking.confirmation.addToCalendar'), exact: true });
    const myBookings = main(page).getByRole('link', { name: s('booking.confirmation.myBookings'), exact: true });
    const backHome = main(page).getByRole('link', { name: s('booking.confirmation.backHome'), exact: true });
    await expect(addToCalendar).toHaveAttribute('href', `/prenotazioni/${id}/calendario.ics`);
    await expect(myBookings).toHaveAttribute('href', '/prenotazioni');
    await expect(backHome).toHaveAttribute('href', '/');
    await expectTapTarget(addToCalendar, '"Aggiungi al calendario"');
    await expectTapTarget(myBookings, '"Le mie prenotazioni"');
    await expectTapTarget(backHome, '"Torna alla home"');

    // 8b: il proprietario scarica il file .ics
    const ics = await page.request.get(`/prenotazioni/${id}/calendario.ics`, { maxRedirects: 0 });
    expect(ics.status()).toBe(200);
    expect(ics.headers()['content-type']?.toLowerCase().replace(/\s+/g, '')).toBe('text/calendar;charset=utf-8');
    expect(ics.headers()['content-disposition']).toMatch(/^attachment;\s*filename="[^"]+\.ics"$/);
    const body = unfold(await ics.text());
    expect(body).toContain(`\r\nUID:${id}@${UID_HOST}\r\n`);
    expect(body).toContain(`\r\nSUMMARY:${icsEscape(service.name)} – ${icsEscape(shop.name)}\r\n`);
    expect(body).toContain(`\r\nDTSTART:${icsUtc(booking.starts_at)}\r\n`);
    expect(body).toContain(`\r\nDTEND:${icsUtc(booking.ends_at)}\r\n`);
    if (shop.address) expect(body).toContain(`\r\nLOCATION:${icsEscape(shop.address)}\r\n`);

    // SPEC §5.3: "Le mie prenotazioni" mostra la prenotazione
    await tap(myBookings);
    await expectPath(page, '/prenotazioni');
    const item = main(page).getByRole('listitem').filter({ hasText: service.name });
    await expect(item).toBeVisible();
    await expect(item).toContainText(barberNames[0] ?? '');
    await expect(item).toContainText(time);
    await expect(main(page).getByText(s('booking.list.empty'))).toHaveCount(0);

    // 8b, SPEC §5.1: biglietto della prossima prenotazione in home
    await page.goto('/');
    await expect(main(page).getByText(s('home.ticket.title'))).toBeVisible();
    await expect(main(page).getByText(expectedCountdown(booking.starts_at), { exact: true })).toBeVisible();
    await expect(main(page)).toContainText(sf('home.withBarber', { service: service.name, barber: barberNames[0] ?? '' }));
    await expect(main(page)).toContainText(time);
    const manage = main(page).getByRole('link', { name: s('home.ticket.manage'), exact: true });
    await expect(manage).toHaveAttribute('href', '/prenotazioni');
    await expectTapTarget(manage, '"Gestisci"');
    await expect(main(page).getByText(s('home.noBooking'))).toHaveCount(0);
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 2. Accesso alla conferma e al file .ics (8b; CLAUDE.md Sicurezza)
// ---------------------------------------------------------------------------
test('conferma e .ics solo per il proprietario: altro cliente o id inesistente 404, cancellata o passata → /prenotazioni, anonimo → login', async ({
  page,
  request,
  playwright,
  baseURL,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const service = await newService(api, data, 'Accesso');
    const [barber] = await createBarbers(api, data, service.id, [{ name: uniqueName('Barbiere') }]);
    const customerId = await signUpCustomer(page, api, 'accesso');
    const at = (offset: number, time: string): string => fromZonedTime(`${localDay(offset)}T${time}:00`, TZ).toISOString();
    const base = { barberId: barber ?? '', serviceId: service.id };

    const other = await customerBooking(api, { ...base, customerId: SEED.customerProfile, startsAt: at(4, '10:00'), status: 'confirmed' });
    const cancelled = await customerBooking(api, { ...base, customerId, startsAt: at(4, '11:00'), status: 'cancelled_by_shop' });
    const past = await customerBooking(api, { ...base, customerId, startsAt: at(-2, '10:00'), status: 'confirmed' });
    data.bookings.push(other, cancelled, past);
    const missing = '00000000-0000-4000-8000-0000000008b0';

    // Prenotazione di un altro cliente e id inesistente: 404 per pagina e file
    for (const id of [other, missing]) {
      const confirmation = await page.goto(`/prenotazioni/${id}/confermata`);
      expect(confirmation?.status(), `pagina di conferma ${id}`).toBe(404);
      const ics = await page.request.get(`/prenotazioni/${id}/calendario.ics`, { maxRedirects: 0 });
      expect(ics.status(), `file .ics ${id}`).toBe(404);
    }

    // Propria cancellata o passata: la pagina rimanda a "Le mie prenotazioni", il file non esiste
    for (const id of [cancelled, past]) {
      await page.goto(`/prenotazioni/${id}/confermata`);
      await expectPath(page, '/prenotazioni');
      const ics = await page.request.get(`/prenotazioni/${id}/calendario.ics`, { maxRedirects: 0 });
      expect(ics.status(), `file .ics ${id}`).toBe(404);
    }

    // Anonimo: mandato al login
    const anonymous = await playwright.request.newContext({ baseURL });
    try {
      for (const path of [`/prenotazioni/${other}/calendario.ics`, `/prenotazioni/${other}/confermata`]) {
        const response = await anonymous.get(path, { maxRedirects: 0 });
        expect(response.status(), `${path}: redirect`).toBeGreaterThanOrEqual(300);
        expect(response.status(), `${path}: redirect`).toBeLessThan(400);
        const location = response.headers()['location'] ?? '';
        expect(new URL(location, baseURL).pathname).toBe('/accedi');
      }
    } finally {
      await anonymous.dispose();
    }
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 3. Movimento ridotto sulla pagina di conferma (8b; docs/DESIGN.md)
// ---------------------------------------------------------------------------
test.describe('con prefers-reduced-motion: reduce', () => {
  test.use({ reducedMotion: 'reduce' });

  test('la mosca della pagina di conferma non si anima', async ({ page, request }) => {
    const api = await adminApi(request);
    const data: Created = { services: [], barbers: [], bookings: [] };
    try {
      const service = await newService(api, data, 'Movimento');
      const [barber] = await createBarbers(api, data, service.id, [{ name: uniqueName('Barbiere') }]);
      await signUpCustomer(page, api, 'movimento');

      const startsAt = fromZonedTime(`${localDay(3)}T10:00:00`, TZ).toISOString();
      await page.goto(`/prenota/riepilogo?servizio=${service.id}&barbiere=${barber}&inizio=${encodeURIComponent(startsAt)}`);
      await tap(confirmButton(page));
      const id = await confirmationId(page);
      data.bookings.push(id);
      await page.waitForLoadState('networkidle');

      const fly = main(page).getByTestId('fly');
      await expect(fly.first()).toBeVisible();

      // Nessuna animazione CSS/Web Animations sulla mosca e sui suoi discendenti
      const animations = await fly.evaluateAll((elements) =>
        elements.flatMap((el) =>
          el.getAnimations({ subtree: true }).map((a) => `${a.constructor.name} ${(a as CSSAnimation).animationName ?? ''}`),
        ),
      );
      expect(animations).toEqual([]);

      // Nessun movimento guidato da JavaScript: posizione e transform stabili per ~30 frame
      const frames = await fly.first().evaluate(
        (el) =>
          new Promise<string[]>((done) => {
            const samples: string[] = [];
            const sample = (): void => {
              const r = el.getBoundingClientRect();
              samples.push(`${r.x},${r.y},${r.width},${r.height},${getComputedStyle(el).transform}`);
              if (samples.length < 30) requestAnimationFrame(sample);
              else done(samples);
            };
            requestAnimationFrame(sample);
          }),
      );
      expect(new Set(frames).size, `campioni: ${[...new Set(frames)].join(' | ')}`).toBe(1);
    } finally {
      await cleanup(api, data);
    }
  });
});
