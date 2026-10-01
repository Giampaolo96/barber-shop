// Test di accettazione – FETTA 1 (SPEC §11: "Schema DB + RLS + seed dati demo").
// Fatta quando: "Migrazioni applicate, test RLS verdi".
// Controlli statici sul repository (nessun database): le regole di dominio e le policy sono
// verificate dai test pgTAP in supabase/tests/*.test.sql (`npm run test:db`).
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// Root del repo calcolata dalla posizione di questo file (tests/acceptance/), non dalla cwd.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const fromRoot = (...segments: string[]): string => resolve(ROOT, ...segments);

const readText = (...segments: string[]): string => {
  const path = fromRoot(...segments);
  expect(existsSync(path), `file mancante: ${segments.join('/')}`).toBe(true);
  return readFileSync(path, 'utf8');
};

const listDir = (...segments: string[]): string[] => {
  const path = fromRoot(...segments);
  return existsSync(path) && statSync(path).isDirectory() ? readdirSync(path) : [];
};

/** Tutti i file sotto una cartella (ricorsivo), come percorsi relativi alla root con `/`. */
const walk = (dir: string): string[] => {
  const absolute = fromRoot(dir);
  if (!existsSync(absolute)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = join(absolute, entry.name);
    const rel = relative(ROOT, child).replace(/\\/g, '/');
    if (entry.isDirectory()) found.push(...walk(rel));
    else found.push(rel);
  }
  return found;
};

/** SQL senza commenti (`-- ...` e blocchi) e senza spazi ai bordi. */
const stripSqlComments = (sql: string): string =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .trim();

type PackageJson = { scripts?: Record<string, string> };
const readPackageJson = (): PackageJson => JSON.parse(readText('package.json')) as PackageJson;

const migrationFiles = (): string[] =>
  listDir('supabase', 'migrations').filter((name) => name.endsWith('.sql')).sort();

const TABLES = [
  'profiles',
  'shop_settings',
  'services',
  'barbers',
  'barber_services',
  'working_hours',
  'time_off',
  'shop_closures',
  'bookings',
] as const;

const ENUMS = ['user_role', 'booking_status', 'booking_source'] as const;

describe('Migrazioni – SPEC §11 fetta 1: "migrazioni applicate"', () => {
  // CLAUDE.md – Struttura: "supabase/migrations/ – SOLO migrazioni SQL"
  test('supabase/migrations contiene almeno una migrazione .sql', () => {
    expect(migrationFiles().length).toBeGreaterThan(0);
  });

  // CLAUDE.md – Modo di lavorare: "una migrazione per modifica di schema, con nome descrittivo"
  test('ogni migrazione ha il formato <timestamp a 14 cifre>_<nome_descrittivo>.sql', () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(0);
    const invalid = files.filter((name) => !/^\d{14}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/.test(name));
    expect(invalid).toEqual([]);
  });

  test('nessuna migrazione è vuota', () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(0);
    const empty = files.filter(
      (name) => stripSqlComments(readText('supabase', 'migrations', name)) === '',
    );
    expect(empty).toEqual([]);
  });

  // CLAUDE.md – Struttura: lo schema si modifica solo con le migrazioni, non dal seed
  test('supabase/seed.sql non contiene DDL (create/alter/drop)', () => {
    const seed = stripSqlComments(readText('supabase', 'seed.sql'));
    expect(seed).not.toMatch(/^\s*(?:create|alter|drop)\s+(?:table|type|policy|function|extension)\b/im);
  });
});

describe('Seed dati demo – SPEC §11 fetta 1', () => {
  // SPEC §11 fetta 1: "seed dati demo"
  test('supabase/seed.sql non è vuoto e inserisce dati', () => {
    const seed = stripSqlComments(readText('supabase', 'seed.sql'));
    expect(seed).not.toBe('');
    expect(seed).toMatch(/\binsert\s+into\b/i);
  });

  // SPEC §2: un utente demo per ruolo
  test.each(['admin@demo.local', 'barber@demo.local', 'cliente@demo.local'])(
    'supabase/seed.sql crea l\'utente demo %s',
    (email) => {
      expect(readText('supabase', 'seed.sql')).toContain(email);
    },
  );
});

describe('Tipi generati – CLAUDE.md – Modo di lavorare: "dopo ogni migrazione rigenera i tipi"', () => {
  test('src/lib/db/types.ts esiste', () => {
    expect(existsSync(fromRoot('src', 'lib', 'db', 'types.ts'))).toBe(true);
  });

  // SPEC §3: una tabella per entità
  test.each(TABLES)('src/lib/db/types.ts contiene la tabella %s', (table) => {
    const types = readText('src', 'lib', 'db', 'types.ts');
    expect(types).toMatch(new RegExp(`\\b${table}: \\{`));
  });

  // SPEC §2 / §3.6: enum Postgres per ruoli, stati e source
  test.each(ENUMS)('src/lib/db/types.ts contiene l\'enum %s', (name) => {
    const types = readText('src', 'lib', 'db', 'types.ts');
    expect(types).toMatch(new RegExp(`\\b${name}:`));
  });

  // SPEC §3.6: tutti gli stati della prenotazione
  test.each(['confirmed', 'completed', 'cancelled_by_customer', 'cancelled_by_shop', 'no_show'])(
    'src/lib/db/types.ts contiene lo stato "%s"',
    (status) => {
      expect(readText('src', 'lib', 'db', 'types.ts')).toContain(`"${status}"`);
    },
  );

  // SPEC §6.2: ricerca cliente esistente
  test('src/lib/db/types.ts contiene la funzione search_customers', () => {
    expect(readText('src', 'lib', 'db', 'types.ts')).toMatch(/\bsearch_customers: \{/);
  });

  // SPEC §3.6: colonne di audit del cambio di stato
  test('src/lib/db/types.ts è aggiornato alle colonne status_changed_at / status_changed_by', () => {
    const types = readText('src', 'lib', 'db', 'types.ts');
    expect(types).toContain('status_changed_at');
    expect(types).toContain('status_changed_by');
  });
});

describe('Script npm – SPEC §11 fetta 1: "test RLS verdi"', () => {
  test('"test:db" esegue `supabase test db`', () => {
    expect(readPackageJson().scripts?.['test:db']?.trim()).toBe('supabase test db');
  });

  // CLAUDE.md – Comandi: npx supabase gen types typescript --local > src/lib/db/types.ts
  test('"db:types" rigenera src/lib/db/types.ts dal database locale', () => {
    const script = readPackageJson().scripts?.['db:types'] ?? '';
    expect(script).toMatch(/\bsupabase gen types\b/);
    expect(script).toContain('--local');
    expect(script).toContain('src/lib/db/types.ts');
  });

  test('i test pgTAP sono in supabase/tests/*.test.sql', () => {
    const tests = listDir('supabase', 'tests').filter((name) => name.endsWith('.test.sql'));
    expect(tests.length).toBeGreaterThan(0);
  });
});

describe('CI – SPEC §11 fetta 1: i test RLS girano in CI', () => {
  const workflow = (): string => readText('.github', 'workflows', 'ci.yml');
  const indexOf = (pattern: RegExp): number => workflow().search(pattern);

  // docs/PROGRESS.md: "dalla fetta 1 la CI deve avviare Supabase prima dei test"
  test('il workflow avvia Supabase con `supabase start`', () => {
    expect(workflow()).toMatch(/\bsupabase start\b/);
  });

  test('il workflow esegue `npm run test:db`', () => {
    expect(workflow()).toMatch(/\bnpm run test:db\b/);
  });

  test('`supabase start` precede `npm run test:db`', () => {
    const start = indexOf(/\bsupabase start\b/);
    const testDb = indexOf(/\bnpm run test:db\b/);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(testDb).toBeGreaterThan(start);
  });

  test('`npm run test:db` precede `npm test`', () => {
    const testDb = indexOf(/\bnpm run test:db\b/);
    const unit = indexOf(/\bnpm (?:run )?test(?![:\w-])/);
    expect(testDb).toBeGreaterThanOrEqual(0);
    expect(unit).toBeGreaterThan(testDb);
  });
});

describe('Chiave privilegiata – SPEC §8: "nessuna chiave privilegiata nel codice client"', () => {
  const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
  const SERVICE_ROLE = /service_role|SUPABASE_SERVICE_ROLE_KEY/i;
  const USE_CLIENT = /^\s*(['"])use client\1/m;

  const sourceFiles = (): string[] =>
    walk('src').filter((path) => SOURCE_EXTENSIONS.test(path) && path !== 'src/lib/db/types.ts');

  test('src/ contiene file sorgente da controllare', () => {
    expect(sourceFiles().length).toBeGreaterThan(0);
  });

  // CLAUDE.md – Sicurezza: "la service_role key si usa solo lato server"
  test('nessun file con "use client" cita service_role / SUPABASE_SERVICE_ROLE_KEY', () => {
    const offenders = sourceFiles().filter((path) => {
      const content = readFileSync(fromRoot(path), 'utf8');
      return USE_CLIENT.test(content) && SERVICE_ROLE.test(content);
    });
    expect(offenders).toEqual([]);
  });

  // CLAUDE.md – Sicurezza: "mai in codice client o variabili NEXT_PUBLIC_*"
  test('nessuna variabile NEXT_PUBLIC_* contiene SERVICE_ROLE (sorgenti e file di configurazione)', () => {
    const candidates = [
      ...sourceFiles(),
      ...listDir().filter((name) => /^\.env(?:\..+)?$/.test(name) || /^next\.config\./.test(name)),
      '.github/workflows/ci.yml',
    ];
    const offenders = candidates.filter((path) => {
      const absolute = fromRoot(path);
      if (!existsSync(absolute) || !statSync(absolute).isFile()) return false;
      return /NEXT_PUBLIC_\w*SERVICE_ROLE/i.test(readFileSync(absolute, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });
});

describe('Decisioni architetturali – CLAUDE.md – Modo di lavorare', () => {
  // CLAUDE.md: "le decisioni architetturali rilevanti vanno in docs/adr/NNN-titolo.md"
  test('esiste docs/adr/001-<titolo>.md', () => {
    const adr = listDir('docs', 'adr').filter((name) => /^001-[a-z0-9-]+\.md$/.test(name));
    expect(adr).toHaveLength(1);
  });

  test('l\'ADR 001 ha le sezioni contesto, decisione, conseguenze', () => {
    const [adr] = listDir('docs', 'adr').filter((name) => /^001-[a-z0-9-]+\.md$/.test(name));
    expect(adr, 'manca docs/adr/001-*.md').toBeDefined();
    const content = readText('docs', 'adr', adr as string);
    expect(content).toMatch(/contesto/i);
    expect(content).toMatch(/decisione/i);
    expect(content).toMatch(/conseguenze/i);
  });
});
