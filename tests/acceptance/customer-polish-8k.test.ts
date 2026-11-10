// Test di accettazione – FETTA 8k (rifiniture di stile dell'area clienti): logica pura e testi.
// Fonte: docs/audit/2026-10-31-taste.md, sezione "Area clienti" (escluso Profilo), e decisioni
// approvate dall'utente per la fetta ("8k.N" è il numero della decisione). Sezioni: SPEC §5.1 (home,
// "Dove siamo"), §5.2 (riepilogo), §9 (testi in italiano centralizzati in src/i18n/it.ts).
// I comportamenti nel browser sono in tests/e2e/customer-polish-8k.spec.ts.
//
// Interfacce attese:
//   src/lib/booking/format.ts
//     mapsHref(address: string | null): string | null
//       `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
//       null per null, stringa vuota o solo spazi (l'indirizzo resta testo).
//   src/i18n/it.ts
//     auth.customerLogin.emailPlaceholder = "nome@email.it"
//     auth.customerLogin.firstAccess      = "Al primo accesso ti chiediamo nome, telefono e il consenso all'informativa privacy."
//     booking.summary.duration            = "Durata"
// I moduli si caricano con import dinamico: una funzione mancante fa fallire i soli test che la usano.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { describe, expect, test } from 'vitest';

const load = async <T>(specifier: string): Promise<T> => (await import(/* @vite-ignore */ specifier)) as T;

const MAPS = 'https://www.google.com/maps/search/?api=1&query=';

// ---------------------------------------------------------------------------
// Indirizzo come link alle mappe – 8k.3 (SPEC §5.1, "Dove siamo")
// ---------------------------------------------------------------------------
type FormatModule = { mapsHref: (address: string | null) => string | null };

const mapsHref = async (address: string | null): Promise<string | null> => {
  const { mapsHref: fn } = await load<FormatModule>('@/lib/booking/format');
  expect(fn, 'mapsHref esportata da src/lib/booking/format.ts').toBeTypeOf('function');
  return fn(address);
};

describe('mapsHref – 8k.3, SPEC §5.1 ("Dove siamo")', () => {
  // 8k.3: senza indirizzo niente link, resta testo (o niente)
  test.each([
    ['null', null],
    ['stringa vuota', ''],
    ['solo spazi', '   '],
    ['spazi, tab e a capo', ' \t\n '],
  ])('%s → null', async (_label, address) => {
    expect(await mapsHref(address)).toBeNull();
  });

  // 8k.3: query codificata con encodeURIComponent (barra, virgola, & e spazi non rompono l'URL)
  test('indirizzo con caratteri speciali: query codificata con encodeURIComponent', async () => {
    const address = 'Via Roma 1/A, 00100 Roma & c.';
    const href = await mapsHref(address);
    expect(href).toBe(`${MAPS}${encodeURIComponent(address)}`);
    expect(href).toBe(`${MAPS}Via%20Roma%201%2FA%2C%2000100%20Roma%20%26%20c.`);
    // L'& dell'indirizzo non diventa un secondo parametro
    expect(new URL(href ?? '').searchParams.get('query')).toBe(address);
    expect([...new URL(href ?? '').searchParams.keys()]).toEqual(['api', 'query']);
  });

  // 8k.3: spazi iniziali e finali tolti prima di codificare
  test("trim dell'indirizzo", async () => {
    expect(await mapsHref('   Via Roma 1, 00100 Roma  ')).toBe(`${MAPS}${encodeURIComponent('Via Roma 1, 00100 Roma')}`);
  });

  test('indirizzo con accenti e apostrofo', async () => {
    const address = "Piazza dell'Unità d'Italia 3";
    expect(await mapsHref(address)).toBe(`${MAPS}${encodeURIComponent(address)}`);
  });
});

// ---------------------------------------------------------------------------
// Testi nuovi – 8k.4 (Accedi) e 8k.6 (Riepilogo); SPEC §9
// ---------------------------------------------------------------------------
describe('Testi della fetta 8k in src/i18n/it.ts – SPEC §9', () => {
  const string = async (path: string): Promise<unknown> => {
    const { it: strings } = await load<{ it: unknown }>('@/i18n/it');
    let node: unknown = strings;
    for (const key of path.split('.')) {
      if (typeof node !== 'object' || node === null) return undefined;
      node = (node as Record<string, unknown>)[key];
    }
    return node;
  };

  test.each([
    // 8k.4: esempio nel campo email di /accedi
    ['auth.customerLogin.emailPlaceholder', 'nome@email.it'],
    // 8k.4: riga sul primo accesso sotto il pulsante di /accedi
    [
      'auth.customerLogin.firstAccess',
      "Al primo accesso ti chiediamo nome, telefono e il consenso all'informativa privacy.",
    ],
    // 8k.6: Prezzo e Durata separati nel riepilogo
    ['booking.summary.duration', 'Durata'],
  ])('it.%s = %j', async (path, expected) => {
    expect(await string(path), `chiave i18n: it.${path}`).toBe(expected);
  });

  // 8k.6: le due etichette del riepilogo sono distinte
  test('it.booking.summary.duration è diverso da it.booking.summary.price', async () => {
    const duration = await string('booking.summary.duration');
    expect(duration, 'chiave i18n: it.booking.summary.duration').toBeTypeOf('string');
    expect(duration).not.toBe(await string('booking.summary.price'));
  });
});
