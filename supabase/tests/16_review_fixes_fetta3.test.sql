-- Regressioni della review della fetta 3 (scritte durante l'implementazione, non da spec-qa).
-- 1. Collegamento scheda → account: una scheda già collegata non passa a un altro account
--    (barbers_guard_account_link); scollegare e collegare una scheda libera restano possibili.
-- 2. Tetti massimi delle impostazioni (decisione dell'utente): anticipo e limite di
--    cancellazione ≤ 7 giorni, orizzonte ≤ 365 giorni, buffer ≤ 60 minuti, soglia no-show 0–10.
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
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

create function pg_temp.linked(bid uuid) returns uuid language sql as $f$
  select profile_id from public.barbers where id = bid
$f$;

insert into auth.users (id, email) values
  ('d3000000-0000-4000-8000-000000001601', 'f3-fix-admin@qa.test'),
  ('d3000000-0000-4000-8000-000000001602', 'f3-fix-barber-a@qa.test'),
  ('d3000000-0000-4000-8000-000000001603', 'f3-fix-barber-b@qa.test');
update public.profiles set role = 'admin' where id = 'd3000000-0000-4000-8000-000000001601';
update public.profiles set role = 'barber'
 where id in ('d3000000-0000-4000-8000-000000001602', 'd3000000-0000-4000-8000-000000001603');

insert into public.barbers (id, display_name, is_active, profile_id) values
  ('db000000-0000-4000-8000-000000001601', 'F3 Fix Collegato', true, 'd3000000-0000-4000-8000-000000001602'),
  ('db000000-0000-4000-8000-000000001602', 'F3 Fix Libero', true, null);

-- ===========================================================================
-- 1. Guardia sul collegamento
-- ===========================================================================
select is(has_function_privilege('anon', 'public.barbers_guard_account_link()', 'execute'), false,
  'la funzione della guardia non è eseguibile da anon');
select is(has_function_privilege('authenticated', 'public.barbers_guard_account_link()', 'execute'), false,
  'la funzione della guardia non è eseguibile da authenticated');

select pg_temp.act_as('d3000000-0000-4000-8000-000000001601');

-- Il secondo collegamento concorrente: la scheda ha già un account, l'update viene rifiutato
select is(
  pg_temp.outcome($q$ update public.barbers set profile_id = 'd3000000-0000-4000-8000-000000001603'
                       where id = 'db000000-0000-4000-8000-000000001601' $q$),
  '55000', 'admin: una scheda già collegata non passa a un altro account (55000)');
select pg_temp.act_as_postgres();
select is(pg_temp.linked('db000000-0000-4000-8000-000000001601'), 'd3000000-0000-4000-8000-000000001602'::uuid,
  'dopo il rifiuto la scheda resta collegata all''account di prima');

-- Neanche i ruoli di servizio aggirano la guardia
select is(
  pg_temp.outcome($q$ update public.barbers set profile_id = 'd3000000-0000-4000-8000-000000001603'
                       where id = 'db000000-0000-4000-8000-000000001601' $q$),
  '55000', 'postgres: la guardia vale anche fuori dall''app');

select pg_temp.act_as('d3000000-0000-4000-8000-000000001601');
select is(
  pg_temp.outcome($q$ update public.barbers set profile_id = 'd3000000-0000-4000-8000-000000001602'
                       where id = 'db000000-0000-4000-8000-000000001601' $q$),
  'rows:1', 'admin: riscrivere lo stesso account è ammesso');
select is(
  pg_temp.outcome($q$ update public.barbers set display_name = 'F3 Fix Rinominato'
                       where id = 'db000000-0000-4000-8000-000000001601' $q$),
  'rows:1', 'admin: le altre colonne di una scheda collegata restano modificabili');
select is(
  pg_temp.outcome($q$ update public.barbers set profile_id = 'd3000000-0000-4000-8000-000000001603'
                       where id = 'db000000-0000-4000-8000-000000001602' $q$),
  'rows:1', 'admin: una scheda libera si collega');
select is(
  pg_temp.outcome($q$ update public.barbers set profile_id = null
                       where id = 'db000000-0000-4000-8000-000000001601' $q$),
  'rows:1', 'admin: una scheda collegata si scollega');
select is(
  pg_temp.outcome($q$ update public.barbers set profile_id = 'd3000000-0000-4000-8000-000000001602'
                       where id = 'db000000-0000-4000-8000-000000001601' $q$),
  'rows:1', 'admin: dopo lo scollegamento la scheda si ricollega');

-- ===========================================================================
-- 2. Tetti massimi delle impostazioni
-- ===========================================================================
select is(
  pg_temp.outcome($q$ update public.shop_settings set min_advance_min = 10080, cancel_limit_min = 10080,
                         max_horizon_days = 365, buffer_min = 60, no_show_block_threshold = 10 $q$),
  'rows:1', 'admin: i valori massimi sono ammessi');
select is(pg_temp.outcome($q$ update public.shop_settings set min_advance_min = 10081 $q$),
  '23514', 'admin: anticipo minimo oltre 7 giorni rifiutato');
select is(pg_temp.outcome($q$ update public.shop_settings set cancel_limit_min = 10081 $q$),
  '23514', 'admin: limite di cancellazione oltre 7 giorni rifiutato');
select is(pg_temp.outcome($q$ update public.shop_settings set max_horizon_days = 366 $q$),
  '23514', 'admin: orizzonte oltre 365 giorni rifiutato');
select is(pg_temp.outcome($q$ update public.shop_settings set buffer_min = 61 $q$),
  '23514', 'admin: buffer oltre 60 minuti rifiutato');
select is(pg_temp.outcome($q$ update public.shop_settings set no_show_block_threshold = 11 $q$),
  '23514', 'admin: soglia no-show oltre 10 rifiutata');
select is(pg_temp.outcome($q$ update public.shop_settings set min_advance_min = -1 $q$),
  '23514', 'admin: anticipo negativo ancora rifiutato');
select is(pg_temp.outcome($q$ update public.shop_settings set max_horizon_days = 0 $q$),
  '23514', 'admin: orizzonte zero ancora rifiutato');
select is(pg_temp.outcome($q$ update public.shop_settings set no_show_block_threshold = 0 $q$),
  'rows:1', 'admin: soglia no-show 0 (disattivata) ammessa');

select pg_temp.act_as_postgres();
select is(
  (select row(min_advance_min, cancel_limit_min, max_horizon_days, buffer_min, no_show_block_threshold)::text
     from public.shop_settings),
  row(10080, 10080, 365, 60, 0)::text,
  'i valori rifiutati non hanno modificato le impostazioni');

select * from finish();
rollback;
