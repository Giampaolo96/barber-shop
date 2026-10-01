-- Test di accettazione – FETTA 1 (SPEC §11: "Schema DB + RLS + seed dati demo").
-- 03 – RLS per visitatore anonimo (anon) e cliente (customer). SPEC §2, §3.7.4, §8.
-- I dati sono creati dal test (come postgres) e annullati dal rollback.
-- Non modificare durante l'implementazione.
--
-- Convenzione per gli accessi negati:
--   lettura negata  = zero righe visibili oppure permesso negato (42501);
--   scrittura negata = zero righe toccate, permesso negato (42501), eccezione di un trigger
--                      (P0001) o violazione di check (23514). Qualsiasi altro esito fa fallire il test.
begin;
create extension if not exists pgtap with schema extensions;

select plan(72);

-- Esito di un comando: 'rows:N' se riesce (N righe toccate/restituite), altrimenti lo SQLSTATE.
create function pg_temp.outcome(q text) returns text language plpgsql as $f$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return 'rows:' || n;
exception when others then
  return sqlstate;
end $f$;

create function pg_temp.mk_user(uid uuid, mail text, r text, nm text, ph text)
returns void language plpgsql as $f$
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', mail,
          '{}'::jsonb, '{}'::jsonb, now(), now());
  update public.profiles set role = r::public.user_role, full_name = nm, phone = ph where id = uid;
end $f$;

-- ---------------------------------------------------------------------------
-- Dati di base (come postgres)
-- ---------------------------------------------------------------------------
select pg_temp.mk_user('c0000000-0000-4000-8000-000000000301', 'rls-c1@qa.test', 'customer', 'Rlsqa Cliente Uno', '+390300000001');
select pg_temp.mk_user('c0000000-0000-4000-8000-000000000302', 'rls-c2@qa.test', 'customer', 'Rlsqa Cliente Due', '+390300000002');
select pg_temp.mk_user('b0000000-0000-4000-8000-000000000301', 'rls-b1@qa.test', 'barber', 'Rlsqa Barbiere', '+390300000003');

insert into public.shop_settings (name) values ('QA shop') on conflict do nothing;
update public.shop_settings set buffer_min = 0;

insert into public.services (id, name, description, duration_min, price_cents, is_active, sort_order) values
  ('5e000000-0000-4000-8000-000000000301', 'Rls Attivo', null, 30, 2500, true, 901),
  ('5e000000-0000-4000-8000-000000000302', 'Rls Disattivato', null, 30, 2500, false, 902);

insert into public.barbers (id, display_name, is_active, profile_id) values
  ('ba000000-0000-4000-8000-000000000301', 'Rls Barbiere Attivo', true, 'b0000000-0000-4000-8000-000000000301'),
  ('ba000000-0000-4000-8000-000000000302', 'Rls Barbiere Attivo Due', true, null),
  ('ba000000-0000-4000-8000-000000000303', 'Rls Barbiere Disattivato', false, null);

insert into public.barber_services (barber_id, service_id) values
  ('ba000000-0000-4000-8000-000000000301', '5e000000-0000-4000-8000-000000000301'),
  ('ba000000-0000-4000-8000-000000000302', '5e000000-0000-4000-8000-000000000301');

insert into public.working_hours (barber_id, weekday, start_time, end_time) values
  ('ba000000-0000-4000-8000-000000000301', 1, '09:00', '13:00');
insert into public.time_off (barber_id, starts_at, ends_at, reason) values
  ('ba000000-0000-4000-8000-000000000301', '2040-02-04 10:00+01', '2040-02-04 11:00+01', 'visita medica');
insert into public.shop_closures (starts_at, ends_at, reason) values
  ('2040-12-25 00:00+01', '2040-12-26 00:00+01', 'Natale');

-- c1: una prenotazione. c2: una con lo stesso barbiere (slot adiacente) e una con un altro
-- barbiere allo stesso orario di c1.
insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, source) values
  ('b00c0000-0000-4000-8000-000000000301', 'c0000000-0000-4000-8000-000000000301', 'ba000000-0000-4000-8000-000000000301', '5e000000-0000-4000-8000-000000000301', '2040-01-07 09:00+01', 'online'),
  ('b00c0000-0000-4000-8000-000000000302', 'c0000000-0000-4000-8000-000000000302', 'ba000000-0000-4000-8000-000000000301', '5e000000-0000-4000-8000-000000000301', '2040-01-07 09:30+01', 'online'),
  ('b00c0000-0000-4000-8000-000000000303', 'c0000000-0000-4000-8000-000000000302', 'ba000000-0000-4000-8000-000000000302', '5e000000-0000-4000-8000-000000000301', '2040-01-07 09:00+01', 'online');

-- ===========================================================================
-- ANON
-- ===========================================================================
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

-- SPEC §2 / §5.1: il catalogo è pubblico
select is((select count(*) from public.shop_settings), 1::bigint,
  'anon – SPEC §5.1: legge shop_settings');
select is((select count(*) from public.services where id = '5e000000-0000-4000-8000-000000000301'), 1::bigint,
  'anon – SPEC §3.2: vede i servizi attivi');
select is((select count(*) from public.services where id = '5e000000-0000-4000-8000-000000000302'), 0::bigint,
  'anon – SPEC §3.2: non vede i servizi disattivati');
select is((select count(*) from public.services where not is_active), 0::bigint,
  'anon – SPEC §3.2: nessun servizio disattivato visibile');
select is(
  (select count(*) from public.barbers
    where id in ('ba000000-0000-4000-8000-000000000301', 'ba000000-0000-4000-8000-000000000302')),
  2::bigint, 'anon – SPEC §3.3: vede i barbieri attivi');
select is((select count(*) from public.barbers where not is_active), 0::bigint,
  'anon – SPEC §3.3: non vede i barbieri disattivati');
select is(
  (select count(*) from public.barber_services where service_id = '5e000000-0000-4000-8000-000000000301'),
  2::bigint, 'anon – SPEC §3.3: legge barber_services');

-- SPEC §3.7.4 / §8: nient'altro
select matches(pg_temp.outcome($q$ select 1 from public.profiles $q$), '^(rows:0|42501)$',
  'anon – SPEC §8: nessun profilo visibile');
select matches(pg_temp.outcome($q$ select 1 from public.bookings $q$), '^(rows:0|42501)$',
  'anon – SPEC §3.7.4: nessuna prenotazione visibile');
select matches(pg_temp.outcome($q$ select 1 from public.working_hours $q$), '^(rows:0|42501)$',
  'anon: nessun orario di lavoro visibile');
select matches(pg_temp.outcome($q$ select 1 from public.time_off $q$), '^(rows:0|42501)$',
  'anon: nessuna assenza visibile');
select matches(pg_temp.outcome($q$ select 1 from public.shop_closures $q$), '^(rows:0|42501)$',
  'anon: nessuna chiusura visibile');
select matches(pg_temp.outcome($q$ select * from public.search_customers('rlsqa') $q$), '^(42501|P0001)$',
  'anon – SPEC §3.7.4: search_customers rifiutata');

-- Nessuna scrittura
select matches(pg_temp.outcome($q$ update public.shop_settings set name = 'hacked' $q$),
  '^(rows:0|42501|P0001|23514)$', 'anon: non modifica shop_settings');
select matches(pg_temp.outcome($q$ insert into public.services (name, duration_min, price_cents, is_active, sort_order) values ('Rls anon', 10, 100, true, 999) $q$),
  '^(rows:0|42501|P0001|23514)$', 'anon: non inserisce servizi');
select matches(pg_temp.outcome($q$ update public.services set price_cents = 1 where id = '5e000000-0000-4000-8000-000000000301' $q$),
  '^(rows:0|42501|P0001|23514)$', 'anon: non modifica servizi');
select matches(pg_temp.outcome($q$ delete from public.barber_services where service_id = '5e000000-0000-4000-8000-000000000301' $q$),
  '^(rows:0|42501|P0001|23514)$', 'anon: non elimina barber_services');
select matches(pg_temp.outcome($q$ update public.barbers set display_name = 'hacked' where id = 'ba000000-0000-4000-8000-000000000301' $q$),
  '^(rows:0|42501|P0001|23514)$', 'anon: non modifica barbieri');
select matches(pg_temp.outcome($q$ insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, source) values ('Rls anon', '+390300000099', 'ba000000-0000-4000-8000-000000000301', '5e000000-0000-4000-8000-000000000301', '2040-01-07 15:00+01', 'online') $q$),
  '^(rows:0|42501|P0001|23514)$', 'anon: non inserisce prenotazioni');
select matches(pg_temp.outcome($q$ update public.bookings set status = 'cancelled_by_customer' where id = 'b00c0000-0000-4000-8000-000000000301' $q$),
  '^(rows:0|42501|P0001|23514)$', 'anon: non modifica prenotazioni');
select matches(pg_temp.outcome($q$ update public.profiles set role = 'admin' where id = 'c0000000-0000-4000-8000-000000000301' $q$),
  '^(rows:0|42501|P0001|23514)$', 'anon: non modifica profili');
select matches(pg_temp.outcome($q$ insert into public.shop_closures (starts_at, ends_at, reason) values ('2040-08-01 00:00+02', '2040-08-02 00:00+02', 'anon') $q$),
  '^(rows:0|42501|P0001|23514)$', 'anon: non inserisce chiusure');

reset role;
select is(
  (select row(s.name, sv.price_cents, b.display_name, k.status)::text
     from public.shop_settings s, public.services sv, public.barbers b, public.bookings k
    where sv.id = '5e000000-0000-4000-8000-000000000301'
      and b.id = 'ba000000-0000-4000-8000-000000000301'
      and k.id = 'b00c0000-0000-4000-8000-000000000301'),
  row((select name from public.shop_settings), 2500, 'Rls Barbiere Attivo', 'confirmed'::public.booking_status)::text,
  'anon: dopo i tentativi i dati sono invariati');
select isnt((select name from public.shop_settings), 'hacked', 'anon: shop_settings.name invariato');

-- ===========================================================================
-- CUSTOMER (c1)
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'c0000000-0000-4000-8000-000000000301', 'role', 'authenticated')::text, true);

select is(public.current_user_role()::text, 'customer', 'customer – SPEC §2: current_user_role() = customer');
select is(public.is_admin(), false, 'customer – SPEC §2: is_admin() = false');
select is(public.is_staff(), false, 'customer – SPEC §2: is_staff() = false');

-- Catalogo come anon
select is((select count(*) from public.shop_settings), 1::bigint, 'customer – SPEC §5.1: legge shop_settings');
select is((select count(*) from public.services where id = '5e000000-0000-4000-8000-000000000301'), 1::bigint,
  'customer – SPEC §3.2: vede i servizi attivi');
select is((select count(*) from public.services where not is_active), 0::bigint,
  'customer – SPEC §3.2: non vede i servizi disattivati');
select is(
  (select count(*) from public.barbers
    where id in ('ba000000-0000-4000-8000-000000000301', 'ba000000-0000-4000-8000-000000000302')),
  2::bigint, 'customer – SPEC §3.3: vede i barbieri attivi');
select is((select count(*) from public.barbers where not is_active), 0::bigint,
  'customer – SPEC §3.3: non vede i barbieri disattivati');
select is(
  (select count(*) from public.barber_services where service_id = '5e000000-0000-4000-8000-000000000301'),
  2::bigint, 'customer – SPEC §3.3: legge barber_services');

-- SPEC §2 / §3.7.4: solo il proprio profilo
select is((select array_agg(id::text) from public.profiles),
  array['c0000000-0000-4000-8000-000000000301'],
  'customer – SPEC §3.7.4: vede solo il proprio profilo');
select is(
  pg_temp.outcome($q$ update public.profiles set full_name = 'Rlsqa Nuovo Nome', phone = '+390300000111'
                       where id = 'c0000000-0000-4000-8000-000000000301' $q$),
  'rows:1', 'customer – SPEC §5.4: aggiorna nome e telefono del proprio profilo');
select is(
  (select row(full_name, phone)::text from public.profiles where id = 'c0000000-0000-4000-8000-000000000301'),
  row('Rlsqa Nuovo Nome'::text, '+390300000111'::text)::text,
  'customer – SPEC §5.4: nome e telefono aggiornati');
select throws_ok(
  $q$ update public.profiles set role = 'admin' where id = 'c0000000-0000-4000-8000-000000000301' $q$,
  '42501', null, 'customer – SPEC §2: non può cambiare il proprio role (42501)');
select throws_ok(
  $q$ update public.profiles set is_blocked = false where id = 'c0000000-0000-4000-8000-000000000301' $q$,
  '42501', null, 'customer – SPEC §6.7: non può cambiare il proprio is_blocked (42501)');
select throws_ok(
  $q$ update public.profiles set no_show_count = 0 where id = 'c0000000-0000-4000-8000-000000000301' $q$,
  '42501', null, 'customer – SPEC §6.7: non può cambiare il proprio no_show_count (42501)');
select matches(
  pg_temp.outcome($q$ update public.profiles set full_name = 'hacked' where id = 'c0000000-0000-4000-8000-000000000302' $q$),
  '^(rows:0|42501)$', 'customer – SPEC §3.7.4: non può aggiornare il profilo altrui');
select matches(
  pg_temp.outcome($q$ update public.profiles set full_name = 'hacked' $q$),
  '^rows:1$', 'customer – SPEC §3.7.4: un update senza filtro tocca solo il proprio profilo');

-- SPEC §3.7.4: solo le proprie prenotazioni
select is((select array_agg(id::text) from public.bookings),
  array['b00c0000-0000-4000-8000-000000000301'],
  'customer – SPEC §3.7.4: vede solo le proprie prenotazioni');
select is(
  (select count(*) from public.bookings where barber_id = 'ba000000-0000-4000-8000-000000000301'),
  1::bigint, 'customer – SPEC §3.7.4: non vede la prenotazione altrui con lo stesso barbiere');
select is(
  (select count(*) from public.bookings where starts_at = '2040-01-07 09:00+01'),
  1::bigint, 'customer – SPEC §3.7.4: non vede la prenotazione altrui allo stesso orario');

-- Nessuna scrittura diretta su bookings (arriverà nella fetta 5 tramite funzioni)
select matches(
  pg_temp.outcome($q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
    values ('c0000000-0000-4000-8000-000000000301', 'ba000000-0000-4000-8000-000000000301',
            '5e000000-0000-4000-8000-000000000301', '2040-01-07 16:00+01', 'online') $q$),
  '^(42501|P0001)$', 'customer – SPEC §3.7.2: nessun insert diretto su bookings, nemmeno per sé');
select matches(
  pg_temp.outcome($q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
    values ('c0000000-0000-4000-8000-000000000302', 'ba000000-0000-4000-8000-000000000301',
            '5e000000-0000-4000-8000-000000000301', '2040-01-07 17:00+01', 'manual') $q$),
  '^(42501|P0001)$', 'customer – SPEC §3.7.4: nessun insert su bookings a nome di altri');
select matches(
  pg_temp.outcome($q$ update public.bookings set status = 'cancelled_by_customer' where id = 'b00c0000-0000-4000-8000-000000000301' $q$),
  '^(rows:0|42501|P0001|23514)$', 'customer: nessun update diretto della propria prenotazione (stato)');
select matches(
  pg_temp.outcome($q$ update public.bookings set price_cents = 0 where id = 'b00c0000-0000-4000-8000-000000000301' $q$),
  '^(rows:0|42501|P0001|23514)$', 'customer: nessun update diretto della propria prenotazione (prezzo)');
select matches(
  pg_temp.outcome($q$ update public.bookings set notes = 'x' where id = 'b00c0000-0000-4000-8000-000000000302' $q$),
  '^(rows:0|42501|P0001|23514)$', 'customer – SPEC §3.7.4: nessun update sulle prenotazioni altrui');
select matches(
  pg_temp.outcome($q$ delete from public.bookings where id = 'b00c0000-0000-4000-8000-000000000301' $q$),
  '^(rows:0|42501|P0001|23514)$', 'customer: nessun delete diretto della propria prenotazione');
select matches(
  pg_temp.outcome($q$ delete from public.bookings $q$),
  '^(rows:0|42501|P0001|23514)$', 'customer: nessun delete su bookings');

-- Nessun accesso a orari, assenze, chiusure
select matches(pg_temp.outcome($q$ select 1 from public.working_hours $q$), '^(rows:0|42501)$',
  'customer: nessun orario di lavoro visibile');
select matches(pg_temp.outcome($q$ select 1 from public.time_off $q$), '^(rows:0|42501)$',
  'customer – SPEC §4: nessuna assenza visibile');
select matches(pg_temp.outcome($q$ select 1 from public.shop_closures $q$), '^(rows:0|42501)$',
  'customer: nessuna chiusura visibile');
select matches(pg_temp.outcome($q$ select * from public.search_customers('rlsqa') $q$), '^(42501|P0001)$',
  'customer – SPEC §3.7.4: search_customers rifiutata');

-- Nessuna scrittura su catalogo, impostazioni, orari, assenze, chiusure
select matches(pg_temp.outcome($q$ update public.shop_settings set name = 'hacked' $q$),
  '^(rows:0|42501|P0001|23514)$', 'customer: non modifica shop_settings');
select matches(pg_temp.outcome($q$ insert into public.services (name, duration_min, price_cents, is_active, sort_order) values ('Rls cust', 10, 100, true, 999) $q$),
  '^(rows:0|42501|P0001|23514)$', 'customer: non inserisce servizi');
select matches(pg_temp.outcome($q$ update public.services set price_cents = 1 where id = '5e000000-0000-4000-8000-000000000301' $q$),
  '^(rows:0|42501|P0001|23514)$', 'customer: non modifica servizi');
select matches(pg_temp.outcome($q$ delete from public.services where id = '5e000000-0000-4000-8000-000000000302' $q$),
  '^(rows:0|42501|P0001|23514)$', 'customer: non elimina servizi');
select matches(pg_temp.outcome($q$ insert into public.barbers (display_name, is_active) values ('Rls cust', true) $q$),
  '^(rows:0|42501|P0001|23514)$', 'customer: non inserisce barbieri');
select matches(pg_temp.outcome($q$ update public.barbers set display_name = 'hacked' where id = 'ba000000-0000-4000-8000-000000000301' $q$),
  '^(rows:0|42501|P0001|23514)$', 'customer: non modifica barbieri');
select matches(pg_temp.outcome($q$ insert into public.barber_services (barber_id, service_id) values ('ba000000-0000-4000-8000-000000000302', '5e000000-0000-4000-8000-000000000302') $q$),
  '^(rows:0|42501|P0001|23514)$', 'customer: non inserisce barber_services');
select matches(pg_temp.outcome($q$ delete from public.barber_services where service_id = '5e000000-0000-4000-8000-000000000301' $q$),
  '^(rows:0|42501|P0001|23514)$', 'customer: non elimina barber_services');
select matches(pg_temp.outcome($q$ insert into public.working_hours (barber_id, weekday, start_time, end_time) values ('ba000000-0000-4000-8000-000000000301', 2, '09:00', '13:00') $q$),
  '^(rows:0|42501|P0001|23514)$', 'customer: non inserisce orari di lavoro');
select matches(pg_temp.outcome($q$ insert into public.time_off (barber_id, starts_at, ends_at, reason) values ('ba000000-0000-4000-8000-000000000301', '2040-03-04 10:00+01', '2040-03-04 11:00+01', 'x') $q$),
  '^(rows:0|42501|P0001|23514)$', 'customer: non inserisce assenze');
select matches(pg_temp.outcome($q$ insert into public.shop_closures (starts_at, ends_at, reason) values ('2040-08-01 00:00+02', '2040-08-02 00:00+02', 'x') $q$),
  '^(rows:0|42501|P0001|23514)$', 'customer: non inserisce chiusure');

-- Verifica finale come postgres: nulla è cambiato oltre a nome/telefono di c1
reset role;
select is(
  (select row(role, is_blocked, no_show_count)::text from public.profiles where id = 'c0000000-0000-4000-8000-000000000301'),
  row('customer'::public.user_role, false, 0)::text,
  'customer: role, is_blocked e no_show_count del proprio profilo invariati');
select is(
  (select full_name from public.profiles where id = 'c0000000-0000-4000-8000-000000000302'),
  'Rlsqa Cliente Due', 'customer: profilo altrui invariato');
select is(
  (select count(*) from public.bookings
    where id in ('b00c0000-0000-4000-8000-000000000301', 'b00c0000-0000-4000-8000-000000000302',
                 'b00c0000-0000-4000-8000-000000000303')
      and status = 'confirmed' and price_cents = 2500 and notes is null),
  3::bigint, 'customer: le prenotazioni sono invariate');
select is(
  (select count(*) from public.bookings
    where barber_id in ('ba000000-0000-4000-8000-000000000301', 'ba000000-0000-4000-8000-000000000302')),
  3::bigint, 'customer/anon: nessuna prenotazione creata');
select is(
  (select row(price_cents, is_active)::text from public.services where id = '5e000000-0000-4000-8000-000000000301'),
  row(2500, true)::text, 'customer: servizio invariato');
select is(
  (select count(*) from public.barber_services where service_id = '5e000000-0000-4000-8000-000000000301'),
  2::bigint, 'customer/anon: barber_services invariato');

select * from finish();
rollback;
