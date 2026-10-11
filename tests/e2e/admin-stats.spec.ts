// Test di accettazione e2e – FETTA 9a (SPEC §11: "Statistiche – l'admin vede prenotazioni, incasso
// stimato e no-show del periodo, per barbiere e per servizio").
// Flussi principali e controllo d'accesso: SPEC §2 (statistiche: solo admin), §6.9 (totali,
// prenotazioni demo, tabelle per barbiere e per servizio) + decisioni approvate per la fetta 9a.
//
// Pagina attesa: /admin/statistiche?dal=YYYY-MM-DD&al=YYYY-MM-DD&raggruppa=…&barbiere=…&escludi_demo=…&grafico=…
//   - modulo GET: campi con label it.admin.stats.fromLabel / toLabel, casella (checkbox)
//     it.admin.stats.excludeDemo spenta di base, pulsante it.admin.stats.apply;
//   - riquadri dei totali, ciascuno con attributo data-stat e il valore in un elemento [data-stat-value]:
//       data-stat="bookings"       numero di prenotazioni (es. "3")
//       data-stat="revenue"        incasso stimato con formatCents (es. "40,00 €")
//       data-stat="no-show-rate"   tasso con formatRate (es. "33%", "—" se non calcolabile)
//       data-stat="cancellations"  cancellazioni totali (cliente + negozio)
//       data-stat="to-close"       passate da chiudere
//   - tabella dell'andamento con nome accessibile it.admin.stats.trendTitle (caption o aria-label),
//     una riga per bucket; i giorni si mostrano come gg/mm/aaaa (decisione fetta 3);
//   - tabelle con nome accessibile it.admin.stats.byBarberTitle e it.admin.stats.byServiceTitle, una
//     riga per barbiere/servizio con il nome e l'incasso (anche i barbieri e i servizi attivi senza
//     prenotazioni nel periodo, a zero, con il tasso "—")
//   Il barbiere non vede la voce it.admin.nav.stats ed è rimandato a /admin (come le altre sezioni
//   adminOnly: requireRole(["admin"]) rimanda lo staff non autorizzato a /admin).
//
// Prerequisiti: Supabase locale con il seed; NEXT_PUBLIC_SUPABASE_* (ambiente o .env.local). Le
// prenotazioni si creano con l'API dell'admin demo (RLS attiva, come negli altri e2e: l'admin può
// inserire prenotazioni passate già completate o no-show, ADR 001) su Luca e Taglio del seed, in una
// settimana di gennaio/febbraio fra il 2001 e il 2010 scelta a caso per ogni test: nessun altro e2e
// usa quegli anni, quindi i totali del periodo contengono solo i dati del test. Pulizia nel finally.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type Page } from '@playwright/test';

import { formatCents } from '../../src/lib/domain/money';
import {
  DESKTOP,
  SEED,
  adminApi,
  adminNavLink,
  cleanup,
  euro,
  expectPath,
  itDate,
  loginAsAdmin,
  loginAsBarber,
  plusDays,
  romeWinter,
  s,
  type AdminApi,
} from './admin-helpers';

// ---------------------------------------------------------------------------
// Dati di prova
// ---------------------------------------------------------------------------
type Status = 'confirmed' | 'completed' | 'no_show' | 'cancelled_by_customer' | 'cancelled_by_shop';

const pad = (value: number): string => String(value).padStart(2, '0');
const randomInt = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1));

/** Lunedì casuale di gennaio/febbraio fra gli anni dati (ora solare, UTC+1 a Roma). */
const isolatedMonday = (fromYear: number, toYear: number): string => {
  const start = `${randomInt(fromYear, toYear)}-${pad(randomInt(1, 2))}-${pad(randomInt(1, 20))}`;
  const weekday = new Date(`${start}T12:00:00Z`).getUTCDay(); // 0 = domenica
  return plusDays(start, (8 - weekday) % 7);
};

/** Prenotazione di un ospite su Luca / Taglio (prezzo e fine li calcola il database). */
const booking = async (
  api: AdminApi,
  date: string,
  time: string,
  status: Status,
  notes: string | null = null,
): Promise<string> => {
  const rows = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
    guest_name: 'E2E Statistiche',
    guest_phone: '+393330000000',
    barber_id: SEED.luca,
    service_id: SEED.taglio,
    starts_at: romeWinter(date, time),
    source: 'manual',
    status,
    notes,
  });
  expect(rows).toHaveLength(1);
  return rows[0]?.id ?? '';
};

const bookingPrice = async (api: AdminApi, id: string): Promise<number> => {
  const [row] = await api.get<Array<{ price_cents: number }>>(`/rest/v1/bookings?select=price_cents&id=eq.${id}`);
  expect(row, 'prenotazione di prova non trovata').toBeDefined();
  return row?.price_cents ?? 0;
};

const statValue = (page: Page, stat: string) =>
  page.locator('main').locator(`[data-stat="${stat}"]`).locator('[data-stat-value]');

const statsUrl = (from: string, to: string, extra = ''): string => `/admin/statistiche?dal=${from}&al=${to}${extra}`;

test.describe('Statistiche (SPEC §6.9)', () => {
  test.use({ viewport: DESKTOP });

  // SPEC §6.9: prenotazioni, incasso stimato, tasso di no-show, cancellazioni, passate da chiudere,
  // andamento, per barbiere e per servizio
  test('l\'admin vede i totali del periodo, l\'andamento e le righe per barbiere e servizio', async ({ page }) => {
    const api = await adminApi(page.request);
    const bookings: string[] = [];
    const monday = isolatedMonday(2001, 2005);
    const sunday = plusDays(monday, 6);

    try {
      bookings.push(await booking(api, monday, '10:00', 'completed'));
      bookings.push(await booking(api, monday, '11:00', 'confirmed')); // passata, da chiudere
      bookings.push(await booking(api, monday, '12:00', 'no_show'));
      bookings.push(await booking(api, plusDays(monday, 1), '10:00', 'cancelled_by_customer'));
      bookings.push(await booking(api, plusDays(monday, 2), '10:00', 'cancelled_by_shop'));
      const price = await bookingPrice(api, bookings[0] ?? '');
      const [luca] = await api.get<Array<{ display_name: string }>>(
        `/rest/v1/barbers?select=display_name&id=eq.${SEED.luca}`,
      );
      const [taglio] = await api.get<Array<{ name: string }>>(`/rest/v1/services?select=name&id=eq.${SEED.taglio}`);

      await loginAsAdmin(page);
      await adminNavLink(page, 'admin.nav.stats').click();
      await expectPath(page, '/admin/statistiche');
      await page.goto(statsUrl(monday, sunday));

      await expect(page.getByLabel(s('admin.stats.fromLabel'), { exact: true })).toHaveValue(monday);
      await expect(page.getByLabel(s('admin.stats.toLabel'), { exact: true })).toHaveValue(sunday);
      await expect(page.getByRole('checkbox', { name: s('admin.stats.excludeDemo'), exact: true })).not.toBeChecked();

      // prenotazioni: completed + confirmed + no_show; incasso: completed + confirmed
      await expect(statValue(page, 'bookings')).toHaveText('3');
      await expect(statValue(page, 'revenue')).toHaveText(euro(formatCents(2 * price)));
      // no-show 1 su 3 prenotazioni non cancellate già iniziate (formatRate)
      await expect(statValue(page, 'no-show-rate')).toHaveText('33%');
      await expect(statValue(page, 'cancellations')).toHaveText('2');
      await expect(statValue(page, 'to-close')).toHaveText('1');

      // andamento per giorno: tutti i 7 giorni, anche quelli vuoti
      const trend = page.getByRole('table', { name: s('admin.stats.trendTitle') });
      await expect(trend).toBeVisible();
      for (let day = 0; day < 7; day += 1) {
        await expect(trend.getByRole('row').filter({ hasText: itDate(plusDays(monday, day)) })).toHaveCount(1);
      }

      const byBarber = page.getByRole('table', { name: s('admin.stats.byBarberTitle') });
      const lucaRow = byBarber.getByRole('row').filter({ hasText: luca?.display_name ?? '?' });
      await expect(lucaRow).toHaveCount(1);
      await expect(lucaRow).toContainText(euro(formatCents(2 * price)));

      const byService = page.getByRole('table', { name: s('admin.stats.byServiceTitle') });
      const taglioRow = byService.getByRole('row').filter({ hasText: taglio?.name ?? '?' });
      await expect(taglioRow).toHaveCount(1);
      await expect(taglioRow).toContainText(euro(formatCents(2 * price)));

      // Barbieri e servizi attivi senza prenotazioni nella settimana: riga a zero, tasso "—"
      // (decisione dell'utente). Mario e Barba sono attivi nel seed e nessun e2e usa questi anni.
      const marioRow = byBarber.getByRole('row').filter({ has: page.getByText('Mario', { exact: true }) });
      await expect(marioRow).toHaveCount(1);
      await expect(marioRow).toContainText(euro(formatCents(0)));
      await expect(marioRow).toContainText('—');
      const barbaRow = byService.getByRole('row').filter({ has: page.getByText('Barba', { exact: true }) });
      await expect(barbaRow).toHaveCount(1);
      await expect(barbaRow).toContainText(euro(formatCents(0)));
    } finally {
      await cleanup(api, { bookings });
    }
  });

  // SPEC §6.9: le prenotazioni demo contano normalmente; la casella, spenta di base, le esclude
  test('la casella "Escludi prenotazioni demo" toglie le prenotazioni demo dai totali', async ({ page }) => {
    const api = await adminApi(page.request);
    const bookings: string[] = [];
    const monday = isolatedMonday(2006, 2010);
    const sunday = plusDays(monday, 6);

    try {
      bookings.push(await booking(api, monday, '10:00', 'completed', '  prenotazione DEMO '));
      bookings.push(await booking(api, monday, '11:00', 'completed', null));
      bookings.push(await booking(api, plusDays(monday, 1), '10:00', 'completed', 'Prenotazione demo, cliente vero'));
      const price = await bookingPrice(api, bookings[0] ?? '');

      await loginAsAdmin(page);
      await page.goto(statsUrl(monday, sunday));
      await expect(statValue(page, 'bookings')).toHaveText('3');
      await expect(statValue(page, 'revenue')).toHaveText(euro(formatCents(3 * price)));

      const demo = page.getByRole('checkbox', { name: s('admin.stats.excludeDemo'), exact: true });
      await expect(demo).not.toBeChecked();
      await demo.check();
      await page.getByRole('button', { name: s('admin.stats.apply'), exact: true }).click();

      await expect.poll(() => new URL(page.url()).searchParams.has('escludi_demo')).toBe(true);
      await expect.poll(() => new URL(page.url()).searchParams.get('dal')).toBe(monday);
      await expect(statValue(page, 'bookings')).toHaveText('2');
      await expect(statValue(page, 'revenue')).toHaveText(euro(formatCents(2 * price)));
      await expect(page.getByRole('checkbox', { name: s('admin.stats.excludeDemo'), exact: true })).toBeChecked();
    } finally {
      await cleanup(api, { bookings });
    }
  });

  // SPEC §2 e §6.9: statistiche solo admin; il barbiere non vede nemmeno le proprie
  test('il barbiere non vede la voce Statistiche e /admin/statistiche lo rimanda a /admin', async ({ page }) => {
    await loginAsBarber(page);
    await expect(adminNavLink(page, 'admin.nav.stats')).toHaveCount(0);
    for (const path of ['/admin/statistiche', `/admin/statistiche?dal=2026-01-01&al=2026-01-31&barbiere=${SEED.luca}`]) {
      await page.goto(path);
      await expectPath(page, '/admin');
    }
    await expect(page.locator('main [data-stat]')).toHaveCount(0);
  });
});
