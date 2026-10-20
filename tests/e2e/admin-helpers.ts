// Helper condivisi dagli e2e della FETTA 3 (tests/e2e/admin-*.spec.ts). Non è un file di test.
//
// Prerequisiti: Supabase locale avviato con il seed (`npx supabase db reset`); URL e chiave
// pubblica da NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (ambiente o .env.local).
// I dati di prova si preparano e si puliscono via API REST con il token dell'admin demo (RLS
// attiva): i test non usano la service_role. Nomi e date sono univoci per test, così i file
// girano in parallelo (fullyParallel) e in qualsiasi ordine.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

// Percorso relativo voluto: non dipende dalla risoluzione dell'alias `@/*` in Playwright.
import { it } from '../../src/i18n/it';

export const DEMO_PASSWORD = 'demo1234';
export const ADMIN_EMAIL = 'admin@demo.local';
export const BARBER_EMAIL = 'barber@demo.local';
export const CUSTOMER_EMAIL = 'cliente@demo.local';
export const DESKTOP = { width: 1280, height: 800 };

/** Id del seed (supabase/seed.sql). */
export const SEED = {
  adminProfile: 'a0000000-0000-4000-8000-000000000001',
  barberProfile: 'a0000000-0000-4000-8000-000000000002',
  customerProfile: 'a0000000-0000-4000-8000-000000000003',
  mario: 'b0000000-0000-4000-8000-000000000001',
  luca: 'b0000000-0000-4000-8000-000000000002',
  sara: 'b0000000-0000-4000-8000-000000000003',
  taglio: '50000000-0000-4000-8000-000000000001',
  barba: '50000000-0000-4000-8000-000000000002',
} as const;

// ---------------------------------------------------------------------------
// Testi dell'interfaccia (SPEC §9: tutto da src/i18n/it.ts)
// ---------------------------------------------------------------------------
/** Stringa di `it` per percorso (`admin.services.new`); errore chiaro se la chiave manca. */
export const s = (path: string): string => {
  let node: unknown = it;
  for (const key of path.split('.')) {
    node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined;
  }
  if (typeof node !== 'string' || node.trim() === '') {
    throw new Error(`chiave i18n mancante in src/i18n/it.ts: it.${path}`);
  }
  return node;
};

/** Stringa con segnaposto `{nome}` sostituiti (es. `{count}`). */
export const sf = (path: string, values: Record<string, string | number>): string => {
  let text = s(path);
  for (const [key, value] of Object.entries(values)) text = text.split(`{${key}}`).join(String(value));
  return text;
};

// ---------------------------------------------------------------------------
// Ambiente
// ---------------------------------------------------------------------------
const readEnvFile = (name: string): string | undefined => {
  const path = resolve(process.cwd(), '.env.local');
  if (!existsSync(path)) return undefined;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('#') || !line.startsWith(`${name}=`)) continue;
    return line
      .slice(name.length + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
  }
  return undefined;
};

export const env = (name: string): string => {
  const value = process.env[name] ?? readEnvFile(name);
  if (value === undefined || value === '') {
    throw new Error(`variabile mancante: ${name} (ambiente o .env.local, vedi .env.example)`);
  }
  return value;
};

export const supabaseUrl = (): string => env('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');

export const apiHeaders = (accessToken?: string): Record<string, string> => ({
  apikey: env('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  'Content-Type': 'application/json',
  ...(accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` }),
});

// ---------------------------------------------------------------------------
// Dati univoci
// ---------------------------------------------------------------------------
let counter = 0;
const randomTag = (): string => {
  counter += 1;
  return `${Date.now().toString(36)}${counter}${Math.random().toString(36).slice(2, 7)}`;
};

/** Nome leggibile e univoco: "E2E <etichetta> <tag>". */
export const uniqueName = (label: string): string => `E2E ${label} ${randomTag()}`;

export const uniqueEmail = (label: string): string => `e2e-${label}-${randomTag()}@qa.test`;

const pad = (value: number): string => String(value).padStart(2, '0');
const randomInt = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1));

/**
 * Data futura casuale in gennaio o febbraio (sempre ora solare, UTC+1 a Roma) di un anno fra il
 * 2032 e il 2049: test diversi difficilmente scelgono lo stesso giorno.
 */
export const randomWinterDate = (): string =>
  `${randomInt(2032, 2049)}-${pad(randomInt(1, 2))}-${pad(randomInt(1, 28))}`;

/** `YYYY-MM-DD` + n giorni. */
export const plusDays = (date: string, days: number): string => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

/** Ora di Roma in gennaio/febbraio (UTC+1) come istante ISO. */
export const romeWinter = (date: string, time: string): string => `${date}T${time}:00+01:00`;

/** Decisione fetta 3: le date si mostrano come gg/mm/aaaa. */
export const itDate = (date: string): string => {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
};

/** Istante in millisecondi, per confrontare timestamptz restituiti dal database. */
export const instant = (value: string): number => new Date(value).getTime();

// ---------------------------------------------------------------------------
// Navigazione e interfaccia
// ---------------------------------------------------------------------------
export const pathOf = (page: Page): string => new URL(page.url()).pathname;

export const expectPath = async (page: Page, pathname: string): Promise<void> => {
  await expect.poll(() => pathOf(page), { message: `percorso atteso: ${pathname}` }).toBe(pathname);
};

export const staffLogin = async (page: Page, email: string, password: string): Promise<void> => {
  await page.goto('/admin/login');
  await page.getByLabel(s('auth.staffLogin.emailLabel')).fill(email);
  await page.getByLabel(s('auth.staffLogin.passwordLabel')).fill(password);
  await page.getByRole('button', { name: s('auth.staffLogin.submit') }).click();
};

/**
 * Dopo il login aspetta l'area staff (il suo menu) fino a 15 s: sotto carico, in dev, il redirect a
 * /admin può superare i 5 s di expectPath. Poi il controllo del percorso, invariato.
 */
export const waitForStaffArea = async (page: Page): Promise<void> => {
  await page
    .getByRole('navigation', { name: s('admin.nav.label'), exact: true })
    .waitFor({ state: 'visible', timeout: 15_000 });
};

export const loginAsAdmin = async (page: Page): Promise<void> => {
  await staffLogin(page, ADMIN_EMAIL, DEMO_PASSWORD);
  await waitForStaffArea(page);
  await expectPath(page, '/admin');
};

export const loginAsBarber = async (page: Page): Promise<void> => {
  await staffLogin(page, BARBER_EMAIL, DEMO_PASSWORD);
  await waitForStaffArea(page);
  await expectPath(page, '/admin');
};

export const adminNavLink = (page: Page, key: string): Locator =>
  page.getByRole('navigation').getByRole('link', { name: s(key), exact: true });

/** Riga di una tabella dell'area admin che contiene il testo (nome univoco). */
export const rowWith = (page: Page, text: string): Locator =>
  page.locator('main').getByRole('row').filter({ hasText: text });

/** Link o pulsante con il testo dato (es. "Nuovo servizio"). */
export const linkOrButton = (scope: Page | Locator, name: string): Locator =>
  scope.getByRole('link', { name, exact: true }).or(scope.getByRole('button', { name, exact: true }));

export const field = (scope: Page | Locator, key: string): Locator => scope.getByLabel(s(key), { exact: true });

export const saveButton = (scope: Page | Locator): Locator =>
  scope.getByRole('button', { name: s('admin.common.save'), exact: true });

/** Accetta eventuali conferme native (eliminazioni): il test non dipende dalla loro presenza. */
export const acceptDialogs = (page: Page): void => {
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
};

/**
 * Disattiva la validazione nativa del browser (required, min, minlength...): i test sugli input
 * non validi devono arrivare alla server action, che li rifiuta con Zod (CLAUDE.md – Sicurezza).
 */
export const disableNativeValidation = async (page: Page): Promise<void> => {
  await page.locator('form').evaluateAll((forms) => {
    for (const form of forms) (form as HTMLFormElement).noValidate = true;
  });
};

/** Il separatore fra importo e "€" può essere uno spazio normale o non separabile. */
export const euro = (text: string): RegExp => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s'));

// ---------------------------------------------------------------------------
// API REST come admin demo (RLS attiva)
// ---------------------------------------------------------------------------
type Json = Record<string, unknown>;

export type AdminApi = {
  token: string;
  get: <T = Json[]>(path: string) => Promise<T>;
  post: <T = Json[]>(path: string, data: unknown) => Promise<T>;
  patch: <T = Json[]>(path: string, data: unknown) => Promise<T>;
  del: (path: string) => Promise<void>;
  rpc: <T = Json[]>(name: string, args?: Json) => Promise<T>;
};

export const passwordSession = async (
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<{ access_token: string; refresh_token: string; user: { id: string } }> => {
  const response = await request.post(`${supabaseUrl()}/auth/v1/token?grant_type=password`, {
    headers: apiHeaders(),
    data: { email, password },
  });
  expect(response.ok(), `login via API fallito per ${email}: ${response.status()}`).toBe(true);
  return (await response.json()) as { access_token: string; refresh_token: string; user: { id: string } };
};

export const adminApi = async (request: APIRequestContext): Promise<AdminApi> => {
  const { access_token: token } = await passwordSession(request, ADMIN_EMAIL, DEMO_PASSWORD);
  // DELETE con return=minimal: la rappresentazione di barbers richiederebbe la lettura di tutte
  // le colonne, compresa profile_id (grant di colonna, ADR 001)
  const call = async <T>(method: string, path: string, data?: unknown): Promise<T> => {
    const response = await request.fetch(`${supabaseUrl()}${path}`, {
      method,
      headers: { ...apiHeaders(token), Prefer: method === 'DELETE' ? 'return=minimal' : 'return=representation' },
      ...(data === undefined ? {} : { data }),
    });
    expect(response.ok(), `${method} ${path} fallita: ${response.status()} ${await response.text()}`).toBe(true);
    const body = await response.text();
    return (body === '' ? null : JSON.parse(body)) as T;
  };
  return {
    token,
    get: (path) => call('GET', path),
    post: (path, data) => call('POST', path, data),
    patch: (path, data) => call('PATCH', path, data),
    del: async (path) => {
      await call('DELETE', path);
    },
    rpc: (name, args = {}) => call('POST', `/rest/v1/rpc/${name}`, args),
  };
};

// ---------------------------------------------------------------------------
// Dati di prova
// ---------------------------------------------------------------------------
export const createService = async (
  api: AdminApi,
  values: { name: string; durationMin?: number; priceCents?: number; sortOrder?: number; isActive?: boolean },
): Promise<string> => {
  const rows = await api.post<Array<{ id: string }>>('/rest/v1/services?select=id', {
    name: values.name,
    duration_min: values.durationMin ?? 20,
    price_cents: values.priceCents ?? 1500,
    sort_order: values.sortOrder ?? 0,
    is_active: values.isActive ?? true,
  });
  expect(rows).toHaveLength(1);
  return rows[0]?.id ?? '';
};

/** Barbiere senza account (le colonne si elencano: grant di colonna su barbers). */
export const createBarber = async (api: AdminApi, displayName: string, serviceIds: string[] = []): Promise<string> => {
  const rows = await api.post<Array<{ id: string }>>('/rest/v1/barbers?select=id', {
    display_name: displayName,
    is_active: true,
  });
  expect(rows).toHaveLength(1);
  const id = rows[0]?.id ?? '';
  if (serviceIds.length > 0) {
    await api.post(
      '/rest/v1/barber_services?select=barber_id',
      serviceIds.map((serviceId) => ({ barber_id: id, service_id: serviceId })),
    );
  }
  return id;
};

/**
 * Prenotazione manuale per un ospite (prezzo, durata e fine li calcola il database); di default
 * confermata. L'admin può inserire anche prenotazioni passate o già cancellate (ADR 001).
 */
export const createBooking = async (
  api: AdminApi,
  values: { barberId: string; serviceId: string; startsAt: string; status?: 'confirmed' | 'cancelled_by_shop' },
): Promise<string> => {
  const rows = await api.post<Array<{ id: string }>>('/rest/v1/bookings?select=id', {
    guest_name: 'E2E Ospite',
    guest_phone: '+393330000000',
    barber_id: values.barberId,
    service_id: values.serviceId,
    starts_at: values.startsAt,
    source: 'manual',
    status: values.status ?? 'confirmed',
  });
  expect(rows).toHaveLength(1);
  return rows[0]?.id ?? '';
};

export const bookingStatuses = async (api: AdminApi, ids: string[]): Promise<string[]> => {
  const rows = await api.get<Array<{ id: string; status: string }>>(
    `/rest/v1/bookings?select=id,status&id=in.(${ids.join(',')})&order=starts_at`,
  );
  return rows.map((row) => row.status);
};

/** Conta le prenotazioni confermate che si sovrappongono a [startsAt, endsAt). */
export const countConfirmedOverlapping = async (
  api: AdminApi,
  startsAt: string,
  endsAt: string,
  barberId?: string,
): Promise<number> => {
  const params = new URLSearchParams({ select: 'id', status: 'eq.confirmed' });
  params.append('starts_at', `lt.${endsAt}`);
  params.append('ends_at', `gt.${startsAt}`);
  if (barberId !== undefined) params.append('barber_id', `eq.${barberId}`);
  const rows = await api.get<Json[]>(`/rest/v1/bookings?${params.toString()}`);
  return rows.length;
};

/** Pulizia di fine test: prenotazioni, poi barbieri e servizi (FK on delete restrict). */
export const cleanup = async (
  api: AdminApi,
  data: { bookings?: string[]; barbers?: string[]; services?: string[]; closureReasons?: string[]; timeOffReasons?: string[] },
): Promise<void> => {
  const list = (ids: string[]): string => ids.join(',');
  if (data.bookings?.length) await api.del(`/rest/v1/bookings?id=in.(${list(data.bookings)})`);
  if (data.barbers?.length) {
    await api.del(`/rest/v1/bookings?barber_id=in.(${list(data.barbers)})`);
    try {
      await api.del(`/rest/v1/barbers?id=in.(${list(data.barbers)})`);
    } catch (error) {
      // Un barbiere rimasto attivo allarga il calendario degli altri test (colonne in più): se non
      // si può eliminare, almeno si disattiva.
      await api.patch(`/rest/v1/barbers?id=in.(${list(data.barbers)})`, { is_active: false });
      console.warn('cleanup: barbieri disattivati invece che eliminati', error);
    }
  }
  if (data.services?.length) {
    await api.del(`/rest/v1/bookings?service_id=in.(${list(data.services)})`);
    await api.del(`/rest/v1/services?id=in.(${list(data.services)})`);
  }
  for (const reason of data.closureReasons ?? []) {
    await api.del(`/rest/v1/shop_closures?reason=eq.${encodeURIComponent(reason)}`);
  }
  for (const reason of data.timeOffReasons ?? []) {
    await api.del(`/rest/v1/time_off?reason=eq.${encodeURIComponent(reason)}`);
  }
};
