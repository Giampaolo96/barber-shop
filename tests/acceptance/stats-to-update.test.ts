// Regressioni – statistiche, riquadro "Da aggiornare" ed elenco (richiesta dell'utente dopo la
// fetta 9a; SPEC §6.9, ADR 010): stessa regola demo della funzione SQL, percorsi con i filtri della
// pagina, elenco solo admin senza service role.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { it as texts } from '@/i18n/it';
import { isDemoNote } from '@/lib/stats/demo';
import { statsPath, statsToUpdatePath } from '@/lib/stats/paths';
import type { StatsParams } from '@/lib/stats/schemas';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string): string =>
  readFileSync(resolve(ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

describe('isDemoNote: stessa regola di admin_booking_stats (lower(btrim(notes, E\' \\t\\r\\n\')))', () => {
  test.each([
    ['Prenotazione demo', true],
    ['  PRENOTAZIONE demo  ', true],
    ['\tPrenotazione Demo\r\n', true],
    ['Prenotazione demo con extra', false],
    ['Prenotazione  demo', false],
    ['', false],
    [null, false],
  ] as const)('%j → %s', (notes, expected) => {
    expect(isDemoNote(notes)).toBe(expected);
  });
});

describe('percorsi delle statistiche', () => {
  const params: StatsParams = {
    from: '2026-10-01',
    to: '2026-10-31',
    granularity: 'settimana',
    barberId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    excludeDemo: true,
    chart: 'incasso',
  };

  test('l\'elenco "Da aggiornare" tiene periodo, barbiere e demo; non raggruppamento e grafico', () => {
    const url = new URL(statsToUpdatePath(params), 'http://localhost');
    expect(url.pathname).toBe('/admin/statistiche/da-aggiornare');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      dal: '2026-10-01',
      al: '2026-10-31',
      barbiere: params.barberId,
      escludi_demo: '1',
    });
  });

  test('il ritorno alle statistiche tiene tutti i parametri non predefiniti', () => {
    const url = new URL(statsPath(params), 'http://localhost');
    expect(url.pathname).toBe('/admin/statistiche');
    expect(url.searchParams.get('raggruppa')).toBe('settimana');
    expect(url.searchParams.get('grafico')).toBe('incasso');
    const defaults = new URL(
      statsPath({ ...params, granularity: 'giorno', chart: 'prenotazioni', barberId: null, excludeDemo: false }),
      'http://localhost',
    );
    expect([...defaults.searchParams.keys()]).toEqual(['dal', 'al']);
  });
});

describe('pagina /admin/statistiche/da-aggiornare (CLAUDE.md – Sicurezza)', () => {
  const page = 'src/app/admin/(panel)/statistiche/da-aggiornare/page.tsx';

  test('chiama requireRole(["admin"]) e non usa la service role', () => {
    const code = read(page);
    expect(code).toMatch(/\brequireRole\s*\(\s*\[\s*['"]admin['"]\s*,?\s*\]\s*\)/);
    expect(code).not.toMatch(/@\/lib\/db\/admin|createAdminClient|SERVICE_ROLE/);
  });

  test('ogni riga porta al dettaglio della prenotazione nel calendario', () => {
    expect(read(page)).toMatch(/bookingDetailPath\s*\(\s*booking\.id\s*\)/);
  });
});

describe('testi del riquadro "Da aggiornare" (richiesta dell\'utente)', () => {
  test('titolo e sottotitolo', () => {
    expect(texts.admin.stats.totals.toClose).toBe('Da aggiornare');
    expect(texts.admin.stats.totalsHint.toClose).toBe(
      'Appuntamenti già passati non ancora segnati come completati o no-show',
    );
  });
});
