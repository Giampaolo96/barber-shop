// Regressioni della review della fetta 5 (scritte durante l'implementazione, non da spec-qa).
// - ritorno dopo il login: codifica e decodifica di `next`, lunghezza massima, /profilo/completa;
// - testi d'errore con i limiti come segnaposto; codice `unavailable`;
// - versione dell'informativa in sola lettura nelle impostazioni (fino alla fetta 9).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { it as texts } from '@/i18n/it';
import { editableSettingsSchema, settingsSchema } from '@/lib/admin/schemas';
import {
  NEXT_MAX_LENGTH,
  completeProfileUrl,
  destinationAfterLogin,
  emailRedirectUrl,
  nextFromEmailLink,
  safeNextPath,
} from '@/lib/auth/safe-next-path';
import { emailLinkSchema, emailLoginSchema } from '@/lib/auth/schemas';
import { bookingErrorMessage, bookingErrorText } from '@/lib/booking/errors';
import { ONLINE_BOOKING_LIMITS } from '@/lib/booking/rules';

const ORIGIN = 'http://localhost:3000';
const NEXT = '/prenota/orario?servizio=50000000-0000-4000-8000-000000000001&barbiere=any&giorno=2027-01-12';

describe('ritorno dopo il magic link: emailRedirectUrl / nextFromEmailLink', () => {
  test('round-trip: la destinazione con i parametri torna intatta', () => {
    expect(nextFromEmailLink(emailRedirectUrl(ORIGIN, NEXT))).toBe(NEXT);
  });

  test("l'URL di redirect non contiene & né #, così resta intatto nella query del link", () => {
    const url = emailRedirectUrl(ORIGIN, `${NEXT}#ancora`);
    expect(url.startsWith(`${ORIGIN}/?`)).toBe(true);
    expect(url.slice(ORIGIN.length)).not.toMatch(/[&#]/);
  });

  test('valore relativo: passato così com\'è', () => {
    expect(nextFromEmailLink('/prenotazioni')).toBe('/prenotazioni');
  });

  test('Site URL senza destinazione (redirect non ammesso da Supabase) o valore vuoto → null', () => {
    expect(nextFromEmailLink(ORIGIN)).toBeNull();
    expect(nextFromEmailLink(`${ORIGIN}/`)).toBeNull();
    expect(nextFromEmailLink('')).toBeNull();
    expect(nextFromEmailLink(null)).toBeNull();
    expect(nextFromEmailLink('non un url')).toBeNull();
  });

  test('base64 non valido o destinazione esterna: safeNextPath riporta alla home', () => {
    expect(safeNextPath(nextFromEmailLink(`${ORIGIN}/?n=%%%`))).toBe('/');
    expect(safeNextPath(nextFromEmailLink(emailRedirectUrl(ORIGIN, '//evil.example/x')))).toBe('/');
    expect(safeNextPath(nextFromEmailLink(emailRedirectUrl(ORIGIN, 'https://evil.example')))).toBe('/');
  });
});

describe('next troppo lungo (review fetta 5, miglioria 7)', () => {
  const long = `/prenota?x=${'a'.repeat(NEXT_MAX_LENGTH)}`;

  test('safeNextPath scarta una destinazione oltre la lunghezza massima', () => {
    expect(safeNextPath(long)).toBe('/');
    expect(safeNextPath('/prenota')).toBe('/prenota');
  });

  test('emailLoginSchema: il login non fallisce, next viene scartato', () => {
    const parsed = emailLoginSchema.safeParse({ email: 'cliente@example.com', next: long });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.next).toBeUndefined();
  });

  test('emailLinkSchema accetta l\'URL di redirect con la destinazione massima codificata', () => {
    const next = `/${'a'.repeat(NEXT_MAX_LENGTH - 1)}`;
    const parsed = emailLinkSchema.safeParse({
      tokenHash: 'abc',
      type: 'email',
      next: emailRedirectUrl('https://prenota.nomenegozio.it', next),
    });
    expect(parsed.success).toBe(true);
  });
});

describe('/profilo/completa conserva la destinazione (miglioria 8)', () => {
  test('completeProfileUrl', () => {
    expect(completeProfileUrl('/profilo/completa', '/')).toBe('/profilo/completa');
    expect(completeProfileUrl('/profilo/completa', NEXT)).toBe(`/profilo/completa?next=${encodeURIComponent(NEXT)}`);
  });
});

describe('testi d\'errore (migliorie 2, 3, 11)', () => {
  test('i limiti sono segnaposto in it.ts e valori nel testo mostrato', () => {
    expect(texts.booking.errors.notesTooLong).toContain('{max}');
    expect(texts.booking.errors.tooManyFuture).toContain('{max}');
    expect(bookingErrorText('notes_too_long')).toContain(String(ONLINE_BOOKING_LIMITS.maxNotesLength));
    expect(bookingErrorText('too_many_future')).toContain(String(ONLINE_BOOKING_LIMITS.maxFutureBookings));
    expect(bookingErrorText('notes_too_long')).not.toContain('{max}');
  });

  test('unavailable (assenza o orario occupato) → "non disponibile", non "appena occupato"', () => {
    expect(bookingErrorMessage('unavailable')).toBe(texts.booking.errors.slotUnavailable);
    expect(bookingErrorMessage('unavailable')).not.toBe(bookingErrorMessage('taken'));
    expect(bookingErrorText('unavailable')).toBe(bookingErrorMessage('unavailable'));
  });
});

describe('impostazioni: versione dell\'informativa in sola lettura fino alla fetta 9', () => {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const source = (file: string): string => readFileSync(resolve(ROOT, file), 'utf8');

  test('lo schema salvabile non contiene la versione; quello completo resta invariato', () => {
    expect(Object.keys(editableSettingsSchema.shape)).not.toContain('privacyPolicyVersion');
    expect(Object.keys(settingsSchema.shape)).toContain('privacyPolicyVersion');
  });

  test('la server action non scrive privacy_policy_version', () => {
    const code = source('src/lib/admin/settings-actions.ts');
    expect(code).toMatch(/editableSettingsSchema\.safeParse/);
    expect(code).not.toMatch(/privacy_policy_version\s*:/);
  });

  test('il campo del modulo è in sola lettura, senza name, con la nota sulla fetta 9', () => {
    const code = source('src/components/admin/settings-form.tsx');
    const field = code.slice(code.indexOf('id="privacyPolicyVersion"'), code.indexOf('/>', code.indexOf('id="privacyPolicyVersion"')));
    expect(field).toMatch(/\breadOnly\b/);
    expect(field).not.toMatch(/\bname=/);
    expect(code).toMatch(/privacyPolicyVersionNote/);
    expect(texts.admin.settings.privacyPolicyVersionNote.trim()).not.toBe('');
  });
});

describe('destinazione dopo login o completamento del profilo (miglioria 8)', () => {
  const customer = { role: 'customer' as const, isBlocked: false, profileComplete: true };
  const to = (raw: string | null | undefined) => destinationAfterLogin(safeNextPath(raw), customer);

  test('destinazione valida: si torna lì, parametri compresi', () => {
    expect(to(NEXT)).toBe(NEXT);
    expect(to('/profilo')).toBe('/profilo');
  });

  test('senza destinazione valida (assente, esterna, troppo lunga) si arriva alla home', () => {
    for (const raw of [undefined, null, '', '//evil.example/x', 'https://evil.example', `/prenota?x=${'a'.repeat(NEXT_MAX_LENGTH)}`]) {
      expect(to(raw), String(raw).slice(0, 40)).toBe('/');
    }
  });

  test('destinazione non permessa al ruolo: decide decideAccess', () => {
    expect(to('/admin/impostazioni')).toBe('/');
  });
});
