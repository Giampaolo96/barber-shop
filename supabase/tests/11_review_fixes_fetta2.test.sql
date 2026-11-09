-- Fetta 8h: modifica approvata dall'utente il 2026-11-08 (amr password nei claim staff / nome della RPC), nessuna asserzione cambiata.
-- Regressioni della review della fetta 2: lo staff bloccato perde i privilegi nel database.
-- Crea i propri dati; va eseguito dopo `npx supabase db reset`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

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

create function pg_temp.act_as_postgres() returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $f$;

create function pg_temp.outcome(q text) returns text language plpgsql as $f$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return 'rows:' || n;
exception when others then
  return sqlstate;
end $f$;

insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-000000002001', 'r2-admin-bloccato@qa.test'),
  ('f0000000-0000-4000-8000-000000002002', 'r2-barbiere-bloccato@qa.test'),
  ('f0000000-0000-4000-8000-000000002003', 'r2-cliente@qa.test'),
  ('f0000000-0000-4000-8000-000000002004', 'r2-cliente-bloccato@qa.test');
update public.profiles set role = 'admin', is_blocked = true
 where id = 'f0000000-0000-4000-8000-000000002001';
update public.profiles set role = 'barber', is_blocked = true
 where id = 'f0000000-0000-4000-8000-000000002002';
update public.profiles set is_blocked = true
 where id = 'f0000000-0000-4000-8000-000000002004';
insert into public.barbers (id, display_name, is_active, profile_id) values
  ('fb000000-0000-4000-8000-000000002001', 'R2 Barber', true, 'f0000000-0000-4000-8000-000000002002');

-- Admin bloccato
select pg_temp.act_as('f0000000-0000-4000-8000-000000002001');
select is(public.is_admin(), false, 'admin bloccato: is_admin() è false');
select is(public.is_staff(), false, 'admin bloccato: is_staff() è false');
select is(public.current_user_role()::text, 'admin',
  'admin bloccato: current_user_role() resta il ruolo scritto in profiles');
select is(
  pg_temp.outcome($q$ update public.profiles set is_blocked = false
                       where id = 'f0000000-0000-4000-8000-000000002001' $q$),
  '42501', 'admin bloccato: non può sbloccarsi da solo (42501)');
select matches(
  pg_temp.outcome($q$ update public.shop_settings set name = 'Manomesso' $q$),
  '^(rows:0|42501)$', 'admin bloccato: non modifica le impostazioni');
select is(
  (select count(*) from public.profiles where id <> 'f0000000-0000-4000-8000-000000002001'),
  0::bigint, 'admin bloccato: non legge i profili degli altri');

-- Barbiere bloccato
select pg_temp.act_as('f0000000-0000-4000-8000-000000002002');
select is(public.is_staff(), false, 'barbiere bloccato: is_staff() è false');
select is(public.current_barber_id(), null, 'barbiere bloccato: current_barber_id() è NULL');
select is((select count(*) from public.bookings), 0::bigint,
  'barbiere bloccato: non legge alcuna prenotazione');
select matches(
  pg_temp.outcome($q$ select * from public.search_customers('demo') $q$),
  '^(rows:0|42501)$', 'barbiere bloccato: la ricerca clienti non restituisce risultati');

-- Il cliente bloccato resta un cliente normale per la RLS
select pg_temp.act_as('f0000000-0000-4000-8000-000000002004');
select is(
  (select count(*) from public.profiles where id = 'f0000000-0000-4000-8000-000000002004'),
  1::bigint, 'cliente bloccato: legge ancora il proprio profilo');
select is(
  pg_temp.outcome($q$ update public.profiles set full_name = 'Cliente Bloccato'
                       where id = 'f0000000-0000-4000-8000-000000002004' $q$),
  'rows:1', 'cliente bloccato: modifica ancora il proprio nome');

select pg_temp.act_as_postgres();
select * from finish();
rollback;
