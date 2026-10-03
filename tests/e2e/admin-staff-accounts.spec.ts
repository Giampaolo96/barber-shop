// Test di accettazione e2e – FETTA 3 (SPEC §11). Account staff dei barbieri creati dall'admin.
// Sezioni: SPEC §2 (un solo ruolo per utente), §3.3 ("collegamento opzionale a un account staff"),
// §5.5 (lo staff entra con email e password da /admin/login, senza auto-registrazione), §8
// + decisioni approvate per la fetta 2 (staff bloccato) e per la fetta 3 (punti C ed E).
// Contratto dell'interfaccia (decisione fetta 3): nella scheda del barbiere (link di riga
// it.admin.common.edit da /admin/barbieri) c'è la sezione it.admin.staff.title:
// - senza account: campi it.admin.staff.emailLabel / passwordLabel / displayNameLabel e pulsante
//   it.admin.staff.create; esito it.admin.staff.created oppure it.admin.staff.emailTaken;
// - con account: pulsante it.admin.staff.block oppure it.admin.staff.unblock.
// Il blocco revoca anche le sessioni lato server (revoke_user_sessions): il refresh token
// ottenuto prima del blocco non funziona più.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  CUSTOMER_EMAIL,
  DESKTOP,
  SEED,
  adminApi,
  adminNavLink,
  apiHeaders,
  cleanup,
  createBarber,
  disableNativeValidation,
  expectPath,
  field,
  loginAsAdmin,
  passwordSession,
  rowWith,
  s,
  staffLogin,
  supabaseUrl,
  uniqueEmail,
  uniqueName,
} from './admin-helpers';

const PASSWORD = 'Barbiere-e2e-2026';

const openBarberCard = async (page: Page, barberName: string): Promise<void> => {
  await page.goto('/admin/barbieri');
  await rowWith(page, barberName).getByRole('link', { name: s('admin.common.edit'), exact: true }).click();
  await expect(page.getByRole('heading', { name: s('admin.staff.title') })).toBeVisible();
};

const fillAccount = async (page: Page, email: string, password: string, displayName: string): Promise<void> => {
  await field(page, 'admin.staff.emailLabel').fill(email);
  await field(page, 'admin.staff.passwordLabel').fill(password);
  await field(page, 'admin.staff.displayNameLabel').fill(displayName);
};

const createButton = (page: Page) => page.getByRole('button', { name: s('admin.staff.create'), exact: true });
const blockButton = (page: Page) => page.getByRole('button', { name: s('admin.staff.block'), exact: true });
const unblockButton = (page: Page) => page.getByRole('button', { name: s('admin.staff.unblock'), exact: true });

const linkedProfile = async (api: Awaited<ReturnType<typeof adminApi>>, barberId: string): Promise<string | null> => {
  const rows = await api.rpc<Array<{ barber_id: string; profile_id: string | null }>>('barber_accounts');
  return rows.find((row) => row.barber_id === barberId)?.profile_id ?? null;
};

const profileOf = async (api: Awaited<ReturnType<typeof adminApi>>, id: string) => {
  const rows = await api.get<Array<{ role: string; is_blocked: boolean; full_name: string | null }>>(
    `/rest/v1/profiles?select=role,is_blocked,full_name&id=eq.${id}`,
  );
  return rows[0];
};

/** Il barbiere entra da /admin/login in un browser separato (sessione indipendente dall'admin). */
const barberPage = async (browser: Browser): Promise<Page> => {
  const context = await browser.newContext({ viewport: DESKTOP });
  return context.newPage();
};

test.describe('Admin – account staff dei barbieri (SPEC §2, §3.3, §5.5)', () => {
  test.use({ viewport: DESKTOP });

  test('l\'admin crea l\'account di un barbiere: il barbiere entra da /admin/login con il ruolo barber', async ({
    page,
    browser,
  }) => {
    const api = await adminApi(page.request);
    const barberName = uniqueName('Barbiere account');
    const barberId = await createBarber(api, barberName, [SEED.taglio]);
    const email = uniqueEmail('nuovo-barbiere');

    try {
      await loginAsAdmin(page);
      await openBarberCard(page, barberName);
      await fillAccount(page, email, PASSWORD, 'Nuovo Barbiere E2E');
      // SPEC §2: il ruolo non arriva dal client, nemmeno con un campo aggiunto al modulo
      await field(page, 'admin.staff.emailLabel').evaluate((input) => {
        const extra = document.createElement('input');
        extra.type = 'hidden';
        extra.name = 'role';
        extra.value = 'admin';
        (input as HTMLInputElement).form?.appendChild(extra);
      });
      await createButton(page).click();
      await expect(page.getByText(s('admin.staff.created'))).toBeVisible();
      await expect(blockButton(page)).toBeVisible();

      // Collegamento alla scheda e ruolo barber
      const profileId = await linkedProfile(api, barberId);
      expect(profileId, 'account non collegato alla scheda del barbiere').not.toBeNull();
      expect(await profileOf(api, profileId ?? '')).toMatchObject({ role: 'barber', is_blocked: false, full_name: 'Nuovo Barbiere E2E' });

      // SPEC §5.5: lo staff entra con email e password, senza conferme aggiuntive
      const barber = await barberPage(browser);
      await staffLogin(barber, email, PASSWORD);
      await expectPath(barber, '/admin');
      await expect(adminNavLink(barber, 'admin.nav.calendar')).toBeVisible();
      await expect(adminNavLink(barber, 'admin.nav.timeOff')).toBeVisible();
      await expect(adminNavLink(barber, 'admin.nav.services')).toHaveCount(0);
      await expect(adminNavLink(barber, 'admin.nav.settings')).toHaveCount(0);
      await barber.goto('/admin/servizi');
      await expectPath(barber, '/admin');
      await barber.context().close();

      // La scheda ha già un account: nessun modulo per crearne un altro
      await openBarberCard(page, barberName);
      await expect(createButton(page)).toHaveCount(0);
    } finally {
      await cleanup(api, { barbers: [barberId] });
    }
  });

  // Decisione fetta 3: email già registrata → messaggio chiaro, il cliente resta cliente
  test('email già registrata (cliente demo): messaggio chiaro, nessun account e il cliente resta cliente', async ({
    page,
  }) => {
    const api = await adminApi(page.request);
    const barberName = uniqueName('Barbiere email presa');
    const barberId = await createBarber(api, barberName);
    const before = await profileOf(api, SEED.customerProfile);

    try {
      await loginAsAdmin(page);
      await openBarberCard(page, barberName);
      await fillAccount(page, CUSTOMER_EMAIL, PASSWORD, 'Non Diventa Barbiere');
      await createButton(page).click();

      await expect(page.getByText(s('admin.staff.emailTaken'))).toBeVisible();
      await expect(page.getByText(s('admin.staff.created'))).toHaveCount(0);
      expect(await linkedProfile(api, barberId)).toBeNull();
      expect(await profileOf(api, SEED.customerProfile)).toEqual(before);
      expect(before?.role).toBe('customer');

      // Il cliente continua a non entrare in /admin con la sua password
      await page.context().clearCookies();
      await staffLogin(page, CUSTOMER_EMAIL, 'demo1234');
      await expect(page.getByText(s('auth.staffLogin.invalidCredentials'))).toBeVisible();
      await expectPath(page, '/admin/login');
    } finally {
      await cleanup(api, { barbers: [barberId] });
    }
  });

  // CLAUDE.md – Sicurezza / config.toml: password nuove di almeno 10 caratteri
  test('password più corta di 10 caratteri: errore e nessun account', async ({ page }) => {
    const api = await adminApi(page.request);
    const barberName = uniqueName('Barbiere password corta');
    const barberId = await createBarber(api, barberName);
    const email = uniqueEmail('password-corta');

    try {
      await loginAsAdmin(page);
      await openBarberCard(page, barberName);
      await fillAccount(page, email, 'corta-123', 'Password Corta');
      await disableNativeValidation(page);
      await createButton(page).click();
      await expect(page.getByText(s('admin.common.invalid'))).toBeVisible();
      expect(await linkedProfile(api, barberId)).toBeNull();

      await page.context().clearCookies();
      await staffLogin(page, email, 'corta-123');
      await expect(page.getByText(s('auth.staffLogin.invalidCredentials'))).toBeVisible();
    } finally {
      await cleanup(api, { barbers: [barberId] });
    }
  });

  // Decisioni fetta 2 e 3: blocco con messaggio "Account disabilitato", sessione aperta respinta,
  // sessioni revocate lato server; lo sblocco riapre l'accesso
  test('blocco e sblocco dell\'account: login respinto, sessione aperta respinta, refresh token revocato', async ({
    page,
    browser,
    request,
  }) => {
    const api = await adminApi(page.request);
    const barberName = uniqueName('Barbiere da bloccare');
    const barberId = await createBarber(api, barberName);
    const email = uniqueEmail('da-bloccare');

    try {
      await loginAsAdmin(page);
      await openBarberCard(page, barberName);
      await fillAccount(page, email, PASSWORD, 'Barbiere Da Bloccare');
      await createButton(page).click();
      await expect(page.getByText(s('admin.staff.created'))).toBeVisible();
      const profileId = (await linkedProfile(api, barberId)) ?? '';
      expect(profileId).not.toBe('');

      // Il barbiere ha una sessione aperta nel browser e una sessione via API
      const barber = await barberPage(browser);
      await staffLogin(barber, email, PASSWORD);
      await expectPath(barber, '/admin');
      const apiSession = await passwordSession(request, email, PASSWORD);

      // Blocco
      await blockButton(page).click();
      await expect(unblockButton(page)).toBeVisible();
      await expect.poll(async () => (await profileOf(api, profileId))?.is_blocked).toBe(true);

      // Sessione già aperta: respinta alla visita successiva
      await barber.goto('/admin');
      await expectPath(barber, '/admin/login');
      await expect(barber.getByText(s('auth.staffLogin.accountDisabled'))).toBeVisible();
      await expect(adminNavLink(barber, 'admin.nav.calendar')).toHaveCount(0);

      // Sessioni revocate lato server: il refresh token di prima non funziona più
      const refresh = await request.post(`${supabaseUrl()}/auth/v1/token?grant_type=refresh_token`, {
        headers: apiHeaders(),
        data: { refresh_token: apiSession.refresh_token },
      });
      expect(refresh.ok(), 'il refresh token ottenuto prima del blocco funziona ancora').toBe(false);

      // Nuovo login: "Account disabilitato"
      await staffLogin(barber, email, PASSWORD);
      await expect(barber.getByText(s('auth.staffLogin.accountDisabled'))).toBeVisible();
      await expectPath(barber, '/admin/login');

      // Sblocco: il barbiere torna a entrare
      await page.reload();
      await unblockButton(page).click();
      await expect(blockButton(page)).toBeVisible();
      await expect.poll(async () => (await profileOf(api, profileId))?.is_blocked).toBe(false);
      await staffLogin(barber, email, PASSWORD);
      await expectPath(barber, '/admin');
      await expect(adminNavLink(barber, 'admin.nav.calendar')).toBeVisible();
      await barber.context().close();
    } finally {
      await cleanup(api, { barbers: [barberId] });
    }
  });

  // Decisione fetta 3: l'admin non può bloccare se stesso
  test('nella scheda collegata all\'admin non c\'è il pulsante per bloccarlo', async ({ page }) => {
    const api = await adminApi(page.request);
    const [mario] = await api.get<Array<{ display_name: string }>>(
      `/rest/v1/barbers?select=display_name&id=eq.${SEED.mario}`,
    );
    expect(await linkedProfile(api, SEED.mario)).toBe(SEED.adminProfile);

    await loginAsAdmin(page);
    await page.goto('/admin/barbieri');
    await rowWith(page, mario?.display_name ?? 'Mario').first().getByRole('link', { name: s('admin.common.edit'), exact: true }).click();
    await expect(page.getByRole('heading', { name: s('admin.staff.title') })).toBeVisible();
    await expect(blockButton(page)).toHaveCount(0);
    await expect(createButton(page)).toHaveCount(0);
  });
});
