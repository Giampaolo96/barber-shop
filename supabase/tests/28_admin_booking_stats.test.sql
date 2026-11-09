-- Fetta 8h: modifica approvata dall'utente il 2026-11-08 (amr password nei claim staff / nome della RPC), nessuna asserzione cambiata.
-- Test di accettazione – FETTA 9a (SPEC §11: "Statistiche – l'admin vede prenotazioni, incasso
-- stimato e no-show del periodo, per barbiere e per servizio").
-- 28 – Funzione del database che aggrega le prenotazioni per le statistiche.
-- SPEC §2 (statistiche: solo admin), §3.6 (prezzo copiato sulla prenotazione, stati, nota del
-- cliente separata dalla nota staff), §6.9 (giorno locale dell'appuntamento, massimo 366 giorni,
-- prenotazioni demo), §9 e CLAUDE.md regola 2 (timezone del negozio), §12 (cambio d'ora) +
-- decisioni approvate per la fetta 9a:
--   public.admin_booking_stats(p_from date, p_to date, p_exclude_demo boolean default false)
--     returns jsonb – security definer, set search_path = '', stable.
--   - non public.is_admin() → errcode 42501;
--   - p_from > p_to, p_from o p_to null, p_to - p_from + 1 > 366 → errcode 22023;
--   - revoke all da public, anon, authenticated; grant execute solo ad authenticated.
--   Restituisce un array jsonb di gruppi, uno per combinazione di
--     { "day": "YYYY-MM-DD"  giorno locale di starts_at nella timezone di shop_settings,
--       "barber_id": uuid, "service_id": uuid, "status": booking_status,
--       "started": boolean   starts_at <= now(),
--       "bookings": int      numero di prenotazioni del gruppo,
--       "revenue_cents": int somma di bookings.price_cents del gruppo }
--   con tutti gli stati (anche le cancellate), filtrato sul giorno locale fra p_from e p_to inclusi;
--   [] se non ci sono prenotazioni. Con p_exclude_demo = true esclude le prenotazioni con
--   lower(btrim(bookings.notes, E' \t\r\n')) = 'prenotazione demo' (la nota staff non conta).
--
-- Le chiamate passano da EXECUTE dentro helper che intercettano gli errori: se la funzione manca
-- il test fallisce mostrando il codice, senza interrompere il file. Esiti: testo canonico dei
-- gruppi oppure 'ERR <sqlstate>'.
-- I risultati si leggono solo per i barbieri creati qui (A, B): altri dati nel database (seed,
-- e2e) non cambiano gli attesi. Tutti i dati sono annullati dal rollback.
-- Non modificare durante l'implementazione.
begin;
create extension if not exists pgtap with schema extensions;

select plan(42);

-- ---------------------------------------------------------------------------
-- Helper
-- ---------------------------------------------------------------------------
create function pg_temp.act_as(uid uuid) returns void language plpgsql as $f$
begin
  -- Fetta 8h: lo staff accede con password, quindi il suo token ha amr password (ruolo letto come postgres)
  reset role;
  perform set_config('request.jwt.claims',
    (json_build_object('sub', uid, 'role', 'authenticated')::jsonb
       || case when exists (select 1 from public.profiles p where p.id = uid and p.role in ('barber', 'admin'))
               then jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method', 'password')))
               else '{}'::jsonb end)::text, true);
  set local role authenticated;
end $f$;

create function pg_temp.act_as_anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;

create function pg_temp.act_as_postgres() returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $f$;

create function pg_temp.mk_user(uid uuid, r text, nm text, mail text) returns void language plpgsql as $f$
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          mail, '{}'::jsonb, '{}'::jsonb, now(), now());
  update public.profiles set role = r::public.user_role, full_name = nm where id = uid;
end $f$;

-- Testo canonico dei gruppi dei barbieri di prova, in ordine:
-- "giorno|barbiere|servizio|stato|started|bookings|revenue_cents; ..."
create function pg_temp.canon(res jsonb) returns text language sql as $f$
  select coalesce(string_agg(
           concat_ws('|', e->>'day', l.b, l.s, e->>'status', e->>'started', e->>'bookings', e->>'revenue_cents'),
           '; ' order by e->>'day', l.b, l.s, e->>'status', e->>'started'), '')
    from jsonb_array_elements(res) e
   cross join lateral (
     select case e->>'barber_id'
              when 'f9a00000-0000-4000-8000-0000000000a1' then 'A'
              when 'f9a00000-0000-4000-8000-0000000000b2' then 'B' end as b,
            case e->>'service_id'
              when 'f9a00000-0000-4000-8000-000000000051' then 'S1'
              when 'f9a00000-0000-4000-8000-000000000052' then 'S2'
              else coalesce(e->>'service_id', '?') end as s
   ) l
   where l.b is not null
$f$;

-- Chiama la funzione con gli argomenti dati (SQL letterale) e rende il testo canonico.
create function pg_temp.stats(args text) returns text language plpgsql as $f$
declare r jsonb;
begin
  execute 'select public.admin_booking_stats(' || args || ')' into r;
  return pg_temp.canon(r);
exception when others then
  return 'ERR ' || sqlstate;
end $f$;

-- Risultato grezzo (jsonb come testo) oppure 'ERR <sqlstate>'.
create function pg_temp.raw(args text) returns text language plpgsql as $f$
declare r jsonb;
begin
  execute 'select public.admin_booking_stats(' || args || ')' into r;
  return r::text;
exception when others then
  return 'ERR ' || sqlstate;
end $f$;

-- Risultato come jsonb, null in caso d'errore (per leggere chiavi e tipi senza interrompere il file).
create function pg_temp.res(args text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  execute 'select public.admin_booking_stats(' || args || ')' into r;
  return r;
exception when others then
  return null;
end $f$;

create function pg_temp.fn() returns oid language sql as $f$
  select to_regprocedure('public.admin_booking_stats(date,date,boolean)')::oid
$f$;

-- ---------------------------------------------------------------------------
-- Dati (come postgres)
-- ---------------------------------------------------------------------------
update public.shop_settings set timezone = 'Europe/Rome', buffer_min = 0;

select pg_temp.mk_user('f9a00000-0000-4000-8000-000000000001', 'admin', 'F9A Admin', 'f9a-admin@qa.test');
select pg_temp.mk_user('f9a00000-0000-4000-8000-000000000002', 'admin', 'F9A Admin Bloccato', 'f9a-admin-off@qa.test');
select pg_temp.mk_user('f9a00000-0000-4000-8000-000000000003', 'barber', 'F9A Barbiere', 'f9a-barber@qa.test');
select pg_temp.mk_user('f9a00000-0000-4000-8000-000000000004', 'customer', 'F9A Cliente', 'f9a-customer@qa.test');
update public.profiles set is_blocked = true where id = 'f9a00000-0000-4000-8000-000000000002';

insert into public.services (id, name, duration_min, price_cents, is_active) values
  ('f9a00000-0000-4000-8000-000000000051', 'F9A Taglio', 30, 2000, true),
  ('f9a00000-0000-4000-8000-000000000052', 'F9A Barba', 20, 1500, true);
insert into public.barbers (id, display_name, is_active, profile_id) values
  ('f9a00000-0000-4000-8000-0000000000a1', 'F9A Barbiere A', true, null),
  ('f9a00000-0000-4000-8000-0000000000b2', 'F9A Barbiere B', true, 'f9a00000-0000-4000-8000-000000000003');
insert into public.barber_services (barber_id, service_id) values
  ('f9a00000-0000-4000-8000-0000000000a1', 'f9a00000-0000-4000-8000-000000000051'),
  ('f9a00000-0000-4000-8000-0000000000a1', 'f9a00000-0000-4000-8000-000000000052'),
  ('f9a00000-0000-4000-8000-0000000000b2', 'f9a00000-0000-4000-8000-000000000051'),
  ('f9a00000-0000-4000-8000-0000000000b2', 'f9a00000-0000-4000-8000-000000000052');

-- Settimana 13–19 gennaio 2025 (ora solare, Roma = UTC+1). A = ...a1, B = ...b2, S1 = Taglio 20 €,
-- S2 = Barba 15 €. Prezzi copiati dal trigger alla creazione.
insert into public.bookings (id, guest_name, guest_phone, barber_id, service_id, starts_at, status, source, notes) values
  -- lunedì 13: tre completate (una con sconto, una alle 00:30 locali), una no-show, una confermata
  -- ancora da chiudere, una cancellata dal cliente
  ('f9ab0000-0000-4000-8000-000000000001', 'F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000a1',
   'f9a00000-0000-4000-8000-000000000051', '2025-01-13 10:00+01', 'completed', 'manual', null),
  ('f9ab0000-0000-4000-8000-000000000002', 'F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000a1',
   'f9a00000-0000-4000-8000-000000000051', '2025-01-13 11:00+01', 'completed', 'manual', null),
  ('f9ab0000-0000-4000-8000-000000000003', 'F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000a1',
   'f9a00000-0000-4000-8000-000000000051', '2025-01-13 12:00+01', 'no_show', 'manual', null),
  ('f9ab0000-0000-4000-8000-000000000004', 'F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000a1',
   'f9a00000-0000-4000-8000-000000000051', '2025-01-13 13:00+01', 'confirmed', 'manual', null),
  ('f9ab0000-0000-4000-8000-000000000005', 'F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000a1',
   'f9a00000-0000-4000-8000-000000000052', '2025-01-13 14:00+01', 'cancelled_by_customer', 'manual', null),
  -- 23:30 UTC del 12 = 00:30 del 13 a Roma: conta lunedì 13
  ('f9ab0000-0000-4000-8000-000000000006', 'F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000a1',
   'f9a00000-0000-4000-8000-000000000051', '2025-01-12 23:30:00+00', 'completed', 'manual', null),
  -- martedì 14 (barbiere B): una cancellata dal negozio e quattro completate con note diverse
  ('f9ab0000-0000-4000-8000-000000000007', 'F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000b2',
   'f9a00000-0000-4000-8000-000000000051', '2025-01-14 10:00+01', 'cancelled_by_shop', 'manual', null),
  ('f9ab0000-0000-4000-8000-000000000008', 'F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000b2',
   'f9a00000-0000-4000-8000-000000000052', '2025-01-14 11:00+01', 'completed', 'manual', '  PRENOTAZIONE demo  '),
  ('f9ab0000-0000-4000-8000-000000000009', 'F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000b2',
   'f9a00000-0000-4000-8000-000000000052', '2025-01-14 12:00+01', 'completed', 'manual', 'Prenotazione demo con extra'),
  ('f9ab0000-0000-4000-8000-000000000010', 'F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000b2',
   'f9a00000-0000-4000-8000-000000000052', '2025-01-14 13:00+01', 'completed', 'manual', null),
  ('f9ab0000-0000-4000-8000-000000000011', 'F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000b2',
   'f9a00000-0000-4000-8000-000000000052', '2025-01-14 14:00+01', 'completed', 'manual', 'Prenotazione demo'),
  -- tab e a capo ai bordi: demo anche questa (btrim con E' \t\r\n', decisione dell'utente)
  ('f9ab0000-0000-4000-8000-000000000014', 'F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000b2',
   'f9a00000-0000-4000-8000-000000000052', '2025-01-14 15:00+01', 'completed', 'manual', E'\tPrenotazione Demo\r\n'),
  -- 22:30 UTC del 15 = 23:30 del 15 a Roma: conta mercoledì 15
  ('f9ab0000-0000-4000-8000-000000000012', 'F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000a1',
   'f9a00000-0000-4000-8000-000000000051', '2025-01-15 22:30:00+00', 'completed', 'manual', null),
  -- 23:30 UTC del 19 = 00:30 di lunedì 20 a Roma: fuori dalla settimana anche se in UTC è il 19
  ('f9ab0000-0000-4000-8000-000000000013', 'F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000a1',
   'f9a00000-0000-4000-8000-000000000051', '2025-01-19 23:30:00+00', 'completed', 'manual', null);

-- Nota staff "Prenotazione demo" sulla 10 (la nota del cliente è vuota): non la rende demo
insert into public.booking_staff_notes (booking_id, note) values
  ('f9ab0000-0000-4000-8000-000000000010', 'Prenotazione demo');

-- Sconto dell'admin sulla 2 (SPEC §3.6) e poi aumento del listino: conta il prezzo della prenotazione
update public.bookings set price_cents = 1200 where id = 'f9ab0000-0000-4000-8000-000000000002';
update public.services set price_cents = 9999 where id = 'f9a00000-0000-4000-8000-000000000051';

-- Cambio d'ora d'autunno: domenica 26/10/2025 (25 ore; alle 01:00 UTC Roma passa da +2 a +1)
insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, status, source) values
  ('F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000a1', 'f9a00000-0000-4000-8000-000000000052',
   '2025-10-25 21:30:00+00', 'completed', 'manual'),  -- 23:30 del 25 (+2)
  ('F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000a1', 'f9a00000-0000-4000-8000-000000000052',
   '2025-10-25 22:30:00+00', 'completed', 'manual'),  -- 00:30 del 26 (+2)
  ('F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000a1', 'f9a00000-0000-4000-8000-000000000052',
   '2025-10-26 22:30:00+00', 'completed', 'manual'),  -- 23:30 del 26 (+1)
  ('F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000a1', 'f9a00000-0000-4000-8000-000000000052',
   '2025-10-26 23:30:00+00', 'completed', 'manual');  -- 00:30 del 27 (+1)

-- Cambio d'ora di primavera: domenica 30/03/2025 (23 ore; alle 01:00 UTC Roma passa da +1 a +2)
insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, status, source) values
  ('F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000b2', 'f9a00000-0000-4000-8000-000000000052',
   '2025-03-29 22:30:00+00', 'completed', 'manual'),  -- 23:30 del 29 (+1)
  ('F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000b2', 'f9a00000-0000-4000-8000-000000000052',
   '2025-03-29 23:30:00+00', 'completed', 'manual'),  -- 00:30 del 30 (+1)
  ('F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000b2', 'f9a00000-0000-4000-8000-000000000052',
   '2025-03-30 21:30:00+00', 'completed', 'manual'),  -- 23:30 del 30 (+2)
  ('F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000b2', 'f9a00000-0000-4000-8000-000000000052',
   '2025-03-30 22:30:00+00', 'completed', 'manual');  -- 00:30 del 31 (+2)

-- Prenotazioni future (started = false) e una che inizia esattamente adesso (started = true)
insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, status, source) values
  ('F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000a1', 'f9a00000-0000-4000-8000-000000000052',
   '2040-01-10 10:00+01', 'confirmed', 'manual'),
  ('F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000a1', 'f9a00000-0000-4000-8000-000000000052',
   '2040-01-10 11:00+01', 'cancelled_by_customer', 'manual'),
  ('F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000a1', 'f9a00000-0000-4000-8000-000000000052',
   now(), 'confirmed', 'manual'),
  ('F9A Ospite', '+393330000901', 'f9a00000-0000-4000-8000-0000000000b2', 'f9a00000-0000-4000-8000-000000000052',
   now() + interval '1 second', 'confirmed', 'manual');

-- ===========================================================================
-- 1. Struttura e privilegi (decisione 2, CLAUDE.md – Sicurezza)
-- ===========================================================================
select ok(pg_temp.fn() is not null,
  'esiste public.admin_booking_stats(date, date, boolean)');
select is((select format_type(p.prorettype, null) from pg_proc p where p.oid = pg_temp.fn()), 'jsonb',
  'admin_booking_stats restituisce jsonb');
select is((select p.pronargdefaults::int from pg_proc p where p.oid = pg_temp.fn()), 1,
  'p_exclude_demo ha un valore predefinito (unico argomento facoltativo)');
select ok(coalesce((select p.prosecdef from pg_proc p where p.oid = pg_temp.fn()), false),
  'admin_booking_stats è security definer');
select ok(coalesce((select 'search_path=""' = any(p.proconfig) from pg_proc p where p.oid = pg_temp.fn()), false),
  'admin_booking_stats ha search_path vuoto (set search_path = '''')');
select is((select p.provolatile::text from pg_proc p where p.oid = pg_temp.fn()), 's',
  'admin_booking_stats è stable');
select ok(pg_temp.fn() is not null and has_function_privilege('authenticated', pg_temp.fn(), 'execute'),
  'grant: authenticated può eseguire admin_booking_stats');
select ok(pg_temp.fn() is not null and not has_function_privilege('anon', pg_temp.fn(), 'execute'),
  'grant: anon non può eseguire admin_booking_stats');
select ok(pg_temp.fn() is not null
          and not coalesce((select bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE')
                              from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                             where p.oid = pg_temp.fn()), false),
  'grant: nessun execute a PUBLIC (revoke esplicito nella migrazione)');
select ok(pg_temp.fn() is not null and not has_function_privilege('service_role', pg_temp.fn(), 'execute'),
  'grant: service_role non può eseguire admin_booking_stats (come le funzioni dei clienti, fetta 6b)');

-- ===========================================================================
-- 2. Solo admin (SPEC §2, §6.9): 42501 per gli altri ruoli
-- ===========================================================================
select pg_temp.act_as('f9a00000-0000-4000-8000-000000000004');
select is(pg_temp.stats($$'2025-01-13', '2025-01-19'$$), 'ERR 42501',
  'SPEC §6.9: il cliente non legge le statistiche (42501)');
select pg_temp.act_as_postgres();

select pg_temp.act_as('f9a00000-0000-4000-8000-000000000003');
select is(pg_temp.stats($$'2025-01-13', '2025-01-19'$$), 'ERR 42501',
  'SPEC §6.9: il barbiere non legge le statistiche, nemmeno le proprie (42501)');
select pg_temp.act_as_postgres();

select pg_temp.act_as('f9a00000-0000-4000-8000-000000000002');
select is(pg_temp.stats($$'2025-01-13', '2025-01-19'$$), 'ERR 42501',
  'un admin bloccato non legge le statistiche (is_admin() falso, 42501)');
select pg_temp.act_as_postgres();

select pg_temp.act_as_anon();
select is(pg_temp.stats($$'2025-01-13', '2025-01-19'$$), 'ERR 42501',
  'anonimo: nessun accesso alle statistiche (42501)');
select pg_temp.act_as_postgres();

-- Prima il ruolo, poi il periodo (decisione dell'utente): un non admin riceve 42501 anche con un
-- periodo non valido
select pg_temp.act_as('f9a00000-0000-4000-8000-000000000004');
select is(pg_temp.stats($$'2025-01-20', '2025-01-19'$$), 'ERR 42501',
  'ordine dei controlli: cliente con periodo invertito → 42501, non 22023');
select pg_temp.act_as_postgres();
select pg_temp.act_as('f9a00000-0000-4000-8000-000000000003');
select is(pg_temp.stats($$'2025-01-01', '2026-01-02'$$), 'ERR 42501',
  'ordine dei controlli: barbiere con periodo di 367 giorni → 42501, non 22023');
select pg_temp.act_as_postgres();

-- Da qui in poi come admin
select pg_temp.act_as('f9a00000-0000-4000-8000-000000000001');

-- ===========================================================================
-- 3. Validazione del periodo (SPEC §6.9: al massimo 366 giorni) → 22023
-- ===========================================================================
select is(pg_temp.stats($$'2025-01-20', '2025-01-19'$$), 'ERR 22023',
  'periodo invertito (dal > al) → 22023');
select is(pg_temp.stats($$null, '2025-01-19'$$), 'ERR 22023',
  'inizio del periodo null → 22023');
select is(pg_temp.stats($$'2025-01-13', null$$), 'ERR 22023',
  'fine del periodo null → 22023');
select is(pg_temp.stats($$'2025-01-01', '2026-01-02'$$), 'ERR 22023',
  'periodo di 367 giorni → 22023');
select is(left(pg_temp.raw($$'2024-01-01', '2024-12-31'$$), 1), '[',
  'periodo di 366 giorni (anno bisestile 2024) ammesso: restituisce un array');
select is(left(pg_temp.raw($$'2025-01-13', '2025-01-13'$$), 1), '[',
  'periodo di un solo giorno (dal = al) ammesso');

-- ===========================================================================
-- 4. Forma del risultato (decisione 2)
-- ===========================================================================
select is(pg_temp.raw($$'1990-01-01', '1990-01-31'$$), '[]',
  'nessuna prenotazione nel periodo → array vuoto []');
select is(
  (select string_agg(distinct k, ',' order by k)
     from jsonb_array_elements(pg_temp.res($$'2025-01-13', '2025-01-19'$$)) e,
          jsonb_object_keys(e) k),
  'barber_id,bookings,day,revenue_cents,service_id,started,status',
  'ogni gruppo ha solo le chiavi day, barber_id, service_id, status, started, bookings, revenue_cents');
select is(
  (select string_agg(distinct concat_ws(',', jsonb_typeof(e->'day'), jsonb_typeof(e->'barber_id'),
                                        jsonb_typeof(e->'service_id'), jsonb_typeof(e->'status'),
                                        jsonb_typeof(e->'started'), jsonb_typeof(e->'bookings'),
                                        jsonb_typeof(e->'revenue_cents')), ' / ')
     from jsonb_array_elements(pg_temp.res($$'2025-01-13', '2025-01-19'$$)) e),
  'string,string,string,string,boolean,number,number',
  'tipi: day/barber_id/service_id/status stringhe, started booleano, bookings e revenue_cents numeri');
select is(
  (select count(*) filter (where e->>'day' ~ '^\d{4}-\d{2}-\d{2}$'
                             and (e->>'bookings')::numeric = trunc((e->>'bookings')::numeric)
                             and (e->>'revenue_cents')::numeric = trunc((e->>'revenue_cents')::numeric))::text
          || '/' || count(*)::text
     from jsonb_array_elements(pg_temp.res($$'2025-01-13', '2025-01-19'$$)) e
    where e->>'barber_id' in ('f9a00000-0000-4000-8000-0000000000a1', 'f9a00000-0000-4000-8000-0000000000b2')),
  '7/7',
  'day nel formato YYYY-MM-DD; bookings e revenue_cents interi (CLAUDE.md regola 3)');
select is(
  (select count(*)::text || '/' || count(distinct (e->>'day', e->>'barber_id', e->>'service_id', e->>'status', e->>'started'))::text
     from jsonb_array_elements(pg_temp.res($$'2025-01-13', '2025-01-19'$$)) e
    where e->>'barber_id' in ('f9a00000-0000-4000-8000-0000000000a1', 'f9a00000-0000-4000-8000-0000000000b2')),
  '7/7',
  'un solo elemento per combinazione di giorno, barbiere, servizio, stato e started');

-- ===========================================================================
-- 5. Aggregazione: giorno locale, stati, somme, prezzo copiato (SPEC §3.6, §6.9)
-- ===========================================================================
select is(pg_temp.stats($$'2025-01-13', '2025-01-19'$$),
  '2025-01-13|A|S1|completed|true|3|5200; '
  '2025-01-13|A|S1|confirmed|true|1|2000; '
  '2025-01-13|A|S1|no_show|true|1|2000; '
  '2025-01-13|A|S2|cancelled_by_customer|true|1|1500; '
  '2025-01-14|B|S1|cancelled_by_shop|true|1|2000; '
  '2025-01-14|B|S2|completed|true|5|7500; '
  '2025-01-15|A|S1|completed|true|1|2000',
  'settimana 13–19/01/2025: gruppi per giorno locale, barbiere, servizio e stato, cancellate incluse; '
  'revenue = somma dei prezzi copiati (sconto a 12 €, listino cambiato dopo ignorato)');
select is(pg_temp.stats($$'2025-01-13', '2025-01-13'$$),
  '2025-01-13|A|S1|completed|true|3|5200; '
  '2025-01-13|A|S1|confirmed|true|1|2000; '
  '2025-01-13|A|S1|no_show|true|1|2000; '
  '2025-01-13|A|S2|cancelled_by_customer|true|1|1500',
  'mezzanotte: 23:30 UTC del 12/01 è il 13/01 a Roma e conta nel 13');
select is(pg_temp.stats($$'2025-01-12', '2025-01-12'$$), '',
  'mezzanotte: nulla il 12/01 locale (la prenotazione delle 23:30 UTC è del 13)');
select is(pg_temp.stats($$'2025-01-20', '2025-01-20'$$),
  '2025-01-20|A|S1|completed|true|1|2000',
  'mezzanotte: 23:30 UTC del 19/01 è il 20/01 a Roma (fuori dalla settimana 13–19)');
select is(pg_temp.stats($$'2025-01-15', '2025-01-15'$$),
  '2025-01-15|A|S1|completed|true|1|2000',
  'mezzanotte: 22:30 UTC del 15/01 = 23:30 a Roma, resta il 15');
select is(pg_temp.stats($$'2025-01-14', '2025-01-14'$$),
  '2025-01-14|B|S1|cancelled_by_shop|true|1|2000; '
  '2025-01-14|B|S2|completed|true|5|7500',
  'senza terzo argomento le demo sono incluse (p_exclude_demo = false)');

-- Cambio d'ora (SPEC §12)
select is(pg_temp.stats($$'2025-10-25', '2025-10-27'$$),
  '2025-10-25|A|S2|completed|true|1|1500; '
  '2025-10-26|A|S2|completed|true|2|3000; '
  '2025-10-27|A|S2|completed|true|1|1500',
  'SPEC §12: giorno del passaggio all''ora solare (26/10/2025, 25 ore), giorni locali corretti');
select is(pg_temp.stats($$'2025-03-29', '2025-03-31'$$),
  '2025-03-29|B|S2|completed|true|1|1500; '
  '2025-03-30|B|S2|completed|true|2|3000; '
  '2025-03-31|B|S2|completed|true|1|1500',
  'SPEC §12: giorno del passaggio all''ora legale (30/03/2025, 23 ore), giorni locali corretti');
select is(pg_temp.stats($$'2025-10-26', '2025-10-26'$$),
  '2025-10-26|A|S2|completed|true|2|3000',
  'filtro sul giorno locale: solo il 26/10, bordi inclusi');

-- ===========================================================================
-- 6. started = starts_at <= now() (decisione 2)
-- ===========================================================================
select is(pg_temp.stats($$'2040-01-10', '2040-01-10'$$),
  '2040-01-10|A|S2|cancelled_by_customer|false|1|1500; '
  '2040-01-10|A|S2|confirmed|false|1|1500',
  'prenotazioni future: started = false (anche le cancellate)');
select is(
  pg_temp.stats(format('%L, %L',
    (now() at time zone 'Europe/Rome')::date,
    ((now() + interval '1 second') at time zone 'Europe/Rome')::date)),
  format('%s|A|S2|confirmed|true|1|1500; %s|B|S2|confirmed|false|1|1500',
    (now() at time zone 'Europe/Rome')::date,
    ((now() + interval '1 second') at time zone 'Europe/Rome')::date),
  'bordo: inizio = now() → started = true; un secondo dopo → started = false');

-- ===========================================================================
-- 7. Prenotazioni demo (SPEC §6.9): nota del cliente, trim, maiuscole ignorate
-- ===========================================================================
select is(pg_temp.stats($$'2025-01-14', '2025-01-14', true$$),
  '2025-01-14|B|S1|cancelled_by_shop|true|1|2000; '
  '2025-01-14|B|S2|completed|true|2|3000',
  'escludi demo: tolte "Prenotazione demo", "  PRENOTAZIONE demo  " e "\tPrenotazione Demo\r\n"; restano la nota più lunga '
  'e quella con la sola nota staff "Prenotazione demo"');
select is(pg_temp.stats($$'2025-01-14', '2025-01-14', false$$),
  '2025-01-14|B|S1|cancelled_by_shop|true|1|2000; '
  '2025-01-14|B|S2|completed|true|5|7500',
  'demo incluse (p_exclude_demo = false): contano normalmente');
select is(pg_temp.stats($$'2025-01-13', '2025-01-13', true$$),
  '2025-01-13|A|S1|completed|true|3|5200; '
  '2025-01-13|A|S1|confirmed|true|1|2000; '
  '2025-01-13|A|S1|no_show|true|1|2000; '
  '2025-01-13|A|S2|cancelled_by_customer|true|1|1500',
  'escludi demo: le prenotazioni senza nota non cambiano');

-- ===========================================================================
-- 8. Timezone letta da shop_settings (CLAUDE.md regola 2, SPEC §3.1)
-- ===========================================================================
select pg_temp.act_as_postgres();
update public.shop_settings set timezone = 'America/New_York';
select pg_temp.act_as('f9a00000-0000-4000-8000-000000000001');
select is(pg_temp.stats($$'2025-01-12', '2025-01-12'$$),
  '2025-01-12|A|S1|completed|true|1|2000',
  'con timezone America/New_York la prenotazione delle 23:30 UTC del 12/01 conta il 12 (giorno locale del negozio)');
select pg_temp.act_as_postgres();
update public.shop_settings set timezone = 'Europe/Rome';

select * from finish();
rollback;
