// Test di accettazione e2e – FETTA 8k (rifiniture di stile dell'area clienti).
// Fonte: docs/audit/2026-10-31-taste.md, sezione "Area clienti" (escluso Profilo), e decisioni
// approvate dall'utente per la fetta ("8k.N" è il numero della decisione); SPEC §5.1 (home), §5.2
// (flusso di prenotazione), §5.3 (Le mie prenotazioni), §9 (tap target ≥ 44 px, testi in it.ts).
// La logica pura (mapsHref) e i testi nuovi sono in tests/acceptance/customer-polish-8k.test.ts.
// Gli aspetti solo visivi dell'audit (dissolvenze, mosca, rientri, pesi, font) non si verificano.
//
// Contratto del DOM:
//   - testata (role banner) del cliente: link it.nav.bookings, link it.nav.profile, poi "Esci"
//     (it.auth.logout) che resta un <button> dentro un <form>, con l'aspetto di un link: nessun
//     bordo visibile (larghezza 0, stile none o colore trasparente su tutti i lati). Su /accedi
//     nessun link it.nav.login nella testata.
//   - margine: a 390×844 l'h1 di main parte a x = 16 su home, /accedi, /profilo/completa, /prenota,
//     /prenota/quando, /prenota/riepilogo, /prenotazioni/<id>/confermata, /prenotazioni; a 1280×800
//     l'h1 è alla stessa x su tutte (tranne "Quando?", più larga). Su /accedi e /profilo/completa il
//     modulo (main form) parte alla x dell'h1 ed è largo al massimo 384 px.
//   - home, "Dove siamo": l'indirizzo è un link a mapsHref(indirizzo), target="_blank",
//     rel con "noopener" e "noreferrer".
//   - /accedi: placeholder it.auth.customerLogin.emailPlaceholder; sotto il pulsante d'invio la riga
//     it.auth.customerLogin.firstAccess.
//   - "Quando?": il monogramma di un barbiere senza foto ha il bordo pieno (border-style solid).
//   - riepilogo: due coppie <dt>/<dd> separate, it.booking.summary.price (solo il prezzo) e
//     it.booking.summary.duration (solo la durata, it.booking.duration).
//   - conferma: "Aggiungi al calendario" e "Le mie prenotazioni" con bordo, "Torna alla home" senza.
//   - Le mie prenotazioni: in "In programma" la prima voce ha la classe glass-ink, le altre no; le voci
//     passate non hanno bordo sinistro né superiore e hanno il colore di text-muted-foreground.
//   - ovunque, a 390×844: nessuno sforamento orizzontale e ogni controllo visibile di testata e main
//     almeno 44×44 px (la casella si misura sulla sua etichetta); a 1280×800 nessuno sforamento.
//
// Prerequisiti: Supabase locale con il seed, Mailpit. Dati creati per ogni test tramite l'admin demo
// (RLS attiva) e rimossi alla fine; clienti nuovi con email univoche; date da testDate().
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import {
  DESKTOP,
  adminApi,
  cleanup,
  createService,
  euro,
  expectPath,
  pathOf,
  romeWinter,
  s,
  sf,
  testDate,
  plusDays,
  uniqueEmail,
  uniqueName,
  type AdminApi,
} from './admin-helpers';
import { confirmHref, newestEmailId, waitForNewEmail } from './mailpit';
import { selectedDate, whenColumn } from './when-row-helpers';

const PHONE = { width: 390, height: 844 };
const MARGIN = 16;
const FORM_MAX_WIDTH = 384;
const SLOT = /^\d{1,2}:\d{2} con .+$/;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CONFIRMATION = new RegExp(`^/prenotazioni/(${UUID})/confermata$`);

test.use({ viewport: PHONE });

// ---------------------------------------------------------------------------
// Interfaccia
// ---------------------------------------------------------------------------
const main = (page: Page): Locator => page.locator('main');
const banner = (page: Page): Locator => page.getByRole('banner');
const mainHeading = (page: Page): Locator => main(page).locator('h1').first();

const box = async (locator: Locator, label: string): Promise<{ x: number; y: number; width: number; height: number }> => {
  await expect(locator, `${label} visibile`).toBeVisible();
  const value = await locator.boundingBox();
  expect(value, `${label}: senza riquadro`).not.toBeNull();
  return value ?? { x: 0, y: 0, width: 0, height: 0 };
};

const pageOverflow = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Controlli visibili di testata e main sotto i 44×44 px, come "descrizione: LxA" (SPEC §9). */
const smallControls = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const selector = 'a[href], button, select, textarea, input:not([type="hidden"])';
    const controls = [
      ...document.querySelectorAll(`header :is(${selector})`),
      ...document.querySelectorAll(`main :is(${selector})`),
    ];
    return controls.flatMap((control) => {
      const style = getComputedStyle(control);
      if (style.display === 'none' || style.visibility === 'hidden' || control.getClientRects().length === 0) return [];
      // La casella (o il radio) si tocca sulla sua etichetta
      const isCheck = control instanceof HTMLInputElement && (control.type === 'checkbox' || control.type === 'radio');
      const measured = (isCheck ? control.closest('label') : null) ?? control;
      const rect = measured.getBoundingClientRect();
      if (Math.round(rect.height) >= 44 && Math.round(rect.width) >= 44) return [];
      const name = control.getAttribute('aria-label') ?? ((control.textContent ?? '').trim().slice(0, 40) || control.id);
      return [`${control.tagName.toLowerCase()} "${name}": ${Math.round(rect.width)}x${Math.round(rect.height)}`];
    });
  });

type Sides = Record<'top' | 'right' | 'bottom' | 'left', { width: string; style: string; color: string }>;

const borderOf = (locator: Locator): Promise<Sides> =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const side = (name: 'Top' | 'Right' | 'Bottom' | 'Left') => ({
      width: style.getPropertyValue(`border-${name.toLowerCase()}-width`),
      style: style.getPropertyValue(`border-${name.toLowerCase()}-style`),
      color: style.getPropertyValue(`border-${name.toLowerCase()}-color`),
    });
    return { top: side('Top'), right: side('Right'), bottom: side('Bottom'), left: side('Left') };
  });

const transparent = (color: string): boolean =>
  color === 'transparent' || /^rgba\(.*,\s*0\)$/.test(color) || /\/\s*0\)$/.test(color);

/** Lati con un bordo visibile: larghezza > 0, stile diverso da none/hidden, colore non trasparente. */
const visibleBorderSides = (sides: Sides): string[] =>
  Object.entries(sides)
    .filter(([, side]) => parseFloat(side.width) > 0 && side.style !== 'none' && side.style !== 'hidden' && !transparent(side.color))
    .map(([name]) => name);

/**
 * Controlli comuni a ogni pagina (8k.2 e 8k.9): a 390×844 h1 a 16 px, niente sforamento, controlli
 * ≥ 44 px; a 1280×800 niente sforamento. Restituisce la x dell'h1 a 1280 (per il confronto fra
 * pagine). Con `form`, il modulo parte alla x dell'h1 ed è largo al massimo 384 px. Torna a 390×844.
 */
const checkLayout = async (page: Page, label: string, options: { form?: boolean } = {}): Promise<number> => {
  await page.setViewportSize(PHONE);
  const heading = mainHeading(page);
  const phone = await box(heading, `${label}: h1`);
  expect.soft(Math.round(phone.x), `${label}: h1 a ${MARGIN} px dal bordo a 390 (8k.2)`).toBe(MARGIN);
  expect.soft(await pageOverflow(page), `${label}: sforamento orizzontale a 390 (8k.9)`).toBeLessThanOrEqual(0);
  expect.soft(await smallControls(page), `${label}: controlli sotto i 44 px a 390 (8k.9, SPEC §9)`).toEqual([]);
  if (options.form) {
    const form = await box(main(page).locator('form').first(), `${label}: modulo`);
    expect.soft(Math.round(form.x), `${label}: modulo a ${MARGIN} px dal bordo a 390 (8k.2)`).toBe(MARGIN);
  }

  await page.setViewportSize(DESKTOP);
  const desktop = await box(heading, `${label}: h1 a 1280`);
  expect.soft(await pageOverflow(page), `${label}: sforamento orizzontale a 1280 (8k.9)`).toBeLessThanOrEqual(0);
  if (options.form) {
    const form = await box(main(page).locator('form').first(), `${label}: modulo a 1280`);
    expect.soft(Math.round(form.x), `${label}: modulo allineato all'h1 a 1280 (8k.2)`).toBe(Math.round(desktop.x));
    expect.soft(form.width, `${label}: modulo largo al massimo ${FORM_MAX_WIDTH} px a 1280 (8k.2)`).toBeLessThanOrEqual(FORM_MAX_WIDTH);
  }
  await page.setViewportSize(PHONE);
  return Math.round(desktop.x);
};

// ---------------------------------------------------------------------------
// Login del cliente (magic link via Mailpit), come in booking-polish.spec.ts
// ---------------------------------------------------------------------------
const latestConfirmLink = async (request: APIRequestContext, to: string, previousId: string | null): Promise<string> => {
  const href = confirmHref(await waitForNewEmail(request, to, previousId));
  expect(href, "link /auth/confirm nell'email").toBeDefined();
  const url = new URL(href ?? 'http://invalid.invalid');
  return `${url.pathname}${url.search}`;
};

/**
 * Cliente nuovo, già loggato in `page`, con profilo completo; `onCompleteProfile` gira su
 * /profilo/completa prima di compilarlo. Restituisce l'id del profilo.
 */
const signUpCustomer = async (
  page: Page,
  api: AdminApi,
  label: string,
  onCompleteProfile: () => Promise<void> = async () => {},
): Promise<string> => {
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
  await onCompleteProfile();
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

const newService = async (api: AdminApi, data: Created): Promise<{ id: string; name: string }> => {
  const name = uniqueName('Rifinitura');
  const id = await createService(api, { name, durationMin: 30, priceCents: 2000 });
  data.services.push(id);
  return { id, name };
};

/** Barbiere senza foto, abilitato al servizio, con orario 06:00–23:00 tutti i giorni. */
const newBarber = async (api: AdminApi, data: Created, serviceId: string): Promise<{ id: string; name: string }> => {
  const name = uniqueName('Barbiere');
  const [row] = await api.post<Array<{ id: string }>>('/rest/v1/barbers?select=id', { display_name: name, is_active: true });
  const id = row?.id ?? '';
  data.barbers.push(id);
  await api.post('/rest/v1/barber_services?select=barber_id', { barber_id: id, service_id: serviceId });
  await api.post(
    '/rest/v1/working_hours?select=id',
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ barber_id: id, weekday, start_time: '06:00', end_time: '23:00' })),
  );
  return { id, name };
};

/** Prenotazione del cliente inserita dall'admin (anche passata e completata, ADR 001). */
const customerBooking = async (
  api: AdminApi,
  values: { customerId: string; barberId: string; serviceId: string; startsAt: string; status: 'confirmed' | 'completed' },
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

const shopAddress = async (api: AdminApi): Promise<string | null> => {
  const [row] = await api.get<Array<{ address: string | null }>>('/rest/v1/shop_settings?select=address');
  return row?.address ?? null;
};

// ---------------------------------------------------------------------------
// 1. Anonimo: home e Accedi
// ---------------------------------------------------------------------------
test('8k anonimo: home con l\'indirizzo che apre le mappe, Accedi con margine da 16 px, esempio nel campo e riga sul primo accesso', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const address = await shopAddress(api);
  expect(address, 'indirizzo del negozio nel seed (supabase/seed.sql)').toBeTruthy();

  // --- Home ---
  await page.goto('/');
  const homeX = await checkLayout(page, 'home');

  // 8k.3, SPEC §5.1: in "Dove siamo" l'indirizzo apre le mappe in una nuova scheda
  const where = main(page)
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: s('home.whereTitle'), exact: true }) });
  const mapsLink = where.getByRole('link', { name: address ?? '', exact: true });
  await expect(mapsLink).toBeVisible();
  await expect(mapsLink).toHaveAttribute(
    'href',
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((address ?? '').trim())}`,
  );
  await expect(mapsLink).toHaveAttribute('target', '_blank');
  const rel = ((await mapsLink.getAttribute('rel')) ?? '').split(/\s+/);
  expect(rel, 'rel del link alle mappe').toContain('noopener');
  expect(rel, 'rel del link alle mappe').toContain('noreferrer');

  // --- Accedi ---
  await page.goto('/accedi');
  const loginX = await checkLayout(page, '/accedi', { form: true });
  expect.soft(loginX, '/accedi: h1 alla stessa x della home a 1280 (8k.2)').toBe(homeX);

  // 8k.1: "Accedi" non punta alla pagina in cui si è già
  await expect(banner(page)).toBeVisible();
  await expect(banner(page).getByRole('link', { name: s('nav.login'), exact: true })).toHaveCount(0);

  // 8k.4: esempio nel campo email e riga sul primo accesso sotto il pulsante
  const email = main(page).getByLabel(s('auth.customerLogin.emailLabel'), { exact: true });
  await expect(email).toHaveAttribute('placeholder', s('auth.customerLogin.emailPlaceholder'));
  const submit = await box(main(page).getByRole('button', { name: s('auth.customerLogin.submit'), exact: true }), 'pulsante di invio');
  const firstAccess = await box(main(page).getByText(s('auth.customerLogin.firstAccess'), { exact: true }), 'riga sul primo accesso');
  expect(firstAccess.y, 'riga sul primo accesso sotto il pulsante (8k.4)').toBeGreaterThanOrEqual(submit.y + submit.height);
});

// ---------------------------------------------------------------------------
// 2. Cliente: profilo, testata e flusso di prenotazione fino alla conferma
// ---------------------------------------------------------------------------
test('8k cliente: completa profilo, testata con "Esci" da link, listino, "Quando?" con monogramma pieno, riepilogo con Prezzo e Durata separati', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  const desktopX: Record<string, number> = {};
  try {
    const service = await newService(api, data);
    const barber = await newBarber(api, data, service.id);

    // 8k.2: /profilo/completa con lo stesso margine, modulo allineato a sinistra
    await signUpCustomer(page, api, 'rifiniture', async () => {
      desktopX['/profilo/completa'] = await checkLayout(page, '/profilo/completa', { form: true });
    });

    // --- Home del cliente e testata ---
    desktopX['home'] = await checkLayout(page, 'home (cliente)');

    // 8k.1: Prenotazioni, Profilo, poi "Esci": un pulsante in un form, con l'aspetto di un link
    const bookingsLink = banner(page).getByRole('link', { name: s('nav.bookings'), exact: true });
    const profileLink = banner(page).getByRole('link', { name: s('nav.profile'), exact: true });
    const logout = banner(page).locator('form').getByRole('button', { name: s('auth.logout'), exact: true });
    await expect(banner(page).getByRole('link', { name: s('auth.logout'), exact: true })).toHaveCount(0);
    const order = [await box(bookingsLink, 'Prenotazioni'), await box(profileLink, 'Profilo'), await box(logout, 'Esci')];
    expect(order[0]?.x ?? 0, 'Prenotazioni prima di Profilo').toBeLessThan(order[1]?.x ?? 0);
    expect(order[1]?.x ?? 0, 'Profilo prima di Esci').toBeLessThan(order[2]?.x ?? 0);
    expect(visibleBorderSides(await borderOf(logout)), '"Esci" senza bordo (8k.1)').toEqual([]);

    // --- Listino ---
    await page.goto('/prenota');
    desktopX['/prenota'] = await checkLayout(page, '/prenota');
    await main(page)
      .getByRole('link', { name: `${service.name}, ${sf('booking.duration', { count: 30 })}, 20,00 €`, exact: true })
      .click();

    // --- "Quando?" (più larga: niente confronto della x a 1280) ---
    await expectPath(page, '/prenota/quando');
    const day = await selectedDate(page);
    const column = whenColumn(page, barber.name, day);
    await expect(column).toBeVisible();
    await checkLayout(page, '/prenota/quando');

    // 8k.5: il monogramma del barbiere senza foto ha il bordo pieno, non tratteggiato
    const monogram = column.locator('[aria-hidden="true"]').getByText(barber.name.charAt(0), { exact: true });
    await expect(monogram).toBeVisible();
    const monogramBorder = await borderOf(monogram);
    for (const [side, value] of Object.entries(monogramBorder)) {
      expect.soft(value.style, `monogramma, bordo ${side}: pieno (8k.5)`).toBe('solid');
    }
    expect(visibleBorderSides(monogramBorder), 'il monogramma ha un bordo').not.toEqual([]);

    const slot = column.getByRole('button', { name: SLOT }).or(column.getByRole('link', { name: SLOT })).last();
    await expect(slot).toBeVisible();
    await slot.click();

    // --- Riepilogo ---
    await expectPath(page, '/prenota/riepilogo');
    desktopX['/prenota/riepilogo'] = await checkLayout(page, '/prenota/riepilogo');

    // 8k.6: Prezzo e Durata in due coppie dt/dd separate
    const pairs = await main(page)
      .locator('dl')
      .first()
      .evaluate((dl) =>
        [...dl.querySelectorAll('dt')].map((dt) => ({
          label: (dt.textContent ?? '').trim(),
          next: dt.nextElementSibling?.tagName.toLowerCase() ?? '',
          value: (dt.nextElementSibling?.textContent ?? '').trim(),
        })),
      );
    const price = pairs.find((pair) => pair.label === s('booking.summary.price'));
    const duration = pairs.find((pair) => pair.label === s('booking.summary.duration'));
    expect(price, `coppia ${s('booking.summary.price')}: ${JSON.stringify(pairs)}`).toBeDefined();
    expect(duration, `coppia "Durata": ${JSON.stringify(pairs)}`).toBeDefined();
    expect(price?.next).toBe('dd');
    expect(duration?.next).toBe('dd');
    expect(price?.value ?? '', 'Prezzo: il prezzo').toMatch(euro('20,00 €'));
    expect(price?.value ?? '', 'Prezzo: senza la durata').not.toContain(sf('booking.duration', { count: 30 }));
    expect(duration?.value ?? '', 'Durata: la durata').toBe(sf('booking.duration', { count: 30 }));

    await page.getByRole('button', { name: s('booking.summary.confirm'), exact: true }).click();
    await expect.poll(() => pathOf(page), { message: 'percorso atteso: /prenotazioni/<id>/confermata' }).toMatch(CONFIRMATION);
    data.bookings.push(CONFIRMATION.exec(pathOf(page))?.[1] ?? '');

    // 8k.2: stessa x dell'h1 a 1280 su tutte le pagine del flusso (tranne "Quando?")
    for (const [path, x] of Object.entries(desktopX)) {
      expect.soft(x, `${path}: h1 alla stessa x della home a 1280 (8k.2)`).toBe(desktopX['home']);
    }
  } finally {
    await cleanup(api, data);
  }
});

// ---------------------------------------------------------------------------
// 3. Cliente: conferma e Le mie prenotazioni
// ---------------------------------------------------------------------------
test('8k cliente: conferma con "Torna alla home" senza bordo; Le mie prenotazioni con la prossima in glass-ink e le passate attenuate', async ({
  page,
  request,
}) => {
  const api = await adminApi(request);
  const data: Created = { services: [], barbers: [], bookings: [] };
  try {
    const service = await newService(api, data);
    const barber = await newBarber(api, data, service.id);
    const customerId = await signUpCustomer(page, api, 'mie-prenotazioni');
    await page.goto('/');
    const homeX = await checkLayout(page, 'home (cliente)');

    // Due prenotazioni in programma e una passata completata (8k.8)
    const future = testDate();
    const past = testDate({ fromYear: 2012, toYear: 2024 });
    const base = { customerId, barberId: barber.id, serviceId: service.id };
    const next = await customerBooking(api, { ...base, startsAt: romeWinter(future, '10:00'), status: 'confirmed' });
    const later = await customerBooking(api, { ...base, startsAt: romeWinter(plusDays(future, 1), '10:00'), status: 'confirmed' });
    const done = await customerBooking(api, { ...base, startsAt: romeWinter(past, '10:00'), status: 'completed' });
    data.bookings.push(next, later, done);

    // --- Conferma ---
    await page.goto(`/prenotazioni/${next}/confermata`);
    await expectPath(page, `/prenotazioni/${next}/confermata`);
    const confirmationX = await checkLayout(page, 'conferma');
    expect.soft(confirmationX, 'conferma: h1 alla stessa x della home a 1280 (8k.2)').toBe(homeX);

    // 8k.7: due azioni con bordo e "Torna alla home" come link semplice
    const addToCalendar = main(page).getByRole('link', { name: s('booking.confirmation.addToCalendar'), exact: true });
    const myBookings = main(page).getByRole('link', { name: s('booking.confirmation.myBookings'), exact: true });
    const backHome = main(page).getByRole('link', { name: s('booking.confirmation.backHome'), exact: true });
    expect.soft(visibleBorderSides(await borderOf(addToCalendar)), '"Aggiungi al calendario" con bordo').not.toEqual([]);
    expect.soft(visibleBorderSides(await borderOf(myBookings)), '"Le mie prenotazioni" con bordo').not.toEqual([]);
    expect.soft(visibleBorderSides(await borderOf(backHome)), '"Torna alla home" senza bordo (8k.7)').toEqual([]);

    // --- Le mie prenotazioni ---
    await page.goto('/prenotazioni');
    const listX = await checkLayout(page, '/prenotazioni');
    expect.soft(listX, '/prenotazioni: h1 alla stessa x della home a 1280 (8k.2)').toBe(homeX);

    const section = (key: string): Locator =>
      main(page)
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: s(key), exact: true }) });
    const upcoming = section('booking.list.upcoming').locator('ul > li');
    const pastItems = section('booking.list.past').locator('ul > li');
    await expect(upcoming).toHaveCount(2);
    await expect(pastItems).toHaveCount(1);

    // 8k.8: solo la prossima ha il trattamento glass-ink
    await expect(upcoming.nth(0)).toHaveClass(/(^|\s)glass-ink(\s|$)/);
    await expect(upcoming.nth(1)).not.toHaveClass(/(^|\s)glass-ink(\s|$)/);

    // 8k.8: le passate senza riquadro (né bordo sinistro né superiore) e in text-muted-foreground
    const pastLook = await pastItems.first().evaluate((li) => {
      const probe = document.createElement('span');
      probe.className = 'text-muted-foreground';
      li.parentElement?.append(probe);
      const muted = getComputedStyle(probe).color;
      probe.remove();
      const style = getComputedStyle(li);
      return { left: style.borderLeftWidth, top: style.borderTopWidth, color: style.color, muted };
    });
    expect.soft(pastLook.left, 'passata: senza bordo sinistro').toBe('0px');
    expect.soft(pastLook.top, 'passata: senza bordo superiore').toBe('0px');
    expect.soft(pastLook.color, 'passata: colore di text-muted-foreground').toBe(pastLook.muted);
  } finally {
    await cleanup(api, data);
  }
});
