-- Fetta 8h: modifica approvata dall'utente il 2026-11-08 (amr password nei claim staff / nome della RPC), nessuna asserzione cambiata.
-- Test di accettazione – FETTA 3 (SPEC §11: "Admin: servizi, barbieri, orari, assenze, chiusure").
-- 13 – set_working_hours (orari settimanali a più fasce, SPEC §3.4, §6.5) e reorder_services
-- (ordinamento dei servizi, SPEC §3.2, §6.4) + decisioni approvate per la fetta 3 (punto D).
-- Interfacce attese:
--   public.set_working_hours(p_barber_id uuid, p_hours jsonb)
--     p_hours = array JSON di {"weekday": 1..7, "start_time": "HH:MM", "end_time": "HH:MM"};
--     security invoker, sostituisce in modo atomico tutte le fasce del barbiere.
--   public.reorder_services(p_ids uuid[])
--     security invoker, assegna sort_order secondo l'ordine dell'array; p_ids deve contenere
--     esattamente tutti i servizi esistenti, senza duplicati (altrimenti errore).
--   set_working_hours accetta solo orari "HH:MM" fra 00:00 e 23:59.
--   Entrambe: revoke da public/anon, execute solo ad authenticated (le scritture le filtra la RLS).
-- I dati sono creati dal test e annullati dal rollback. Non modificare durante l'implementazione.
--
-- Convenzione per le chiamate negate: un errore (42501 permesso negato / RLS, P0001 eccezione
-- esplicita) e nessuna modifica ai dati, verificata a parte.
begin;
create extension if not exists pgtap with schema extensions;

select plan(53);

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

-- 'rows:N' se il comando riesce, altrimenti lo SQLSTATE
create function pg_temp.outcome(q text) returns text language plpgsql as $f$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return 'rows:' || n;
exception when others then
  return sqlstate;
end $f$;

-- Privilegio di esecuzione senza errori se la funzione non esiste ancora (null)
create function pg_temp.can_exec(r text, sig text) returns boolean language plpgsql as $f$
begin
  return has_function_privilege(r, sig, 'execute');
exception when others then
  return null;
end $f$;

create function pg_temp.public_can_exec(fname text) returns boolean language sql as $f$
  select bool_or(exists (
           select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = fname
$f$;

create function pg_temp.is_invoker(fname text) returns boolean language sql as $f$
  select bool_and(not p.prosecdef)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = fname
$f$;

-- Fasce del barbiere come testo ordinato, per confrontare lo stato prima e dopo
create function pg_temp.hours_of(bid uuid) returns text language sql as $f$
  select coalesce(string_agg(format('%s %s-%s', weekday, to_char(start_time, 'HH24:MI'), to_char(end_time, 'HH24:MI')),
                             ', ' order by weekday, start_time), '')
    from public.working_hours where barber_id = bid
$f$;

create function pg_temp.order_of(ids uuid[]) returns uuid[] language sql as $f$
  select array_agg(s.id order by s.sort_order, s.id) from public.services s where s.id = any (ids)
$f$;

-- ---------------------------------------------------------------------------
-- Dati di base (come postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('d3000000-0000-4000-8000-000000001301', 'f3-admin@qa.test'),
  ('d3000000-0000-4000-8000-000000001302', 'f3-barber@qa.test'),
  ('d3000000-0000-4000-8000-000000001303', 'f3-customer@qa.test');
update public.profiles set role = 'admin' where id = 'd3000000-0000-4000-8000-000000001301';
update public.profiles set role = 'barber' where id = 'd3000000-0000-4000-8000-000000001302';

insert into public.barbers (id, display_name, is_active, profile_id) values
  ('db000000-0000-4000-8000-000000001301', 'F3 Barbiere Uno', true, 'd3000000-0000-4000-8000-000000001302'),
  ('db000000-0000-4000-8000-000000001302', 'F3 Barbiere Due', true, null);

insert into public.working_hours (barber_id, weekday, start_time, end_time) values
  ('db000000-0000-4000-8000-000000001301', 2, '09:00', '13:00'),
  ('db000000-0000-4000-8000-000000001301', 2, '15:00', '19:30'),
  ('db000000-0000-4000-8000-000000001301', 3, '09:00', '13:00'),
  ('db000000-0000-4000-8000-000000001302', 2, '10:00', '12:00');

insert into public.services (id, name, duration_min, price_cents, is_active, sort_order) values
  ('d5000000-0000-4000-8000-000000001301', 'F3 Primo', 30, 2000, true, 9101),
  ('d5000000-0000-4000-8000-000000001302', 'F3 Secondo', 30, 2000, true, 9102),
  ('d5000000-0000-4000-8000-000000001303', 'F3 Terzo', 30, 2000, false, 9103);

-- ===========================================================================
-- set_working_hours – struttura e privilegi
-- ===========================================================================
select has_function('public', 'set_working_hours', array['uuid', 'jsonb'],
  'SPEC §3.4: esiste public.set_working_hours(p_barber_id uuid, p_hours jsonb)');
select is(pg_temp.is_invoker('set_working_hours'), true,
  'decisione fetta 3: set_working_hours è security invoker (le scritture passano dalla RLS)');
select is(pg_temp.can_exec('anon', 'public.set_working_hours(uuid, jsonb)'), false,
  'decisione fetta 3: set_working_hours non è eseguibile da anon');
select is(pg_temp.public_can_exec('set_working_hours'), false,
  'decisione fetta 3: set_working_hours non è eseguibile da PUBLIC');
select is(pg_temp.can_exec('authenticated', 'public.set_working_hours(uuid, jsonb)'), true,
  'decisione fetta 3: set_working_hours è eseguibile da authenticated');

-- ===========================================================================
-- ADMIN
-- ===========================================================================
select pg_temp.act_as('d3000000-0000-4000-8000-000000001301');

-- SPEC §3.4: "una o più fasce (es. 09:00–13:00 e 15:00–19:30)"
select matches(
  pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001301',
    '[{"weekday": 2, "start_time": "09:00", "end_time": "13:00"},
      {"weekday": 2, "start_time": "15:00", "end_time": "19:30"},
      {"weekday": 5, "start_time": "08:30", "end_time": "12:00"}]'::jsonb) $q$),
  '^rows:\d+$', 'admin – SPEC §6.5: set_working_hours salva gli orari settimanali');
select is(pg_temp.hours_of('db000000-0000-4000-8000-000000001301'),
  '2 09:00-13:00, 2 15:00-19:30, 5 08:30-12:00',
  'admin – SPEC §3.4: le fasce del barbiere sono sostituite per intero (il mercoledì non c''è più)');
select is(pg_temp.hours_of('db000000-0000-4000-8000-000000001302'), '2 10:00-12:00',
  'admin: le fasce degli altri barbieri non cambiano');

-- Fasce contigue: non si sovrappongono
select matches(
  pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001302',
    '[{"weekday": 4, "start_time": "09:00", "end_time": "13:00"},
      {"weekday": 4, "start_time": "13:00", "end_time": "15:00"}]'::jsonb) $q$),
  '^rows:\d+$', 'admin – SPEC §3.4: fasce contigue nello stesso giorno ammesse');
select is(pg_temp.hours_of('db000000-0000-4000-8000-000000001302'), '4 09:00-13:00, 4 13:00-15:00',
  'admin: fasce contigue salvate');

-- Input non valido: errore e nessuna modifica (atomicità)
select matches(
  pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001301',
    '[{"weekday": 1, "start_time": "09:00", "end_time": "13:00"},
      {"weekday": 1, "start_time": "12:00", "end_time": "15:00"}]'::jsonb) $q$),
  '^(23P01|22023|23514|P0001)$', 'admin – SPEC §3.4: fasce sovrapposte nello stesso giorno rifiutate');
select is(pg_temp.hours_of('db000000-0000-4000-8000-000000001301'),
  '2 09:00-13:00, 2 15:00-19:30, 5 08:30-12:00',
  'admin – decisione fetta 3: dopo l''errore le fasce precedenti restano intatte');
select matches(
  pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001301',
    '[{"weekday": 1, "start_time": "13:00", "end_time": "09:00"}]'::jsonb) $q$),
  '^(23514|22023|22007|P0001)$', 'admin: fascia con inizio dopo la fine rifiutata');
select matches(
  pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001301',
    '[{"weekday": 1, "start_time": "09:00", "end_time": "09:00"}]'::jsonb) $q$),
  '^(23514|22023|22007|P0001)$', 'admin: fascia vuota (inizio = fine) rifiutata');
select matches(
  pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001301',
    '[{"weekday": 8, "start_time": "09:00", "end_time": "13:00"}]'::jsonb) $q$),
  '^(23514|22023|22003|P0001)$', 'admin – SPEC §3.4: giorno della settimana fuori da 1–7 rifiutato');
select matches(
  pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001301',
    '[{"weekday": 1, "start_time": "nove", "end_time": "13:00"}]'::jsonb) $q$),
  '^(22007|22008|22023|22P02|P0001)$', 'admin: orario non valido rifiutato');
select matches(
  pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001301',
    '{"weekday": 1, "start_time": "09:00", "end_time": "13:00"}'::jsonb) $q$),
  '^(22023|22P02|42804|P0001)$', 'admin: p_hours che non è un array rifiutato');
select is(pg_temp.hours_of('db000000-0000-4000-8000-000000001301'),
  '2 09:00-13:00, 2 15:00-19:30, 5 08:30-12:00',
  'admin: dopo gli input non validi le fasce restano intatte');

select matches(
  pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001399',
    '[{"weekday": 1, "start_time": "09:00", "end_time": "13:00"}]'::jsonb) $q$),
  '^(23503|P0001|P0002|22023)$', 'admin: barbiere inesistente rifiutato');

-- Decisione fetta 3 (utente): orari solo HH:MM fra 00:00 e 23:59 (niente "24:00")
select matches(
  pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001301',
    '[{"weekday": 5, "start_time": "18:00", "end_time": "24:00"}]'::jsonb) $q$),
  '^(23514|22023|22007|22008|P0001)$', 'admin – decisione fetta 3: end_time "24:00" rifiutato');
select matches(
  pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001301',
    '[{"weekday": 5, "start_time": "18:00", "end_time": "23:59:30"}]'::jsonb) $q$),
  '^(23514|22023|22007|22008|P0001)$', 'admin – decisione fetta 3: orario con i secondi (non HH:MM) rifiutato');
select matches(
  pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001301',
    '[{"weekday": 5, "start_time": "9:00", "end_time": "12:00"}]'::jsonb) $q$),
  '^(23514|22023|22007|22008|P0001)$', 'admin – decisione fetta 3: orario non nel formato HH:MM rifiutato');
select is(pg_temp.hours_of('db000000-0000-4000-8000-000000001301'),
  '2 09:00-13:00, 2 15:00-19:30, 5 08:30-12:00',
  'admin – decisione fetta 3: dopo gli orari fuori formato le fasce restano intatte');

-- ===========================================================================
-- BARBER (barbiere 1, collegato alla scheda db...1301): orari solo in lettura (ADR 001)
-- ===========================================================================
select pg_temp.act_as('d3000000-0000-4000-8000-000000001302');

select matches(
  pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001301',
    '[{"weekday": 1, "start_time": "06:00", "end_time": "23:00"}]'::jsonb) $q$),
  '^(42501|P0001)$', 'barber – SPEC §2: non modifica i propri orari con set_working_hours');
select matches(
  pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001302',
    '[{"weekday": 1, "start_time": "06:00", "end_time": "23:00"}]'::jsonb) $q$),
  '^(42501|P0001)$', 'barber – SPEC §2: non modifica gli orari di un altro barbiere');
do $d$ begin perform pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001301', '[]'::jsonb) $q$); end $d$;

select pg_temp.act_as_postgres();
select is(pg_temp.hours_of('db000000-0000-4000-8000-000000001301'),
  '2 09:00-13:00, 2 15:00-19:30, 5 08:30-12:00',
  'barber – SPEC §2: dopo i tentativi del barbiere (anche con elenco vuoto) i suoi orari sono intatti');
select is(pg_temp.hours_of('db000000-0000-4000-8000-000000001302'), '4 09:00-13:00, 4 13:00-15:00',
  'barber: gli orari dell''altro barbiere sono intatti');

-- ===========================================================================
-- CUSTOMER e ANON
-- ===========================================================================
select pg_temp.act_as('d3000000-0000-4000-8000-000000001303');
select matches(
  pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001301',
    '[{"weekday": 1, "start_time": "06:00", "end_time": "23:00"}]'::jsonb) $q$),
  '^(42501|P0001)$', 'customer – SPEC §2: set_working_hours rifiutata');
do $d$ begin perform pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001301', '[]'::jsonb) $q$); end $d$;

select pg_temp.act_as_anon();
select is(
  pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001301', '[]'::jsonb) $q$),
  '42501', 'anon: set_working_hours non eseguibile (42501)');

select pg_temp.act_as_postgres();
select is(pg_temp.hours_of('db000000-0000-4000-8000-000000001301'),
  '2 09:00-13:00, 2 15:00-19:30, 5 08:30-12:00',
  'customer e anon: gli orari restano intatti');

-- Un barbiere che non lavora mai: l'admin svuota le fasce
select pg_temp.act_as('d3000000-0000-4000-8000-000000001301');
select matches(
  pg_temp.outcome($q$ select public.set_working_hours('db000000-0000-4000-8000-000000001302', '[]'::jsonb) $q$),
  '^rows:\d+$', 'admin – SPEC §3.4: un elenco vuoto toglie tutte le fasce');
select is(pg_temp.hours_of('db000000-0000-4000-8000-000000001302'), '',
  'admin: il barbiere non ha più fasce');

-- ===========================================================================
-- reorder_services – struttura e privilegi
-- ===========================================================================
select pg_temp.act_as_postgres();
select has_function('public', 'reorder_services', array['uuid[]'],
  'SPEC §6.4: esiste public.reorder_services(p_ids uuid[])');
select is(pg_temp.is_invoker('reorder_services'), true,
  'decisione fetta 3: reorder_services è security invoker');
select is(pg_temp.can_exec('anon', 'public.reorder_services(uuid[])'), false,
  'decisione fetta 3: reorder_services non è eseguibile da anon');
select is(pg_temp.public_can_exec('reorder_services'), false,
  'decisione fetta 3: reorder_services non è eseguibile da PUBLIC');
select is(pg_temp.can_exec('authenticated', 'public.reorder_services(uuid[])'), true,
  'decisione fetta 3: reorder_services è eseguibile da authenticated');

-- ===========================================================================
-- reorder_services – admin
-- Decisione fetta 3 (utente): p_ids deve contenere esattamente tutti i servizi esistenti, una
-- volta sola; altrimenti errore e nessuna modifica.
-- Gli ordini di riferimento si preparano come postgres e si passano in variabili di sessione.
-- ===========================================================================
select set_config('f3.order1',
  (select (array['d5000000-0000-4000-8000-000000001303', 'd5000000-0000-4000-8000-000000001301',
                 'd5000000-0000-4000-8000-000000001302']::uuid[]
           || array_agg(s.id order by s.sort_order, s.id))::text
     from public.services s
    where s.id not in ('d5000000-0000-4000-8000-000000001301', 'd5000000-0000-4000-8000-000000001302',
                       'd5000000-0000-4000-8000-000000001303')), true);
select set_config('f3.order2',
  (select (array_agg(s.id order by s.sort_order desc, s.id)
           || array['d5000000-0000-4000-8000-000000001302', 'd5000000-0000-4000-8000-000000001303',
                    'd5000000-0000-4000-8000-000000001301']::uuid[])::text
     from public.services s
    where s.id not in ('d5000000-0000-4000-8000-000000001301', 'd5000000-0000-4000-8000-000000001302',
                       'd5000000-0000-4000-8000-000000001303')), true);

create function pg_temp.full_order() returns text language sql as $f$
  select array_agg(s.id order by s.sort_order, s.id)::text from public.services s
$f$;

select pg_temp.act_as('d3000000-0000-4000-8000-000000001301');
select matches(
  pg_temp.outcome($q$ select public.reorder_services(current_setting('f3.order1')::uuid[]) $q$),
  '^rows:\d+$', 'admin – SPEC §6.4: reorder_services con tutti i servizi eseguita');
select pg_temp.act_as_postgres();
select is(pg_temp.full_order(), current_setting('f3.order1'),
  'admin – SPEC §3.2: l''ordine di tutto il catalogo è quello dell''array (anche per un servizio disattivato)');
select is((select count(distinct sort_order) from public.services), (select count(*) from public.services),
  'admin: dopo il riordino i sort_order sono tutti distinti');

select pg_temp.act_as('d3000000-0000-4000-8000-000000001301');
select matches(
  pg_temp.outcome($q$ select public.reorder_services(current_setting('f3.order2')::uuid[]) $q$),
  '^rows:\d+$', 'admin: secondo riordino eseguito');
select pg_temp.act_as_postgres();
select is(pg_temp.full_order(), current_setting('f3.order2'),
  'admin: il nuovo ordine sostituisce il precedente');
select is(
  (select row(name, duration_min, price_cents, is_active)::text from public.services
    where id = 'd5000000-0000-4000-8000-000000001303'),
  row('F3 Terzo', 30, 2000, false)::text,
  'admin: il riordino cambia solo sort_order');

-- Elenchi non completi o non validi: errore e nessuna modifica
select pg_temp.act_as('d3000000-0000-4000-8000-000000001301');
select matches(
  pg_temp.outcome($q$ select public.reorder_services(array[
    'd5000000-0000-4000-8000-000000001301', 'd5000000-0000-4000-8000-000000001302',
    'd5000000-0000-4000-8000-000000001303']::uuid[]) $q$),
  '^(22023|23514|P0001)$', 'admin – decisione fetta 3: elenco parziale rifiutato');
select matches(
  pg_temp.outcome($q$ select public.reorder_services(
    current_setting('f3.order1')::uuid[] || 'd5000000-0000-4000-8000-000000001399'::uuid) $q$),
  '^(22023|23514|23503|P0001|P0002)$', 'admin – decisione fetta 3: id sconosciuto rifiutato');
select matches(
  pg_temp.outcome($q$ select public.reorder_services(
    current_setting('f3.order1')::uuid[] || 'd5000000-0000-4000-8000-000000001301'::uuid) $q$),
  '^(22023|23514|23505|P0001)$', 'admin – decisione fetta 3: id duplicato rifiutato');
select matches(
  pg_temp.outcome($q$ select public.reorder_services((current_setting('f3.order1')::uuid[])[2:]) $q$),
  '^(22023|23514|P0001)$', 'admin – decisione fetta 3: elenco senza un servizio rifiutato');
select matches(
  pg_temp.outcome($q$ select public.reorder_services('{}'::uuid[]) $q$),
  '^(22023|23514|P0001)$', 'admin – decisione fetta 3: elenco vuoto rifiutato');
select pg_temp.act_as_postgres();
select is(pg_temp.full_order(), current_setting('f3.order2'),
  'admin – decisione fetta 3: dopo gli elenchi non validi l''ordine resta invariato');

-- ===========================================================================
-- reorder_services – barber, customer, anon: nessuna modifica
-- ===========================================================================
select pg_temp.act_as('d3000000-0000-4000-8000-000000001302');
select matches(
  pg_temp.outcome($q$ select public.reorder_services(current_setting('f3.order1')::uuid[]) $q$),
  '^(42501|P0001|rows:\d+)$', 'barber: chiamata a reorder_services (senza effetto, verificato sotto)');
select pg_temp.act_as('d3000000-0000-4000-8000-000000001303');
select matches(
  pg_temp.outcome($q$ select public.reorder_services(current_setting('f3.order1')::uuid[]) $q$),
  '^(42501|P0001|22023|rows:\d+)$', 'customer: chiamata a reorder_services (senza effetto, verificato sotto)');
select pg_temp.act_as_anon();
select is(
  pg_temp.outcome($q$ select public.reorder_services(current_setting('f3.order1')::uuid[]) $q$),
  '42501', 'anon: reorder_services non eseguibile (42501)');

select pg_temp.act_as_postgres();
select is(pg_temp.full_order(), current_setting('f3.order2'),
  'SPEC §2: barbiere, cliente e anon non cambiano l''ordine dei servizi');

select * from finish();
rollback;
