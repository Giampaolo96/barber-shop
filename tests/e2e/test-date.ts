// Date degli e2e: ogni test ha una settimana sua, derivata dal suo nome, invece di una data casuale.
// Logica pura più il controllo sulle collisioni, senza Playwright: la prova anche Vitest. Non è un
// file di test. L'uso è `testDate()` di admin-helpers.ts.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const DATE_CLAIMS_DIR = resolve(process.cwd(), 'node_modules/.cache/e2e-date-claims');

/** Dopo il 2049 degli altri e2e e dopo gli anni di polish; il pool serve a rendere rare le collisioni. */
const FUTURE = { fromYear: 2100, toYear: 9999 };
/** Settimane di gennaio e febbraio: sempre ora solare, come chiede `romeWinter`. */
const WINTER_WEEKS = 7;
const WEDNESDAY_OFFSET = 2;

const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};

/**
 * Mercoledì d'inverno derivato da `key`: sempre lo stesso per la stessa chiave. Il mercoledì lascia
 * lo spazio per muoversi nella stessa settimana (`plusDays`) senza toccare quella di un altro test.
 */
export function winterWednesday(key: string, { fromYear, toYear } = FUTURE): string {
  const index = fnv1a(key) % ((toYear - fromYear + 1) * WINTER_WEEKS);
  const year = fromYear + Math.floor(index / WINTER_WEEKS);
  const firstDay = new Date(Date.UTC(year, 0, 1, 12));
  const firstMonday = 1 + ((8 - firstDay.getUTCDay()) % 7);
  const day = new Date(Date.UTC(year, 0, firstMonday + (index % WINTER_WEEKS) * 7 + WEDNESDAY_OFFSET, 12));
  return day.toISOString().slice(0, 10);
}

/**
 * Prenota `date` per `key`, anche fra worker diversi (il file si crea solo se non esiste). Fallisce
 * se la data è già di un altro test: basta cambiare il titolo di uno dei due.
 */
export function claimDate(date: string, key: string, dir = DATE_CLAIMS_DIR): void {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, date);
  try {
    writeFileSync(file, key, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const owner = readFileSync(file, 'utf8');
    if (owner !== key) throw new Error(`data ${date} di due test: "${owner}" e "${key}". Cambia un titolo.`);
  }
}

/** Azzera le prenotazioni delle date all'inizio di ogni giro (global-setup.ts). */
export const resetDateClaims = (dir = DATE_CLAIMS_DIR): void => rmSync(dir, { recursive: true, force: true });
