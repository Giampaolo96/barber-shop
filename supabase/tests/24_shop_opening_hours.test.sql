-- Fetta 8h: modifica approvata dall'utente il 2026-11-08 (amr password nei claim staff / nome della RPC), nessuna asserzione cambiata.
-- Test di accettazione – FETTA 8a (identità visiva, tema "Mosca"): orari del negozio in home.
-- 24 – Funzioni pubbliche shop_opening_hours() e shop_closures_today(); nome del negozio nel seed.
-- SPEC §3.1 (nome e timezone in shop_settings), §3.3 (barbiere attivo/disattivo), §3.4 (fasce in ora
-- locale, weekday ISO 1 = lunedì … 7 = domenica), §3.5 (chiusure), §3.7.4 (nessun dato di altri),
-- §5.1 (home: info negozio) + decisioni approvate 2 e 4 della fetta 8a:
--   public.shop_opening_hours() returns table (weekday smallint, start_time time, end_time time)
--     security definer, search_path = ''; execute ad anon e authenticated (non a PUBLIC).
--     Per ogni weekday l'unione delle fasce dei barbieri ATTIVI, con le fasce sovrapposte o contigue
--     unite; nessun dato del singolo barbiere; ordinato per weekday, start_time.
--   public.shop_closures_today() returns table (starts_at timestamptz, ends_at timestamptz)
--     stessa sicurezza; chiusure che toccano il giorno locale di oggi (timezone da shop_settings),
--     senza il motivo. "Toccano" = intersezione non vuota fra [starts_at, ends_at) e
--     [oggi 00:00, domani 00:00) locali (intervalli semiaperti come nel resto dello schema).
--   Il seed imposta il nome "Mosca Barber Shop".
--
-- Le chiamate passano da EXECUTE dentro helper che intercettano gli errori: se una funzione manca il
-- test fallisce mostrando il codice, senza interrompere il file.
-- I barbieri e le chiusure del seed sono disattivati/rimossi nel test; tutto è annullato dal rollback.
-- Non modificare durante l'implementazione.
begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

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

-- Una query che restituisce un solo valore, come testo; in caso d'errore 'ERR <sqlstate>'
create function pg_temp.val(q text) returns text language plpgsql as $f$
declare r text;
begin
  execute q into r;
  return r;
exception when others then
  return 'ERR ' || sqlstate;
end $f$;

-- Righe di shop_opening_hours() nell'ordine restituito: "w HH:MM-HH:MM; ..."
create function pg_temp.opening() returns text language sql as $f$
  select pg_temp.val($q$
    select coalesce(string_agg(format('%s %s-%s', t.weekday, to_char(t.start_time, 'HH24:MI'),
                                      to_char(t.end_time, 'HH24:MI')), '; ' order by t.n), '')
      from public.shop_opening_hours() with ordinality as t(weekday, start_time, end_time, n) $q$)
$f$;

-- Righe di shop_closures_today() ordinate per inizio: "starts|ends; ..."
create function pg_temp.closures_today() returns text language sql as $f$
  select pg_temp.val($q$
    select coalesce(string_agg(format('%s|%s', c.starts_at, c.ends_at), '; ' order by c.starts_at), '')
      from public.shop_closures_today() c $q$)
$f$;

create function pg_temp.fn_sig(sig text) returns oid language sql as $f$
  select to_regprocedure(sig)::oid
$f$;

-- security definer con search_path = ''
create function pg_temp.definer_empty_path(sig text) returns boolean language sql as $f$
  select coalesce((select p.prosecdef
                      and exists (select 1 from unnest(p.proconfig) c where c ~ '^search_path=("")?$')
                     from pg_proc p where p.oid = pg_temp.fn_sig(sig)), false)
$f$;

-- execute: anon sì, authenticated sì, PUBLIC no
create function pg_temp.grants_ok(sig text) returns boolean language plpgsql as $f$
declare f oid := pg_temp.fn_sig(sig);
begin
  if f is null then return false; end if;
  return has_function_privilege('anon', f, 'execute')
     and has_function_privilege('authenticated', f, 'execute')
     and not coalesce((select bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE')
                         from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        where p.oid = f), false);
end $f$;

-- ---------------------------------------------------------------------------
-- 1. Struttura e sicurezza (decisione 4, CLAUDE.md – Sicurezza)
-- ---------------------------------------------------------------------------
select isnt(pg_temp.fn_sig('public.shop_opening_hours()'), null,
  'decisione 4: esiste public.shop_opening_hours()');
select isnt(pg_temp.fn_sig('public.shop_closures_today()'), null,
  'decisione 4: esiste public.shop_closures_today()');

select ok(pg_temp.definer_empty_path('public.shop_opening_hours()'),
  'shop_opening_hours: security definer con search_path vuoto');
select ok(pg_temp.definer_empty_path('public.shop_closures_today()'),
  'shop_closures_today: security definer con search_path vuoto');

-- Colonne esatte: nessun id o nome del barbiere (SPEC §3.7.4), nessun motivo della chiusura
select is(pg_get_function_result(pg_temp.fn_sig('public.shop_opening_hours()')),
  'TABLE(weekday smallint, start_time time without time zone, end_time time without time zone)',
  'shop_opening_hours: solo weekday, start_time, end_time (nessun dato del barbiere)');
select is(pg_get_function_result(pg_temp.fn_sig('public.shop_closures_today()')),
  'TABLE(starts_at timestamp with time zone, ends_at timestamp with time zone)',
  'shop_closures_today: solo starts_at, ends_at (nessun motivo)');

select ok(pg_temp.grants_ok('public.shop_opening_hours()'),
  'shop_opening_hours: eseguibile da anon e authenticated, non da PUBLIC');
select ok(pg_temp.grants_ok('public.shop_closures_today()'),
  'shop_closures_today: eseguibile da anon e authenticated, non da PUBLIC');

-- ---------------------------------------------------------------------------
-- 2. Seed (decisione 2)
-- ---------------------------------------------------------------------------
select is((select name from public.shop_settings), 'Mosca Barber Shop',
  'decisione 2: il seed imposta il nome del negozio "Mosca Barber Shop"');

-- ---------------------------------------------------------------------------
-- Dati: solo i barbieri del test sono attivi
-- ---------------------------------------------------------------------------
update public.barbers set is_active = false;

insert into public.barbers (id, display_name, is_active) values
  ('b8a00000-0000-4000-8000-000000000001', 'QA Orari A', true),
  ('b8a00000-0000-4000-8000-000000000002', 'QA Orari B', true),
  ('b8a00000-0000-4000-8000-000000000003', 'QA Orari C disattivato', false);

insert into public.working_hours (barber_id, weekday, start_time, end_time) values
  -- martedì: A 09–13 e B 12–14 si sovrappongono → 09–14; A 15–17 e B 17–19 contigue → 15–19
  ('b8a00000-0000-4000-8000-000000000001', 2, '09:00', '13:00'),
  ('b8a00000-0000-4000-8000-000000000002', 2, '12:00', '14:00'),
  ('b8a00000-0000-4000-8000-000000000001', 2, '15:00', '17:00'),
  ('b8a00000-0000-4000-8000-000000000002', 2, '17:00', '19:00'),
  -- mercoledì: solo A, due fasce con pausa pranzo → restano separate
  ('b8a00000-0000-4000-8000-000000000001', 3, '15:00', '19:00'),
  ('b8a00000-0000-4000-8000-000000000001', 3, '09:00', '13:00'),
  -- domenica (7): solo B
  ('b8a00000-0000-4000-8000-000000000002', 7, '10:00', '12:00'),
  -- C è disattivato: le sue fasce non contano (né il martedì né il giovedì)
  ('b8a00000-0000-4000-8000-000000000003', 2, '06:00', '22:00'),
  ('b8a00000-0000-4000-8000-000000000003', 4, '08:00', '20:00');

-- ---------------------------------------------------------------------------
-- 3. Orari del negozio (decisione 4, SPEC §3.3, §3.4)
-- ---------------------------------------------------------------------------
select pg_temp.act_as_anon();
select is(pg_temp.opening(),
  '2 09:00-14:00; 2 15:00-19:00; 3 09:00-13:00; 3 15:00-19:00; 7 10:00-12:00',
  'anon: unione delle fasce dei barbieri attivi (sovrapposte e contigue unite, pausa pranzo separata, '
  || 'disattivato escluso), ordinata per weekday e start_time');
select pg_temp.act_as_postgres();

select pg_temp.act_as('a0000000-0000-4000-8000-000000000003');  -- cliente demo
select is(pg_temp.opening(),
  '2 09:00-14:00; 2 15:00-19:00; 3 09:00-13:00; 3 15:00-19:00; 7 10:00-12:00',
  'authenticated: stesso risultato di anon');
select pg_temp.act_as_postgres();

-- Disattivando A restano solo le fasce di B, senza unione con quelle di A
update public.barbers set is_active = false where id = 'b8a00000-0000-4000-8000-000000000001';
select pg_temp.act_as_anon();
select is(pg_temp.opening(), '2 12:00-14:00; 2 17:00-19:00; 7 10:00-12:00',
  'anon: un barbiere disattivato non contribuisce agli orari del negozio');
select pg_temp.act_as_postgres();

-- ---------------------------------------------------------------------------
-- 4. Chiusure di oggi (decisione 4, SPEC §3.5): giorno locale nella timezone del negozio
-- ---------------------------------------------------------------------------
delete from public.shop_closures;

create temp table qa_day as
select ((now() at time zone ss.timezone)::date) as today, ss.timezone as tz
  from public.shop_settings ss;
grant select on qa_day to anon, authenticated;

insert into public.shop_closures (starts_at, ends_at, reason)
select v.s, v.e, v.reason
  from qa_day d
 cross join lateral (values
   -- iniziata ieri, finisce oggi → inclusa
   (((d.today - 1) + time '18:00') at time zone d.tz, (d.today + time '10:00') at time zone d.tz, 'QA ieri-oggi'),
   -- tutta dentro oggi → inclusa
   ((d.today + time '12:00') at time zone d.tz, (d.today + time '13:00') at time zone d.tz, 'QA oggi'),
   -- finisce esattamente alla mezzanotte di oggi → esclusa ([) non tocca oggi)
   (((d.today - 1) + time '08:00') at time zone d.tz, (d.today + time '00:00') at time zone d.tz, 'QA fino a mezzanotte'),
   -- domani, dalla mezzanotte → esclusa
   (((d.today + 1) + time '00:00') at time zone d.tz, ((d.today + 1) + time '23:00') at time zone d.tz, 'QA domani')
 ) as v (s, e, reason);

select set_config('f8.expected_closures',
  (select string_agg(format('%s|%s', c.starts_at, c.ends_at), '; ' order by c.starts_at)
     from public.shop_closures c where c.reason in ('QA ieri-oggi', 'QA oggi')),
  true);

select pg_temp.act_as_anon();
select is(pg_temp.closures_today(), current_setting('f8.expected_closures'),
  'anon: chiusure che toccano oggi (anche quella iniziata ieri); escluse quella finita a mezzanotte '
  || 'e quella di domani');
select pg_temp.act_as_postgres();

select pg_temp.act_as('a0000000-0000-4000-8000-000000000003');
select is(pg_temp.closures_today(), current_setting('f8.expected_closures'),
  'authenticated: stesso risultato di anon');
select pg_temp.act_as_postgres();

-- Nessuna chiusura oggi → nessuna riga
delete from public.shop_closures where reason in ('QA ieri-oggi', 'QA oggi');
select pg_temp.act_as_anon();
select is(pg_temp.closures_today(), '', 'anon: nessuna chiusura oggi → nessuna riga');
select pg_temp.act_as_postgres();

select * from finish();
rollback;
