// Helper condivisi dagli e2e della FETTA 9b (profile-9b, account-deletion, privacy-version). Non è un
// file di test.
//
// Clienti nuovi per ogni test: accesso con il codice a 6 cifre letto da Mailpit (come
// login-code.spec.ts) e completamento del profilo dall'interfaccia, così i consensi li dà davvero
// l'utente. Letture di controllo e pulizia con la service role (solo nel test, come
// admin-customers.spec.ts): profili e utenti auth.
// Prerequisiti: Supabase locale con il seed, Mailpit su http://127.0.0.1:54324,
// NEXT_PUBLIC_SUPABASE_* e SUPABASE_SERVICE_ROLE_KEY (ambiente o .env.local).
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { formatInTimeZone } from 'date-fns-tz';

import { env, expectPath, s, supabaseUrl } from './admin-helpers';
import { newestEmailId, waitForNewEmail, type MailpitMessage } from './mailpit';

export const TZ = 'Europe/Rome';

export const serviceHeaders = (): Record<string, string> => {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
};

/** GET REST con la service role (solo letture di controllo). */
export const serviceGet = async <T>(request: APIRequestContext, path: string): Promise<T> => {
  const response = await request.get(`${supabaseUrl()}${path}`, { headers: serviceHeaders() });
  expect(response.ok(), `GET ${path} fallita: ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
};

/** PATCH REST con la service role. */
export const servicePatch = async (request: APIRequestContext, path: string, data: unknown): Promise<void> => {
  const response = await request.patch(`${supabaseUrl()}${path}`, {
    headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
    data,
  });
  expect(response.ok(), `PATCH ${path} fallita: ${response.status()} ${await response.text()}`).toBe(true);
};

/** Codice a 6 cifre del testo visibile dell'email (link e attributi esclusi). */
const codeFrom = (message: MailpitMessage): string => {
  const visible = message.HTML.replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/g, ' ');
  const codes = [...visible.matchAll(/(?<![\d\w])(\d{6})(?![\d\w])/g)].map((match) => match[1] ?? '');
  expect(codes.length, "l'email deve mostrare il codice a 6 cifre").toBeGreaterThan(0);
  return codes[0] ?? '';
};

/** Accesso con il codice dalla pagina /accedi già aperta (conserva `next`). */
export const loginWithCodeFromCurrentPage = async (page: Page, email: string): Promise<void> => {
  await expectPath(page, '/accedi');
  const before = await newestEmailId(page.request, email);
  await page.getByLabel(s('auth.customerLogin.emailLabel')).fill(email);
  await page.getByRole('button', { name: s('auth.customerLogin.submit') }).click();
  await expect(page.getByText(s('auth.customerLogin.linkSent'))).toBeVisible();
  const message = await waitForNewEmail(page.request, email, before);
  await page.getByLabel(s('auth.loginCode.label'), { exact: true }).fill(codeFrom(message));
  await page.getByRole('button', { name: s('auth.loginCode.submit'), exact: true }).click();
};

export const randomPhone = (): string => `+39 333 ${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

/** Telefono italiano come lo salva il database (E.164). */
export const e164 = (phone: string): string => phone.replace(/[^\d+]/g, '');

export type NewCustomer = { id: string; email: string; fullName: string; phone: string };

/**
 * Cliente nuovo: accesso con il codice, /profilo/completa con nome, telefono, privacy e (a scelta)
 * marketing. Restituisce l'id del profilo letto con la service role.
 */
export const signUpCustomer = async (
  page: Page,
  values: { email: string; fullName: string; marketing?: boolean },
): Promise<NewCustomer> => {
  const phone = randomPhone();
  await page.goto('/accedi');
  await loginWithCodeFromCurrentPage(page, values.email);
  await expectPath(page, '/profilo/completa');
  await page.getByLabel(s('auth.completeProfile.fullNameLabel')).fill(values.fullName);
  await page.getByLabel(s('auth.completeProfile.phoneLabel')).fill(phone);
  await page.getByLabel(s('auth.completeProfile.privacyConsentLabel')).check();
  if (values.marketing) await page.getByLabel(s('auth.completeProfile.marketingConsentLabel')).check();
  await page.getByRole('button', { name: s('auth.completeProfile.submit') }).click();
  await expectPath(page, '/');
  const rows = await serviceGet<Array<{ id: string }>>(
    page.request,
    `/rest/v1/profiles?select=id&full_name=eq.${encodeURIComponent(values.fullName)}`,
  );
  expect(rows).toHaveLength(1);
  return { id: rows[0]?.id ?? '', email: values.email, fullName: values.fullName, phone };
};

export type ProfileRow = {
  full_name: string | null;
  phone: string | null;
  privacy_policy_version: string | null;
  privacy_consent_at: string | null;
  marketing_consent: boolean;
  marketing_consent_at: string | null;
};

export const profileOf = async (request: APIRequestContext, id: string): Promise<ProfileRow | undefined> =>
  (
    await serviceGet<ProfileRow[]>(
      request,
      `/rest/v1/profiles?select=full_name,phone,privacy_policy_version,privacy_consent_at,marketing_consent,marketing_consent_at&id=eq.${id}`,
    )
  )[0];

/** Id dell'utente auth con questa email (null se non esiste). */
export const authUserIdByEmail = async (request: APIRequestContext, email: string): Promise<string | null> => {
  for (let pageNumber = 1; pageNumber <= 20; pageNumber += 1) {
    const response = await request.get(`${supabaseUrl()}/auth/v1/admin/users?page=${pageNumber}&per_page=200`, {
      headers: serviceHeaders(),
    });
    expect(response.ok(), `elenco utenti non leggibile: ${response.status()}`).toBe(true);
    const { users } = (await response.json()) as { users: Array<{ id: string; email?: string }> };
    const found = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (users.length < 200) return null;
  }
  return null;
};

/** Pulizia: elimina l'utente auth (ignora quello già eliminato). */
export const deleteAuthUser = async (request: APIRequestContext, id: string | null | undefined): Promise<void> => {
  if (!id) return;
  await request.delete(`${supabaseUrl()}/auth/v1/admin/users/${id}`, { headers: serviceHeaders() });
};

/** Versione corrente dell'informativa (lettura pubblica di shop_settings). */
export const currentPolicyVersion = async (request: APIRequestContext): Promise<string> => {
  const [row] = await serviceGet<Array<{ privacy_policy_version: string }>>(
    request,
    '/rest/v1/shop_settings?select=privacy_policy_version',
  );
  expect(row?.privacy_policy_version).toBeTruthy();
  return row?.privacy_policy_version ?? '';
};

/** Oggi a Roma come gg/mm/aaaa (formato delle date mostrate, decisione fetta 3). */
export const todayRome = (): string => formatInTimeZone(new Date(), TZ, 'dd/MM/yyyy');

/** Parte di un testo di it.ts prima del primo segnaposto `{…}` (es. "Consenso dato il "). */
export const prefixOf = (key: string): string => s(key).split('{')[0] ?? '';

export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Nessun overflow orizzontale della pagina. */
export const expectNoHorizontalOverflow = async (page: Page, label: string): Promise<void> => {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `overflow orizzontale su ${label}`).toBeLessThanOrEqual(clientWidth);
};

export const PHONE_VIEWPORT = { width: 390, height: 844 };
