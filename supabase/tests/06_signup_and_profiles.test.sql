-- Test di accettazione – FETTA 1 (SPEC §11: "Schema DB + RLS + seed dati demo").
-- 06 – Registrazione e profili: il trigger su auth.users crea SEMPRE un profilo customer;
-- il ruolo si legge dalla tabella profiles, mai dai claim del JWT. SPEC §2, §8.
-- Non modificare durante l'implementazione.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

create function pg_temp.outcome(q text) returns text language plpgsql as $f$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return 'rows:' || n;
exception when others then
  return sqlstate;
end $f$;

-- ---------------------------------------------------------------------------
-- SPEC §2: registrazione → profilo customer
-- ---------------------------------------------------------------------------
select lives_ok(
  $q$ insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('c0000000-0000-4000-8000-000000000601', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              'sig-plain@qa.test', '{}'::jsonb, '{}'::jsonb, now(), now()) $q$,
  'SPEC §2: la registrazione di un utente riesce');
select is((select count(*) from public.profiles where id = 'c0000000-0000-4000-8000-000000000601'),
  1::bigint, 'SPEC §2: il trigger su auth.users crea il profilo');
select is(
  (select row(role, no_show_count, is_blocked, phone)::text from public.profiles
    where id = 'c0000000-0000-4000-8000-000000000601'),
  row('customer'::public.user_role, 0, false, null::text)::text,
  'SPEC §2: profilo nuovo = customer, 0 no-show, non bloccato, telefono NULL');
select isnt((select created_at from public.profiles where id = 'c0000000-0000-4000-8000-000000000601'),
  null, 'profiles.created_at valorizzato alla creazione');

-- Il ruolo non si può scegliere in registrazione (i metadati utente sono controllati dal client)
select lives_ok(
  $q$ insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('c0000000-0000-4000-8000-000000000602', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              'sig-usermeta@qa.test', '{}'::jsonb, '{"role":"admin","is_blocked":true,"no_show_count":7}'::jsonb, now(), now()) $q$,
  'SPEC §2: registrazione con raw_user_meta_data {"role":"admin"} riesce...');
select is(
  (select row(role, no_show_count, is_blocked)::text from public.profiles
    where id = 'c0000000-0000-4000-8000-000000000602'),
  row('customer'::public.user_role, 0, false)::text,
  'SPEC §2: ...ma il profilo è customer: raw_user_meta_data è ignorato');

select lives_ok(
  $q$ insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('c0000000-0000-4000-8000-000000000603', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              'sig-appmeta@qa.test', '{"role":"admin","provider":"email"}'::jsonb, '{"role":"barber"}'::jsonb, now(), now()) $q$,
  'SPEC §2: registrazione con raw_app_meta_data {"role":"admin"} riesce...');
select is(
  (select role::text from public.profiles where id = 'c0000000-0000-4000-8000-000000000603'),
  'customer', 'SPEC §2: ...ma il profilo è customer: anche raw_app_meta_data è ignorato');

-- ---------------------------------------------------------------------------
-- SPEC §2: il ruolo effettivo viene da profiles, non dai claim del JWT
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object(
    'sub', 'c0000000-0000-4000-8000-000000000603',
    'role', 'authenticated',
    'app_metadata', json_build_object('role', 'admin'),
    'user_metadata', json_build_object('role', 'admin'))::text, true);

select is(public.current_user_role()::text, 'customer',
  'SPEC §2: current_user_role() legge profiles, non app_metadata/user_metadata del JWT');
select is(public.is_admin(), false, 'SPEC §2: is_admin() = false con claim admin falsificati');
select is(public.is_staff(), false, 'SPEC §2: is_staff() = false con claim admin falsificati');
select is((select array_agg(id::text) from public.profiles),
  array['c0000000-0000-4000-8000-000000000603'],
  'SPEC §3.7.4: con claim admin falsificati si vede comunque solo il proprio profilo');
select throws_ok(
  $q$ update public.profiles set role = 'admin' where id = 'c0000000-0000-4000-8000-000000000603' $q$,
  '42501', null, 'SPEC §2: un cliente non può promuoversi admin (42501)');
select matches(
  pg_temp.outcome($q$ insert into public.profiles (id, role, full_name)
    values ('c0000000-0000-4000-8000-000000000699', 'admin', 'Sig Intruso') $q$),
  '^(42501|23503|P0001)$', 'SPEC §2: un cliente non può inserire righe in profiles');
select matches(
  pg_temp.outcome($q$ delete from public.profiles where id = 'c0000000-0000-4000-8000-000000000601' $q$),
  '^(rows:0|42501)$', 'SPEC §3.7.4: un cliente non può eliminare il profilo di un altro');

-- JWT autenticato senza profilo (utente inesistente): nessun privilegio
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'c0000000-0000-4000-8000-000000000698', 'role', 'authenticated')::text, true);
select is(public.current_user_role()::text, null,
  'SPEC §2: current_user_role() è NULL per un utente senza profilo');
select ok(public.is_admin() is not true, 'SPEC §2: is_admin() non è true senza profilo');
select ok(public.is_staff() is not true, 'SPEC §2: is_staff() non è true senza profilo');
select matches(pg_temp.outcome($q$ select 1 from public.profiles $q$), '^(rows:0|42501)$',
  'SPEC §3.7.4: un utente senza profilo non vede alcun profilo');

-- ---------------------------------------------------------------------------
-- SPEC §8: eliminazione account → il profilo segue l'utente
-- ---------------------------------------------------------------------------
reset role;
select is(
  (select role::text from public.profiles where id = 'c0000000-0000-4000-8000-000000000603'),
  'customer', 'SPEC §2: dopo i tentativi il ruolo è ancora customer');
select lives_ok(
  $q$ delete from auth.users where id = 'c0000000-0000-4000-8000-000000000601' $q$,
  'SPEC §8: eliminazione di un utente');
select is((select count(*) from public.profiles where id = 'c0000000-0000-4000-8000-000000000601'),
  0::bigint, 'SPEC §8: il profilo è eliminato a cascata con l''utente');

select * from finish();
rollback;
