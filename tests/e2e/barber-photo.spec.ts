// modificato in fetta 8f con l'approvazione dell'utente (2026-10-25)
// Test di accettazione e2e – FETTA 8d (ritratti dei barbieri). La fetta non è ancora in
// docs/SPEC.md: le regole vengono dalle decisioni approvate dall'utente ("8d dec. N") e da SPEC §3.3
// (barbieri: "foto") e §5.2 passo 2 (scelta del barbiere con foto).
//
// Flusso principale: l'admin carica un ritratto dalla scheda del barbiere, il cliente lo vede nella
// scelta del barbiere, l'admin lo rimuove e torna l'iniziale.
//
// Contratto dell'interfaccia (dec. 7 e 8):
// - /admin/barbieri/<id>: sezione it.admin.barbers.portraitTitle con l'anteprima (alt come sotto), un campo file etichettato
//   it.admin.barbers.portraitLabel, il pulsante it.admin.barbers.portraitUpload (carica o sostituisce)
//   e il pulsante it.admin.barbers.portraitRemove. Il browser ridimensiona a 512×512 WebP (canvas),
//   con ripiego JPEG (Safari iOS), poi il server ricodifica: si può scegliere una JPEG qualsiasi.
// - /prenota/quando?servizio=<id> (fetta 8e, prima /prenota/barbiere): nella sezione di ogni barbiere
//   con ritratto un'immagine con
//   alt = it.booking.barber.portraitAlt ("Ritratto di {name}"), src = URL pubblico del bucket
//   barber-photos, loading="lazy", decoding="async"; senza ritratto l'iniziale del nome. Fetta 8f: una
//   colonna per barbiere e per giorno disegnato, quindi un ritratto per colonna; si controlla quello
//   della colonna del giorno selezionato.
//
// Prerequisiti: Supabase locale con il seed e Mailpit. Il file JPEG si genera al volo con sharp.
// Dati creati tramite l'admin demo (RLS attiva) e rimossi alla fine, file del bucket compresi.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { devices, expect, test, type APIRequestContext, type Page } from '@playwright/test';
import sharp from 'sharp';

import {
  DESKTOP,
  acceptDialogs,
  adminApi,
  apiHeaders,
  cleanup,
  createService,
  expectPath,
  loginAsAdmin,
  s,
  sf,
  supabaseUrl,
  uniqueEmail,
  uniqueName,
  type AdminApi,
} from './admin-helpers';
import { confirmHref, newestEmailId, waitForNewEmail } from './mailpit';
import { selectedDate, whenColumn } from './when-row-helpers';

const BUCKET = 'barber-photos';
const PATH_FORMAT = (barberId: string): RegExp => new RegExp(`^${barberId}/[0-9a-f]{32}\\.webp$`);
const publicUrl = (path: string): string => `${supabaseUrl()}/storage/v1/object/public/${BUCKET}/${path}`;

// ---------------------------------------------------------------------------
// Cliente nuovo con profilo completo (magic link via Mailpit), come in booking-polish.spec.ts
// ---------------------------------------------------------------------------
const latestConfirmLink = async (request: APIRequestContext, to: string, previousId: string | null): Promise<string> => {
  const href = confirmHref(await waitForNewEmail(request, to, previousId));
  expect(href, "link /auth/confirm nell'email").toBeDefined();
  const url = new URL(href ?? 'http://invalid.invalid');
  return `${url.pathname}${url.search}`;
};

const signUpCustomer = async (page: Page): Promise<void> => {
  const email = uniqueEmail('ritratto');
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
// Dati di prova
// ---------------------------------------------------------------------------
const createBarbers = async (api: AdminApi, serviceId: string, names: string[]): Promise<string[]> => {
  const ids: string[] = [];
  for (const name of names) {
    const [row] = await api.post<Array<{ id: string }>>('/rest/v1/barbers?select=id', { display_name: name, is_active: true });
    ids.push(row?.id ?? '');
    await api.post('/rest/v1/barber_services?select=barber_id', { barber_id: row?.id, service_id: serviceId });
  }
  return ids;
};

const photoPathOf = async (api: AdminApi, barberId: string): Promise<string | null> => {
  const rows = await api.get<Array<{ photo_path: string | null }>>(`/rest/v1/barbers?select=photo_path&id=eq.${barberId}`);
  expect(rows).toHaveLength(1);
  return rows[0]?.photo_path ?? null;
};

/** Cancella (come admin, via API di Storage) ogni file rimasto nella cartella del barbiere. */
const removeStoredPhotos = async (request: APIRequestContext, token: string, barberId: string): Promise<void> => {
  const list = await request.post(`${supabaseUrl()}/storage/v1/object/list/${BUCKET}`, {
    headers: apiHeaders(token),
    data: { prefix: barberId, limit: 100, offset: 0 },
  });
  if (!list.ok()) return;
  const names = ((await list.json()) as Array<{ name: string }>).map((item) => `${barberId}/${item.name}`);
  if (names.length === 0) return;
  await request.fetch(`${supabaseUrl()}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: apiHeaders(token),
    data: { prefixes: names },
  });
};

/** JPEG 1024×768 (non quadrata) generata al volo: il ridimensionamento lo fanno browser e server. */
const jpegPortrait = (): Promise<Buffer> =>
  sharp({ create: { width: 1024, height: 768, channels: 3, background: { r: 200, g: 140, b: 90 } } })
    .jpeg({ quality: 90 })
    .toBuffer();

test.describe('Ritratti dei barbieri (fetta 8d)', () => {
  test.use({ viewport: DESKTOP });

  test('l\'admin carica un ritratto, il cliente lo vede nella scelta del barbiere, "Rimuovi" riporta l\'iniziale', async ({
    page,
    browser,
  }) => {
    const api = await adminApi(page.request);
    const serviceId = await createService(api, { name: uniqueName('Servizio ritratto'), durationMin: 30 });
    const name = uniqueName('Ritratto');
    const [barberId = '', otherId = ''] = await createBarbers(api, serviceId, [name, uniqueName('Senza ritratto')]);
    // Fetta 8e: "Quando?" mostra le sezioni solo se nel periodo c'è almeno un orario libero
    await api.post(
      '/rest/v1/working_hours?select=id',
      [barberId, otherId].flatMap((barber_id) =>
        [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ barber_id, weekday, start_time: '06:00', end_time: '23:00' })),
      ),
    );
    const customer = await browser.newContext({ ...devices['Pixel 7'] });
    const customerPage = await customer.newPage();
    try {
      const alt = sf('booking.barber.portraitAlt', { name });

      // --- Admin: caricamento dalla scheda del barbiere --------------------------------
      await loginAsAdmin(page);
      acceptDialogs(page);
      await page.goto(`/admin/barbieri/${barberId}`);
      await expect(page.getByRole('heading', { name: s('admin.barbers.portraitTitle'), exact: true })).toBeVisible();
      await page.getByLabel(s('admin.barbers.portraitLabel'), { exact: true }).setInputFiles({
        name: 'ritratto.jpg',
        mimeType: 'image/jpeg',
        buffer: await jpegPortrait(),
      });
      await page.getByRole('button', { name: s('admin.barbers.portraitUpload'), exact: true }).click();

      // dec. 2: percorso generato dal server nel formato <barber_id>/<32 hex>.webp
      await expect
        .poll(async () => photoPathOf(api, barberId), { message: 'photo_path non salvato' })
        .toMatch(PATH_FORMAT(barberId));
      const path = (await photoPathOf(api, barberId)) ?? '';
      // Punto 8 approvato: anteprima nella scheda con lo stesso alt
      await expect(page.getByRole('img', { name: alt, exact: true })).toBeVisible();

      // dec. 3 e 5: file pubblico, WebP 512×512
      const stored = await page.request.get(publicUrl(path));
      expect(stored.status()).toBe(200);
      expect(stored.headers()['content-type']).toBe('image/webp');
      const meta = await sharp(await stored.body()).metadata();
      expect({ format: meta.format, width: meta.width, height: meta.height }).toEqual({ format: 'webp', width: 512, height: 512 });

      // --- Cliente: "Quando?" con il ritratto (fetta 8e) ---------------------------------
      await signUpCustomer(customerPage);
      await customerPage.goto(`/prenota/quando?servizio=${serviceId}`);
      await expectPath(customerPage, '/prenota/quando');
      const main = customerPage.locator('main');
      // Fetta 8f: un ritratto nella colonna del barbiere nel giorno selezionato
      const shownDay = await selectedDate(customerPage);
      const barberLink = whenColumn(customerPage, name, shownDay);
      const portrait = barberLink.getByRole('img', { name: alt, exact: true });
      await expect(portrait).toHaveCount(1);
      await portrait.scrollIntoViewIfNeeded();
      await expect(portrait).toBeVisible();
      // dec. 7: URL pubblico del bucket, niente ottimizzazione di Next, caricamento pigro
      await expect(portrait).toHaveAttribute('src', publicUrl(path));
      await expect(portrait).toHaveAttribute('loading', 'lazy');
      await expect(portrait).toHaveAttribute('decoding', 'async');
      await expect
        .poll(() => portrait.evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth))
        .toBe(512);
      // L'altro barbiere resta con l'iniziale
      expect(otherId).not.toBe('');
      expect(await photoPathOf(api, otherId)).toBeNull();

      // --- Admin: rimozione ---------------------------------------------------------------
      await page.getByRole('button', { name: s('admin.barbers.portraitRemove'), exact: true }).click();
      await expect.poll(async () => photoPathOf(api, barberId), { message: 'photo_path non azzerato' }).toBeNull();
      await expect(page.getByRole('img', { name: alt, exact: true })).toHaveCount(0);
      await expect
        .poll(async () => (await page.request.get(publicUrl(path))).status(), { message: 'file non cancellato dal bucket' })
        .not.toBe(200);

      // --- Cliente: torna l'iniziale --------------------------------------------------------
      await customerPage.reload();
      await expect(main.getByRole('img', { name: alt, exact: true })).toHaveCount(0);
      await expect(barberLink).toBeVisible();
      await expect(barberLink.locator('img')).toHaveCount(0);
      await expect(barberLink.getByText(name.charAt(0), { exact: true })).toBeVisible();
    } finally {
      await customer.close();
      for (const id of [barberId, otherId]) if (id) await removeStoredPhotos(page.request, api.token, id);
      await cleanup(api, { barbers: [barberId, otherId].filter(Boolean), services: [serviceId] });
    }
  });
});
