// Regressione della review fetta 6b (miglioria 1): l'azzeramento dei no-show e una no-show segnata
// in contemporanea non devono lasciare il contatore sbagliato (ADR 007: "il perdono copre il
// passato").
//
// Gara riprodotta in modo deterministico con due sessioni psql nel container del database:
//   A: begin; update del profilo come reset_no_show_count (prende il lock della riga); attesa; commit
//   B: mentre A tiene il lock, segna no_show una prenotazione iniziata prima dell'azzeramento.
// Il trigger di B deve decidere se contare sulla versione della riga dopo il commit di A: se la
// condizione sull'azzeramento è valutata prima del lock, B aggiunge +1 che nessuno storna più.
//
// Richiede lo stack Supabase locale avviato (Docker). I dati di prova sono creati e rimossi qui.

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const run = promisify(execFile);

const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync('supabase/config.toml', 'utf8'))?.[1];
const CONTAINER = `supabase_db_${projectId ?? 'barber-shop'}`;

/** Esegue SQL come postgres nel container; restituisce l'output senza intestazioni. */
const psql = async (sql: string): Promise<string> => {
  const { stdout } = await run(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
    { timeout: 30_000 },
  );
  return stdout.trim();
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const CUSTOMER = 'c6b00000-0000-4000-8000-00000000fe01';
const BOOKING = 'c6b00000-0000-4000-8000-00000000fe02';

const cleanup = () =>
  psql(`
    delete from public.bookings where id = '${BOOKING}';
    delete from auth.users where id = '${CUSTOMER}';
  `);

beforeAll(async () => {
  await cleanup();
  // Cliente senza no-show e una sua prenotazione completata nel passato (prima dell'azzeramento).
  await psql(`
    insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('${CUSTOMER}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'gara-azzeramento@qa.test', '{}', '{}', now(), now());
    update public.profiles set full_name = 'Gara Azzeramento' where id = '${CUSTOMER}';
    insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, source, status)
    select '${BOOKING}', '${CUSTOMER}', bs.barber_id, bs.service_id, '2011-01-11 09:00+01', 'manual', 'completed'
      from public.barber_services bs
     limit 1;
  `);
}, 60_000);

afterAll(async () => {
  await cleanup();
}, 60_000);

describe('contatore no-show e azzeramento concorrente (review fetta 6b, miglioria 1)', () => {
  test('una no-show precedente, segnata mentre l\'azzeramento tiene il lock, non conta', async () => {
    expect(await psql(`select no_show_count from public.profiles where id = '${CUSTOMER}'`)).toBe('0');

    // A: azzeramento che tiene il lock sulla riga del profilo per 2 secondi.
    const reset = psql(`
      begin;
      update public.profiles
         set no_show_count = 0, no_show_reset_at = now(), no_show_reset_by = null
       where id = '${CUSTOMER}';
      select pg_sleep(2);
      commit;
    `);
    await sleep(700);
    // B: la prenotazione del 2011 diventa no_show mentre A non ha ancora fatto commit.
    const mark = psql(`update public.bookings set status = 'no_show' where id = '${BOOKING}'`);
    await Promise.all([reset, mark]);

    expect(await psql(`select no_show_reset_at is not null from public.profiles where id = '${CUSTOMER}'`)).toBe('t');
    expect(await psql(`select status from public.bookings where id = '${BOOKING}'`)).toBe('no_show');
    expect(await psql(`select no_show_count from public.profiles where id = '${CUSTOMER}'`)).toBe('0');
  }, 60_000);
});
