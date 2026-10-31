// Test di accettazione e2e – FETTA 8j (rifiniture di stile dell'area admin).
// Fonte: docs/audit/2026-10-31-taste.md e decisioni approvate dall'utente ("8j.N" è il numero
// dell'intervento); SPEC §6.1 (calendario), §6.3 (dettaglio), §6.4 (servizi), §6.7 (clienti), §6.8
// (impostazioni), §6.9 (statistiche). I casi limite sono in tests/acceptance/admin-polish-8j.test.ts,
// la coda della pausa in tests/e2e/admin-settings.spec.ts (cambia shop_settings).
//
// Contratto del DOM:
//   - menu: <nav aria-label=it.admin.nav.label>, voce attiva con aria-current="page", anche dopo una
//     navigazione lato client; dentro <aside> il nome del negozio al posto di "Area staff".
//   - "Esci": <button> dentro un <form>, senza bordo né fondo.
//   - calendario: link con nome accessibile it.admin.calendar.newBooking, testo visibile
//     newBookingShort su telefono; righe [data-grid-row] da 44 px su telefono e 36 px su desktop.
//   - scheda sotto i 15 minuti: [data-booking-compact].
//   - dettaglio: <h1> "Mer 3 feb, 10:00, Nome"; telefono in un link tel:.
//   - servizi su telefono: <ul data-testid="services-list"> al posto della tabella.
//   - statistiche: vuoti=1 nell'URL, conservato da periodi rapidi, grafico e "Applica".
//
// Prerequisiti: Supabase locale con il seed; NEXT_PUBLIC_SUPABASE_* e SUPABASE_SERVICE_ROLE_KEY
// (ambiente o .env.local). Dati unici creati con l'API dell'admin demo e rimossi a fine test: futuri
// fra il 2071 e il 2099, passati fra il 1981 e il 1989, anni che nessun altro e2e usa.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import {
  DESKTOP,
  SEED,
  adminApi,
  apiHeaders,
  cleanup,
  env,
  field,
  loginAsAdmin,
  plusDays,
  romeWinter,
  s,
  saveButton,
  supabaseUrl,
  uniqueEmail,
  uniqueName,
  createService,
  type AdminApi,
} from './admin-helpers';

const PHONE = { width: 390, height: 844 };
const WEEKDAYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const MONTHS = ['gen', 'feb'];

const randomInt = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1));

/**
 * Giorno lavorativo per il seed (martedì–sabato, Luca 9–13) di gennaio o febbraio, ora solare. Molti
 * giorni possibili: i test paralleli non si contendono lo stesso orario di Luca.
 */
const futureWorkday = (): string => {
  const day = new Date(Date.UTC(randomInt(2071, 2099), randomInt(0, 1), randomInt(1, 26), 12));
  if (day.getUTCDay() < 2) day.setUTCDate(day.getUTCDate() + 2);
  return day.toISOString().slice(0, 10);
};

/** Lunedì di gennaio/febbraio degli anni dati. */
const pastMonday = (fromYear: number, toYear: number): string => {
  const day = new Date(Date.UTC(randomInt(fromYear, toYear), randomInt(0, 1), randomInt(1, 20), 12));
  day.setUTCDate(day.getUTCDate() + ((8 - day.getUTCDay()) % 7));
  return day.toISOString().slice(0, 10);
};
// Ogni test che crea prenotazioni ha la sua data, che nessun altro test usa: con date casuali due test
// in parallelo potevano scontrarsi sullo stesso barbiere (modificato con l'approvazione dell'utente).
const alignTo = (day: Date, weekday: number): string => {
  day.setUTCDate(day.getUTCDate() + ((7 + weekday - day.getUTCDay()) % 7));
  return day.toISOString().slice(0, 10);
};
/** Lunedì passato, in inverno, del test numero `slot` (al massimo 19): 1981–1985. */
const ownPastMonday = (slot: number): string =>
  alignTo(new Date(Date.UTC(1981 + Math.floor(slot / 4), 0, 5 + (slot % 4) * 7, 12)), 1);
/** Mercoledì futuro, in inverno, del test numero `slot`: dal 2071. */
const ownWorkday = (slot: number): string => alignTo(new Date(Date.UTC(2071 + slot, 0, 15, 12)), 3);
// Solo il test delle statistiche usa il 1986–1989: i suoi totali contengono soltanto i suoi dati.
const statsPastMonday = (): string => pastMonday(1986, 1989);

type Booking = { guestName: string; date: string; time: string; status?: string };

const guestBooking = async (api: AdminApi, values: Booking): Promise<string> => {
  const rows = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
    guest_name: values.guestName,
    guest_phone: '+393330000877',
    barber_id: SEED.luca,
    service_id: SEED.taglio,
    starts_at: romeWinter(values.date, values.time),
    source: 'manual',
    status: values.status ?? 'confirmed',
  });
  expect(rows).toHaveLength(1);
  return rows[0]?.id ?? '';
};

const adminMenu = (page: Page): Locator => page.getByRole('navigation', { name: s('admin.nav.label'), exact: true });
const menuLink = (page: Page, key: string): Locator =>
  adminMenu(page).getByRole('link', { name: s(key), exact: true });

const main = (page: Page): Locator => page.locator('main');

const pageOverflow = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Controlli di main e del menu sotto i 44 px, come "descrizione: LxA". */
const smallControls = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const selector = 'a[href], button, select, textarea, input:not([type="hidden"]), [role="button"]';
    const controls = [
      ...document.querySelectorAll(`main :is(${selector})`),
      ...document.querySelectorAll(`aside :is(${selector})`),
    ];
    return controls.flatMap((control) => {
      // La casella si misura sulla sua etichetta (8j.10); il link "Da aggiornare" copre tutto il riquadro
      const measured = control.closest('label') ?? control.closest('[data-stat]') ?? control;
      const style = getComputedStyle(control);
      const box = measured.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || control.getClientRects().length === 0) return [];
      if (Math.round(box.height) >= 44 && Math.round(box.width) >= 44) return [];
      const name = control.getAttribute('aria-label') ?? ((control.textContent ?? '').trim().slice(0, 40) || control.id);
      return [`${control.tagName.toLowerCase()} "${name}": ${Math.round(box.width)}x${Math.round(box.height)}`];
    });
  });

/** Colore del token --danger, risolto dal browser. */
const dangerColor = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--danger)';
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });

const box = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const value = await locator.boundingBox();
  expect(value, 'elemento senza riquadro').not.toBeNull();
  return value ?? { x: 0, y: 0, width: 0, height: 0 };
};

/** Quante righe occupano gli elementi: centri a meno di 24 px sono sulla stessa riga. */
const rowsOf = (centers: number[]): number =>
  centers
    .sort((a, b) => a - b)
    .filter((center, index, sorted) => index === 0 || center - (sorted[index - 1] ?? 0) > 24).length;

const toolbarControls = (page: Page) => ({
  today: page.getByRole('link', { name: s('admin.calendar.today'), exact: true }),
  previous: page.getByRole('link', { name: s('admin.calendar.previousDay'), exact: true }),
  next: page.getByRole('link', { name: s('admin.calendar.nextDay'), exact: true }),
  title: main(page).getByRole('heading', { level: 1 }),
  day: page.getByRole('link', { name: s('admin.calendar.dayView'), exact: true }),
  week: page.getByRole('link', { name: s('admin.calendar.weekView'), exact: true }),
  create: main(page).getByRole('link', { name: s('admin.calendar.newBooking'), exact: true }),
});

// ---------------------------------------------------------------------------
// Menu – 8j.1, 8j.2
// ---------------------------------------------------------------------------
test.describe('Menu dell\'area staff (8j.1, 8j.2)', () => {
  test('la voce attiva ha aria-current, anche nelle sottopagine e dopo la navigazione lato client', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const api = await adminApi(page.request);
    const date = ownWorkday(20);
    const id = await guestBooking(api, { guestName: uniqueName('Ospite menu'), date, time: '12:15' });

    const expectActive = async (key: string): Promise<void> => {
      await expect(menuLink(page, key)).toHaveAttribute('aria-current', 'page');
      await expect(adminMenu(page).locator('a[aria-current]')).toHaveCount(1);
    };

    try {
      await loginAsAdmin(page);
      await expectActive('admin.nav.calendar');

      for (const [path, key] of [
        [`/admin/calendario/${id}`, 'admin.nav.calendar'],
        ['/admin/calendario/nuova', 'admin.nav.calendar'],
        [`/admin/barbieri/${SEED.luca}/assenze`, 'admin.nav.barbers'],
        ['/admin/statistiche/da-aggiornare', 'admin.nav.stats'],
        ['/admin/servizi/nuovo', 'admin.nav.services'],
        ['/admin/assenze', 'admin.nav.timeOff'],
      ] as const) {
        await page.goto(path);
        await expectActive(key);
      }

      // CLAUDE.md: il layout non si riesegue durante la navigazione
      await menuLink(page, 'admin.nav.customers').click();
      await expectActive('admin.nav.customers');
      await menuLink(page, 'admin.nav.calendar').click();
      await expectActive('admin.nav.calendar');
    } finally {
      await cleanup(api, { bookings: [id] });
    }
  });

  test('a 390 px tutte le voci stanno nel viewport su due righe; nome del negozio al posto di "Area staff"', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    const api = await adminApi(page.request);
    const [settings] = await api.get<Array<{ name: string }>>('/rest/v1/shop_settings?select=name');
    await loginAsAdmin(page);

    const links = await adminMenu(page).getByRole('link').all();
    expect(links).toHaveLength(8);
    const boxes = await Promise.all(links.map((link) => box(link)));
    for (const item of boxes) {
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.x + item.width).toBeLessThanOrEqual(PHONE.width);
      expect(item.y + item.height).toBeLessThanOrEqual(PHONE.height);
    }
    expect(rowsOf(boxes.map((item) => item.y + item.height / 2)), 'voci su due righe').toBe(2);
    const scroll = await adminMenu(page).evaluate((nav) => nav.scrollWidth - nav.clientWidth);
    expect(scroll, 'il menu non scorre di lato').toBeLessThanOrEqual(0);

    const aside = page.locator('aside');
    await expect(aside).toContainText(settings?.name ?? '?');
    await expect(aside).not.toContainText('Area staff');
    await expect(aside.getByTestId('fly')).toHaveCount(0);
  });

  test('"Esci" è un pulsante in un form con aspetto di link, in fondo alla barra su desktop', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsAdmin(page);
    await page.goto('/admin/assenze');

    const logout = page.locator('aside form').getByRole('button', { name: s('auth.logout'), exact: true });
    await expect(logout).toBeVisible();
    await expect(page.locator('aside').getByRole('link', { name: s('auth.logout'), exact: true })).toHaveCount(0);
    const look = await logout.evaluate((button) => {
      const style = getComputedStyle(button);
      return { border: style.borderTopWidth, background: style.backgroundColor };
    });
    expect(look.border).toBe('0px');
    expect(look.background).toBe('rgba(0, 0, 0, 0)');

    const bar = await box(page.locator('aside'));
    const button = await box(logout);
    expect(bar.y + bar.height - (button.y + button.height), 'in fondo alla barra').toBeLessThanOrEqual(32);
  });
});

// ---------------------------------------------------------------------------
// Barra del calendario – 8j.3
// ---------------------------------------------------------------------------
test.describe('Barra del calendario (8j.3; SPEC §6.1)', () => {
  test('su desktop sta su una riga, con Giorno/Settimana uniti e "Nuova prenotazione" a destra', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsAdmin(page);
    await page.goto(`/admin?data=${futureWorkday()}&vista=giorno`);

    const controls = toolbarControls(page);
    const boxes = {
      previous: await box(controls.previous),
      today: await box(controls.today),
      next: await box(controls.next),
      title: await box(controls.title),
      day: await box(controls.day),
      week: await box(controls.week),
      create: await box(controls.create),
    };
    const all = Object.values(boxes);
    expect(rowsOf(all.map((item) => item.y + item.height / 2)), 'barra su una riga').toBe(1);

    expect(boxes.today.x).toBeLessThan(boxes.title.x);
    expect(boxes.next.x).toBeLessThan(boxes.title.x);
    expect(boxes.title.x + boxes.title.width).toBeLessThanOrEqual(boxes.day.x);
    expect(boxes.week.x + boxes.week.width).toBeLessThanOrEqual(boxes.create.x);

    // Controllo segmentato: i due pulsanti si toccano
    expect(Math.abs(boxes.week.x - (boxes.day.x + boxes.day.width))).toBeLessThanOrEqual(1);
    await expect(controls.day).toHaveAttribute('aria-current', 'page');

    const area = await box(main(page));
    const padding = await main(page).evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingRight));
    expect(area.x + area.width - padding - (boxes.create.x + boxes.create.width), 'allineato a destra').toBeLessThanOrEqual(1);
    expect((await controls.create.innerText()).trim()).toBe(s('admin.calendar.newBooking'));
  });

  test('a 390 px sta su due righe, con il testo corto e lo stesso nome accessibile', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await loginAsAdmin(page);
    await page.goto(`/admin?data=${futureWorkday()}&vista=giorno`);

    const controls = toolbarControls(page);
    await expect(controls.create).toBeVisible();
    expect((await controls.create.innerText()).trim()).toBe(s('admin.calendar.newBookingShort'));

    const boxes = await Promise.all(Object.values(controls).map((control) => box(control)));
    expect(rowsOf(boxes.map((item) => item.y + item.height / 2)), 'barra su due righe').toBe(2);
    for (const item of boxes) {
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.x + item.width).toBeLessThanOrEqual(PHONE.width);
    }
  });
});

// ---------------------------------------------------------------------------
// Controlli da 44 px e sforamento – 8j.10
// ---------------------------------------------------------------------------
test.describe('Controlli e sforamento (8j.10)', () => {
  let api: AdminApi;
  let date: string;
  let monday: string;
  let bookingId: string;
  const bookings: string[] = [];

  test.beforeEach(async ({ request }, testInfo) => {
    api = await adminApi(request);
    // Una data per test (modificato con l'approvazione dell'utente)
    const slot = pages.findIndex(([name]) => testInfo.title.startsWith(name)) + 1;
    date = ownWorkday(slot);
    monday = ownPastMonday(slot);
    bookingId = await guestBooking(api, { guestName: uniqueName('Ospite misure'), date, time: '12:15' });
    bookings.push(
      bookingId,
      await guestBooking(api, { guestName: uniqueName('Ospite passato'), date: monday, time: '10:00', status: 'completed' }),
      // Passata e ancora confermata: compare il link "Da aggiornare". Ora fissa: casuale poteva coincidere
      // con le 10:00 di "Ospite passato" (modificato con l'approvazione dell'utente)
      await guestBooking(api, { guestName: uniqueName('Ospite da chiudere'), date: monday, time: '14:00' }),
    );
  });

  test.afterEach(async () => {
    await cleanup(api, { bookings: bookings.splice(0) });
  });

  const pages: Array<[string, () => string]> = [
    ['calendario giorno', () => `/admin?data=${date}&vista=giorno`],
    ['calendario settimana', () => `/admin?data=${date}&vista=settimana&barbiere=${SEED.luca}`],
    ['dettaglio della prenotazione', () => `/admin/calendario/${bookingId}`],
    ['servizi', () => '/admin/servizi'],
    ['clienti', () => '/admin/clienti'],
    ['scheda del cliente', () => `/admin/clienti/${SEED.customerProfile}`],
    ['statistiche', () => `/admin/statistiche?dal=${monday}&al=${plusDays(monday, 6)}`],
    ['impostazioni', () => '/admin/impostazioni'],
  ];

  for (const [name, path] of pages) {
    test(`${name}: a 390 px ogni controllo è almeno 44×44 e la pagina non sfora, nemmeno a 1280`, async ({ page }) => {
      await page.setViewportSize(PHONE);
      await loginAsAdmin(page);
      await page.goto(path());
      await expect(main(page).getByRole('heading', { level: 1 })).toBeVisible();

      expect(await smallControls(page)).toEqual([]);
      expect(await pageOverflow(page), 'sforamento a 390 px').toBeLessThanOrEqual(0);

      await page.setViewportSize(DESKTOP);
      await expect(main(page).getByRole('heading', { level: 1 })).toBeVisible();
      expect(await pageOverflow(page), 'sforamento a 1280 px').toBeLessThanOrEqual(0);
    });
  }

  test('righe del calendario: 44 px su telefono, 36 px su desktop', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await loginAsAdmin(page);
    await page.goto(`/admin?data=${date}&vista=giorno`);
    const row = page.locator('[data-grid-row]').first();
    await expect(row).toBeVisible();
    expect((await box(row)).height).toBeCloseTo(44, 0);
    await page.setViewportSize(DESKTOP);
    await expect.poll(async () => (await box(row)).height).toBeCloseTo(36, 0);
  });
});

// ---------------------------------------------------------------------------
// Schede brevi – 8j.4
// ---------------------------------------------------------------------------
test('sotto i 15 minuti la scheda è alta il giusto, su una riga, con il testo completo nel nome (8j.4; SPEC §6.1)', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  const api = await adminApi(page.request);
  const date = ownWorkday(21);
  const brief = uniqueName('Ospite con un nome molto lungo da troncare');
  const quarter = uniqueName('Ospite quindici');
  const bookings = [
    await guestBooking(api, { guestName: brief, date, time: '09:15' }),
    await guestBooking(api, { guestName: quarter, date, time: '10:00' }),
  ];

  try {
    // Durata sulla prenotazione: la cambia l'admin, ends_at lo ricalcola il database
    await api.patch(`/rest/v1/bookings?id=eq.${bookings[0]}&select=id`, { duration_min: 10 });
    await api.patch(`/rest/v1/bookings?id=eq.${bookings[1]}&select=id`, { duration_min: 15 });

    await loginAsAdmin(page);
    await page.goto(`/admin?data=${date}&vista=giorno`);

    const rowHeight = (await box(page.locator('[data-grid-row]').first())).height;
    const card = main(page).getByRole('link', { name: new RegExp(brief) });
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute('data-booking-compact');
    await expect(card).toContainText('09:15');
    await expect(card).toContainText(brief);
    await expect(card).toHaveAccessibleName(/Taglio/);

    const height = (await box(card)).height;
    expect(Math.abs(height - (rowHeight * 10) / 15), `altezza reale, non una riga intera: ${height}`).toBeLessThanOrEqual(3);

    const text = await card.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const lines = new Set(
        Array.from(range.getClientRects())
          .filter((rect) => rect.width > 0)
          .map((rect) => Math.round(rect.top)),
      ).size;
      const clipped = [element, ...element.querySelectorAll('*')].some(
        (node) => node.scrollWidth > node.clientWidth && getComputedStyle(node).textOverflow === 'ellipsis',
      );
      return { lines, clipped };
    });
    expect(text.lines, 'una riga').toBe(1);
    expect(text.clipped, 'ellissi sul nome che non ci sta').toBe(true);

    // Il confine è "sotto i 15 minuti"
    await expect(main(page).getByRole('link', { name: new RegExp(quarter) })).not.toHaveAttribute('data-booking-compact');
  } finally {
    await cleanup(api, { bookings });
  }
});

// ---------------------------------------------------------------------------
// Dettaglio – 8j.5
// ---------------------------------------------------------------------------
test('dettaglio: titolo con giorno, ora e cliente, telefono chiamabile, pulsanti con il loro nome (8j.5; SPEC §6.1)', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  const api = await adminApi(page.request);
  const date = ownWorkday(22);
  const guestName = uniqueName('Giulia Verdi');
  const id = await guestBooking(api, { guestName, date, time: '12:15' });
  const [, month, day] = date.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];

  try {
    await loginAsAdmin(page);
    await page.goto(`/admin/calendario/${id}`);

    // Come "Mar 3 nov, 10:00, Giulia Verdi". La maiuscola può venire dal CSS, come nel calendario.
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
      new RegExp(`^${weekday} ${day} ${MONTHS[(month ?? 1) - 1]}, 12:15, ${guestName}$`, 'i'),
    );

    await expect(main(page).locator('a[href="tel:+393330000877"]')).toBeVisible();

    await expect(main(page).getByRole('button', { name: s('admin.calendar.detail.saveNote'), exact: true })).toBeVisible();
    const form = page.getByRole('form', { name: s('admin.calendar.edit.title') });
    await expect(form.getByRole('button', { name: s('admin.calendar.edit.saveChanges'), exact: true })).toBeVisible();
    await expect(saveButton(main(page))).toHaveCount(0);
  } finally {
    await cleanup(api, { bookings: [id] });
  }
});

// ---------------------------------------------------------------------------
// Servizi – 8j.6
// ---------------------------------------------------------------------------
test('servizi su desktop: Elimina sempre allo stesso x e neutro a riposo, numeri a destra in cifre tabellari (8j.6; SPEC §6.4)', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  const api = await adminApi(page.request);
  const services = [
    await createService(api, { name: uniqueName('Servizio riga A'), sortOrder: 990 }),
    await createService(api, { name: uniqueName('Servizio riga B'), sortOrder: 991 }),
  ];

  try {
    await loginAsAdmin(page);
    await page.goto('/admin/servizi');

    const remove = main(page).locator('table').getByRole('button', { name: s('admin.common.delete'), exact: true });
    await expect(remove.first()).toBeVisible();
    const positions = await remove.evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().x)));
    expect(positions.length).toBeGreaterThanOrEqual(3);
    expect(new Set(positions).size, `x diverse: ${positions.join(', ')}`).toBe(1);

    const danger = await dangerColor(page);
    const rest = await remove.first().evaluate((button) => {
      const style = getComputedStyle(button);
      return { color: style.color, border: style.borderTopColor };
    });
    expect(rest.color).not.toBe(danger);
    expect(rest.border).not.toBe(danger);

    const row = main(page).locator('table tbody tr').first();
    for (const index of [1, 2]) {
      const cell = await row.locator('td').nth(index).evaluate((td) => {
        const style = getComputedStyle(td);
        return { align: style.textAlign, numeric: style.fontVariantNumeric };
      });
      expect(['right', 'end']).toContain(cell.align);
      expect(cell.numeric).toContain('tabular-nums');
    }
  } finally {
    await cleanup(api, { services });
  }
});

// ---------------------------------------------------------------------------
// Clienti – 8j.7
// ---------------------------------------------------------------------------
const serviceHeaders = (): Record<string, string> => {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return { ...apiHeaders(), apikey: key, Authorization: `Bearer ${key}` };
};

const createCustomer = async (request: APIRequestContext, api: AdminApi, fullName: string): Promise<string> => {
  const response = await request.post(`${supabaseUrl()}/auth/v1/admin/users`, {
    headers: serviceHeaders(),
    data: { email: uniqueEmail('polish'), email_confirm: true },
  });
  expect(response.ok(), `creazione dell'utente fallita: ${response.status()}`).toBe(true);
  const { id } = (await response.json()) as { id: string };
  await api.patch(`/rest/v1/profiles?id=eq.${id}&select=id`, {
    full_name: fullName,
    phone: `+39333${randomInt(1_000_000, 9_999_999)}`,
  });
  return id;
};

test('clienti: badge solo per i bloccati, "—" se i no-show sono zero, a destra (8j.7; SPEC §6.7)', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const api = await adminApi(page.request);
  const tag = uniqueName('Cliente elenco');
  const customers: string[] = [];

  try {
    const active = await createCustomer(page.request, api, `${tag} Attiva`);
    customers.push(active);
    const blocked = await createCustomer(page.request, api, `${tag} Bloccata`);
    customers.push(blocked);
    await api.patch(`/rest/v1/profiles?id=eq.${blocked}&select=id`, { is_blocked: true });
    await api.post('/rest/v1/bookings?select=id', {
      customer_id: blocked,
      barber_id: SEED.luca,
      service_id: SEED.taglio,
      starts_at: romeWinter(ownPastMonday(9), '10:00'),
      source: 'manual',
      status: 'no_show',
    });

    await loginAsAdmin(page);
    await page.goto(`/admin/clienti?q=${encodeURIComponent(tag)}`);

    const headers = await main(page).locator('table thead th').allTextContents();
    const noShowColumn = headers.indexOf(s('admin.customers.noShows'));
    expect(noShowColumn).toBeGreaterThanOrEqual(0);

    const activeRow = main(page).locator('table tbody tr').filter({ hasText: `${tag} Attiva` });
    await expect(activeRow).not.toContainText(s('admin.customers.status.active'));
    await expect(activeRow.locator('td').nth(noShowColumn)).toHaveText('—');

    const blockedRow = main(page).locator('table tbody tr').filter({ hasText: `${tag} Bloccata` });
    await expect(blockedRow).toContainText(s('admin.customers.status.blockedByAdmin'));
    await expect(blockedRow.locator('td').nth(noShowColumn)).toHaveText('1');

    const cell = await blockedRow.locator('td').nth(noShowColumn).evaluate((td) => {
      const style = getComputedStyle(td);
      return { align: style.textAlign, numeric: style.fontVariantNumeric };
    });
    expect(['right', 'end']).toContain(cell.align);
    expect(cell.numeric).toContain('tabular-nums');

    // La scheda tiene l'indicazione "Attivo"
    await page.goto(`/admin/clienti/${active}`);
    await expect(main(page).getByText(s('admin.customers.status.active')).first()).toBeVisible();
  } finally {
    if (customers.length > 0) await api.del(`/rest/v1/bookings?customer_id=in.(${customers.join(',')})`);
    for (const id of customers) {
      await page.request.delete(`${supabaseUrl()}/auth/v1/admin/users/${id}`, { headers: serviceHeaders() });
    }
  }
});

// ---------------------------------------------------------------------------
// Statistiche – 8j.8
// ---------------------------------------------------------------------------
test('statistiche: periodi vuoti nascosti e mostrabili, grafico intero, incasso in evidenza (8j.8; SPEC §6.9)', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  const api = await adminApi(page.request);
  const monday = statsPastMonday();
  const sunday = plusDays(monday, 6);
  const guestName = uniqueName('Ospite statistiche');
  const bookings = [
    await guestBooking(api, { guestName, date: monday, time: '10:00', status: 'completed' }),
    await guestBooking(api, { guestName, date: plusDays(monday, 2), time: '10:00', status: 'cancelled_by_shop' }),
  ];
  const rows = page.getByRole('table', { name: s('admin.stats.trendTitle') }).locator('tbody tr');
  const bars = page.getByTestId('trend-chart').locator('[data-bar]');
  const show = main(page).getByRole('link', { name: s('admin.stats.showEmptyPeriods'), exact: true });
  const hide = main(page).getByRole('link', { name: s('admin.stats.hideEmptyPeriods'), exact: true });
  const vuoti = (): string | null => new URL(page.url()).searchParams.get('vuoti');

  try {
    await loginAsAdmin(page);
    await page.goto(`/admin/statistiche?dal=${monday}&al=${sunday}`);

    // Di base: solo lunedì (un appuntamento) e mercoledì (una cancellazione), ma tutte le barre
    await expect(rows).toHaveCount(2);
    await expect(bars).toHaveCount(7);
    await expect(hide).toHaveCount(0);

    await show.click();
    await expect.poll(vuoti).toBe('1');
    await expect(rows).toHaveCount(7);
    await expect(bars).toHaveCount(7);

    // La scelta resta con "Applica" e nei periodi rapidi
    await page.getByRole('button', { name: s('admin.stats.apply'), exact: true }).click();
    await expect(page.getByLabel(s('admin.stats.fromLabel'), { exact: true })).toHaveValue(monday);
    await expect.poll(vuoti).toBe('1');
    await expect(rows).toHaveCount(7);
    const shortcut = page
      .getByRole('navigation', { name: s('admin.stats.shortcutsLabel') })
      .getByRole('link', { name: s('admin.stats.shortcuts.thisMonth'), exact: true });
    await expect(shortcut).toHaveAttribute('href', /[?&]vuoti=1(&|$)/);

    await hide.click();
    await expect(rows).toHaveCount(2);
    expect(vuoti()).toBeNull();

    // Una sola etichetta per il grafico: niente sottotitolo visibile, resta il riepilogo sr-only
    await expect(page.locator('figure figcaption')).toHaveCount(0);
    await expect(page.locator('figure .sr-only')).toContainText(s('admin.stats.trendTitle'));
    await expect(main(page).getByRole('navigation', { name: s('admin.stats.chartLabel') })).toBeVisible();

    const size = (stat: string): Promise<number> =>
      main(page)
        .locator(`[data-stat="${stat}"] [data-stat-value]`)
        .evaluate((value) => Number.parseFloat(getComputedStyle(value).fontSize));
    for (const stat of ['bookings', 'no-show-rate', 'cancellations', 'to-close']) {
      expect(await size('revenue'), `incasso più grande di ${stat}`).toBeGreaterThan(await size(stat));
    }
  } finally {
    await cleanup(api, { bookings });
  }
});

// ---------------------------------------------------------------------------
// Impostazioni – 8j.9 (nessun salvataggio: shop_settings non cambia)
// ---------------------------------------------------------------------------
test.describe('Impostazioni (8j.9; SPEC §6.8)', () => {
  const inputLefts = (page: Page): Promise<number[]> =>
    main(page)
      .locator('form input:not([type="hidden"]), form select')
      .evaluateAll((fields) => fields.map((element) => Math.round(element.getBoundingClientRect().x)));

  test('tre gruppi con titolo, due colonne su desktop e una su telefono', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsAdmin(page);
    await page.goto('/admin/impostazioni');

    for (const key of ['shop', 'bookings', 'rules']) {
      await expect(
        main(page).getByRole('heading', { level: 2, name: s(`admin.settings.groups.${key}`), exact: true }),
      ).toBeVisible();
    }
    await expect.poll(async () => new Set(await inputLefts(page)).size, 'due colonne a 1280').toBe(2);

    await page.setViewportSize(PHONE);
    await expect.poll(async () => new Set(await inputLefts(page)).size, 'una colonna a 390').toBe(1);
  });

  for (const [label, viewport] of [
    ['1280', DESKTOP],
    ['390', PHONE],
  ] as const) {
    test(`"Salva" resta raggiungibile a ogni scorrimento (${label} px)`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await loginAsAdmin(page);
      await page.goto('/admin/impostazioni');
      await expect(field(page, 'admin.settings.nameLabel')).toBeVisible();

      for (const position of ['top', 'bottom'] as const) {
        await page.evaluate((target) => {
          window.scrollTo({ top: target === 'top' ? 0 : document.documentElement.scrollHeight, behavior: 'instant' });
        }, position);
        const save = await box(saveButton(page));
        expect(save.y, `sopra lo schermo (${position})`).toBeGreaterThanOrEqual(0);
        expect(save.y + save.height, `sotto lo schermo (${position})`).toBeLessThanOrEqual(viewport.height);
      }
    });
  }

  test("l'effetto dei minuti si aggiorna mentre si digita", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await loginAsAdmin(page);
    await page.goto('/admin/impostazioni');

    const effect = (text: string): Locator => main(page).getByText(text, { exact: true });

    await field(page, 'admin.settings.minAdvanceLabel').fill('45');
    await expect(effect('45 minuti prima')).toBeVisible();
    await field(page, 'admin.settings.cancelLimitLabel').fill('120');
    await expect(effect('2 ore prima')).toBeVisible();
    await field(page, 'admin.settings.cancelLimitLabel').fill('90');
    await expect(effect('1 ora e 30 minuti prima')).toBeVisible();
    await expect(effect('2 ore prima')).toHaveCount(0);
    await field(page, 'admin.settings.bufferLabel').fill('10');
    await expect(effect('10 minuti di pausa')).toBeVisible();

    // Campo vuoto: nessun effetto da mostrare
    await field(page, 'admin.settings.cancelLimitLabel').fill('');
    await expect(effect('1 ora e 30 minuti prima')).toHaveCount(0);
  });
});
