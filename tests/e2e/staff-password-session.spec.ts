// Test di accettazione – FETTA 8h "Sicurezza dati", punto 2 dell'audit del 2026-10-30 (decisioni
// approvate dall'utente il 2026-11-08). SPEC §2 (lo staff entra con email e password), §11 riga 8h
// ("una sessione staff senza password non ha privilegi nel database").
//
// Il percorso dell'audit: chiunque abbia la casella email del negozio chiede un codice direttamente a
// Supabase (chiave pubblica), lo verifica e ottiene una sessione dell'admin senza password. Con quella
// sessione:
//   - via REST non legge prenotazioni, profili dei clienti, note interne, né l'elenco clienti;
//   - nel browser (cookie di @supabase/ssr) /admin porta a /admin/login?motivo=password con il
//     messaggio it.auth.staffLogin.passwordRequired e i cookie della sessione vengono tolti.
// Nessun dato creato; la sessione ottenuta viene chiusa alla fine. Le email di prova all'admin
// vengono tolte da Mailpit prima della richiesta.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).
import { expect, test, type APIRequestContext } from '@playwright/test';

import { ADMIN_EMAIL, apiHeaders, expectPath, s, supabaseUrl } from './admin-helpers';
import { MAILPIT_URL, newestEmailId, waitForNewEmail } from './mailpit';

type Session = { access_token: string; refresh_token: string; expires_at?: number; user?: { id: string } };

const isAuthTokenCookie = (name: string): boolean => name.startsWith('sb-') && /-auth-token(?:\.\d+)?$/.test(name);

/** Claim del JWT (senza verifica: serve solo a documentare il metodo di accesso). */
const claimsOf = (token: string): { amr?: Array<{ method: string }> } =>
  JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { amr?: Array<{ method: string }> };

/** Sessione dell'admin ottenuta con il codice email, chiamando direttamente Supabase. */
const adminSessionByEmailCode = async (request: APIRequestContext): Promise<Session> => {
  // Casella dell'admin vuota in Mailpit: il codice letto è quello appena inviato
  const cleared = await request.delete(`${MAILPIT_URL}/api/v1/search`, { params: { query: `to:"${ADMIN_EMAIL}"` } });
  expect(cleared.ok(), 'pulizia di Mailpit').toBe(true);
  const before = await newestEmailId(request, ADMIN_EMAIL);

  const otp = await request.post(`${supabaseUrl()}/auth/v1/otp`, {
    headers: apiHeaders(),
    data: { email: ADMIN_EMAIL, create_user: false },
  });
  expect(otp.ok(), `richiesta del codice: ${otp.status()} ${await otp.text()}`).toBe(true);

  const message = await waitForNewEmail(request, ADMIN_EMAIL, before);
  const visible = message.HTML.replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/g, ' ');
  const code = visible.match(/(?<![\d\w])(\d{6})(?![\d\w])/)?.[1] ?? '';
  expect(code, 'codice a 6 cifre nell\'email').toMatch(/^\d{6}$/);

  const verify = await request.post(`${supabaseUrl()}/auth/v1/verify`, {
    headers: apiHeaders(),
    data: { type: 'email', email: ADMIN_EMAIL, token: code },
  });
  expect(verify.ok(), `verifica del codice: ${verify.status()} ${await verify.text()}`).toBe(true);
  const session = (await verify.json()) as Session;
  expect(session.access_token).toBeTruthy();
  return session;
};

const rest = (request: APIRequestContext, token: string, path: string) =>
  request.get(`${supabaseUrl()}/rest/v1/${path}`, { headers: apiHeaders(token) });

test('admin entrato con il codice email: nessun dato via REST e /admin chiede la password', async ({ page, context, request, baseURL }) => {
  const session = await adminSessionByEmailCode(request);
  try {
    // Premessa: il token dice che l'accesso è avvenuto con il codice, non con la password
    expect(claimsOf(session.access_token).amr?.map((entry) => entry.method)).toEqual(['otp']);

    // --- REST con la sessione senza password: come un utente senza privilegi staff ---
    const bookings = await rest(request, session.access_token, 'bookings?select=id');
    expect(bookings.status()).toBe(200);
    expect(await bookings.json(), 'nessuna prenotazione leggibile').toEqual([]);

    const customers = await rest(request, session.access_token, 'profiles?select=id&role=eq.customer');
    expect(customers.status()).toBe(200);
    expect(await customers.json(), 'nessun profilo di cliente leggibile').toEqual([]);

    const notes = await rest(request, session.access_token, 'booking_staff_notes?select=booking_id');
    expect(notes.status()).toBe(200);
    expect(await notes.json(), 'nessuna nota interna leggibile').toEqual([]);

    const list = await request.post(`${supabaseUrl()}/rest/v1/rpc/admin_customers`, {
      headers: apiHeaders(session.access_token),
      data: {},
    });
    expect(list.status(), 'admin_customers rifiutata').toBe(403);
    expect(((await list.json()) as { code?: string }).code).toBe('42501');

    // --- Browser: la stessa sessione nei cookie di @supabase/ssr ---
    const ref = new URL(supabaseUrl()).hostname.split('.')[0];
    const value = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`;
    const chunks = value.match(/.{1,3000}/g) ?? [];
    await context.addCookies(
      chunks.map((chunk, index) => ({ name: `sb-${ref}-auth-token.${index}`, value: chunk, url: baseURL ?? 'http://localhost:3000' })),
    );

    await page.goto('/admin');
    await expectPath(page, '/admin/login');
    expect(new URL(page.url()).searchParams.get('motivo')).toBe('password');
    await expect(page.getByText(s('auth.staffLogin.passwordRequired'))).toBeVisible();
    expect((await context.cookies()).filter((cookie) => isAuthTokenCookie(cookie.name)), 'cookie della sessione tolti').toEqual([]);

    // Il login resta raggiungibile: nessun rimando a /admin
    await page.goto('/admin/login');
    await expectPath(page, '/admin/login');
    await expect(page.getByRole('heading', { name: s('auth.staffLogin.title') })).toBeVisible();
  } finally {
    // Chiude la sessione ottenuta con il codice
    await request.post(`${supabaseUrl()}/auth/v1/logout?scope=local`, { headers: apiHeaders(session.access_token) });
  }
});
