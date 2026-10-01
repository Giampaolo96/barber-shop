-- Test di accettazione – FETTA 1 (SPEC §11: "Schema DB + RLS + seed dati demo").
-- 05 – RLS per l'admin (titolare): lettura e scrittura complete, ma mai sovrapposizioni.
-- SPEC §2, §3.7.1, §3.7.5, §6. I dati sono creati dal test (come postgres) e annullati dal rollback.
-- Non modificare durante l'implementazione.
begin;
create extension if not exists pgtap with schema extensions;

select plan(81);

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
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000501', 'adm-admin@qa.test', 'admin', 'Admqa Titolare', '+390500000001');
select pg_temp.mk_user('b0000000-0000-4000-8000-000000000501', 'adm-b1@qa.test', 'barber', 'Admqa Barbiere', '+390500000002');
select pg_temp.mk_user('c0000000-0000-4000-8000-000000000501', 'adm-c1@qa.test', 'customer', 'Admqa Cliente Uno', '+390500000003');
select pg_temp.mk_user('c0000000-0000-4000-8000-000000000502', 'adm-c2@qa.test', 'customer', 'Admqa Cliente Due', '+390500000004');

insert into public.shop_settings (name) values ('QA shop') on conflict do nothing;
update public.shop_settings set buffer_min = 0;

insert into public.services (id, name, description, duration_min, price_cents, is_active, sort_order) values
  ('5e000000-0000-4000-8000-000000000501', 'Adm Taglio', null, 30, 2500, true, 901),
  ('5e000000-0000-4000-8000-000000000502', 'Adm Disattivato', null, 30, 2500, false, 902),
  ('5e000000-0000-4000-8000-000000000504', 'Adm Lungo', null, 45, 4000, true, 904);

insert into public.barbers (id, display_name, is_active, profile_id) values
  ('ba000000-0000-4000-8000-000000000501', 'Adm Uno', true, 'b0000000-0000-4000-8000-000000000501'),
  ('ba000000-0000-4000-8000-000000000502', 'Adm Due', true, null),
  ('ba000000-0000-4000-8000-000000000503', 'Adm Disattivato', false, null);

insert into public.barber_services (barber_id, service_id) values
  ('ba000000-0000-4000-8000-000000000501', '5e000000-0000-4000-8000-000000000501'),
  ('ba000000-0000-4000-8000-000000000502', '5e000000-0000-4000-8000-000000000501'),
-- "Adm Lungo" è abilitato solo per il barbiere 2; il barbiere 3 non è abilitato a nessun servizio
  ('ba000000-0000-4000-8000-000000000502', '5e000000-0000-4000-8000-000000000504');

insert into public.working_hours (id, barber_id, weekday, start_time, end_time) values
  ('a0a00000-0000-4000-8000-000000000501', 'ba000000-0000-4000-8000-000000000501', 1, '09:00', '13:00');
insert into public.time_off (id, barber_id, starts_at, ends_at, reason) values
  ('70ff0000-0000-4000-8000-000000000501', 'ba000000-0000-4000-8000-000000000501', '2040-02-04 10:00+01', '2040-02-04 11:00+01', 'permesso');
insert into public.shop_closures (id, starts_at, ends_at, reason) values
  ('c1050000-0000-4000-8000-000000000501', '2040-12-25 00:00+01', '2040-12-26 00:00+01', 'Natale');

-- 2040-01-07: 501 barbiere 1 09:00 (c1), 502 barbiere 1 10:00 (c2), 503 barbiere 2 11:00 (c2)
insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, source) values
  ('b00c0000-0000-4000-8000-000000000501', 'c0000000-0000-4000-8000-000000000501', 'ba000000-0000-4000-8000-000000000501', '5e000000-0000-4000-8000-000000000501', '2040-01-07 09:00+01', 'online'),
  ('b00c0000-0000-4000-8000-000000000502', 'c0000000-0000-4000-8000-000000000502', 'ba000000-0000-4000-8000-000000000501', '5e000000-0000-4000-8000-000000000501', '2040-01-07 10:00+01', 'online'),
  ('b00c0000-0000-4000-8000-000000000503', 'c0000000-0000-4000-8000-000000000502', 'ba000000-0000-4000-8000-000000000502', '5e000000-0000-4000-8000-000000000501', '2040-01-07 11:00+01', 'online'),
-- passate (2024-01-08), per completed / no_show: 511 e 512 del cliente c1 con il barbiere 1
  ('b00c0000-0000-4000-8000-000000000511', 'c0000000-0000-4000-8000-000000000501', 'ba000000-0000-4000-8000-000000000501', '5e000000-0000-4000-8000-000000000501', '2024-01-08 09:00+01', 'online'),
  ('b00c0000-0000-4000-8000-000000000512', 'c0000000-0000-4000-8000-000000000501', 'ba000000-0000-4000-8000-000000000501', '5e000000-0000-4000-8000-000000000501', '2024-01-08 10:00+01', 'online'),
-- futura (2040-01-09), per i test di ricalcolo in UPDATE: 505 barbiere 1 09:00, buffer 0
  ('b00c0000-0000-4000-8000-000000000505', 'c0000000-0000-4000-8000-000000000501', 'ba000000-0000-4000-8000-000000000501', '5e000000-0000-4000-8000-000000000501', '2040-01-09 09:00+01', 'online');

-- ===========================================================================
-- ADMIN
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-000000000501', 'role', 'authenticated')::text, true);

select is(public.current_user_role()::text, 'admin', 'admin – SPEC §2: current_user_role() = admin');
select is(public.is_admin(), true, 'admin – SPEC §2: is_admin() = true');
select is(public.is_staff(), true, 'admin – SPEC §2: is_staff() = true');

-- ---------------------------------------------------------------------------
-- SPEC §2: l'admin legge tutto
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from public.services
    where id in ('5e000000-0000-4000-8000-000000000501', '5e000000-0000-4000-8000-000000000502')),
  2::bigint, 'admin – SPEC §6.4: vede anche i servizi disattivati');
select is(
  (select count(*) from public.barbers
    where id in ('ba000000-0000-4000-8000-000000000501', 'ba000000-0000-4000-8000-000000000502',
                 'ba000000-0000-4000-8000-000000000503')),
  3::bigint, 'admin – SPEC §6.5: vede anche i barbieri disattivati');
select is(
  (select count(*) from public.bookings
    where id in ('b00c0000-0000-4000-8000-000000000501', 'b00c0000-0000-4000-8000-000000000502',
                 'b00c0000-0000-4000-8000-000000000503')),
  3::bigint, 'admin – SPEC §2: vede tutte le prenotazioni di tutti i barbieri');
select is(
  (select count(*) from public.profiles
    where id in ('a0000000-0000-4000-8000-000000000501', 'b0000000-0000-4000-8000-000000000501',
                 'c0000000-0000-4000-8000-000000000501', 'c0000000-0000-4000-8000-000000000502')),
  4::bigint, 'admin – SPEC §6.7: vede tutti i profili');
select is((select count(*) from public.working_hours where id = 'a0a00000-0000-4000-8000-000000000501'),
  1::bigint, 'admin – SPEC §6.5: vede gli orari di lavoro');
select is((select count(*) from public.time_off where id = '70ff0000-0000-4000-8000-000000000501'),
  1::bigint, 'admin – SPEC §6.5: vede le assenze');
select is((select count(*) from public.shop_closures where id = 'c1050000-0000-4000-8000-000000000501'),
  1::bigint, 'admin – SPEC §6.6: vede le chiusure');
select is((select count(*) from public.search_customers('admqa cliente')), 2::bigint,
  'admin – SPEC §6.2: può usare search_customers');

-- ---------------------------------------------------------------------------
-- SPEC §6.4–§6.8: l'admin scrive su catalogo, orari, assenze, chiusure, impostazioni
-- ---------------------------------------------------------------------------
select is(
  pg_temp.outcome($q$ insert into public.services (id, name, description, duration_min, price_cents, is_active, sort_order)
    values ('5e000000-0000-4000-8000-000000000503', 'Adm Nuovo', 'creato dall''admin', 20, 1800, true, 903) $q$),
  'rows:1', 'admin – SPEC §6.4: inserisce un servizio');
select is(
  pg_temp.outcome($q$ update public.services set price_cents = 2000, is_active = false, sort_order = 1
                       where id = '5e000000-0000-4000-8000-000000000503' $q$),
  'rows:1', 'admin – SPEC §6.4: modifica, riordina e disattiva un servizio');
select is(
  pg_temp.outcome($q$ delete from public.services where id = '5e000000-0000-4000-8000-000000000503' $q$),
  'rows:1', 'admin – SPEC §6.4: elimina un servizio senza prenotazioni');
select is(
  pg_temp.outcome($q$ delete from public.services where id = '5e000000-0000-4000-8000-000000000501' $q$),
  '23503', 'admin – SPEC §3.2: nemmeno l''admin elimina un servizio con prenotazioni (23503)');

select is(
  pg_temp.outcome($q$ insert into public.barbers (id, display_name, is_active, profile_id)
    values ('ba000000-0000-4000-8000-000000000504', 'Adm Titolare al lavoro', true, 'a0000000-0000-4000-8000-000000000501') $q$),
  'rows:1', 'admin – SPEC §2: l''admin è anche barbiere se ha una riga barbers con il suo profile_id');
select is(
  pg_temp.outcome($q$ update public.barbers set is_active = true, bio = 'riattivato' where id = 'ba000000-0000-4000-8000-000000000503' $q$),
  'rows:1', 'admin – SPEC §6.5: modifica un barbiere disattivato');
select is(
  pg_temp.outcome($q$ insert into public.barber_services (barber_id, service_id)
    values ('ba000000-0000-4000-8000-000000000504', '5e000000-0000-4000-8000-000000000501') $q$),
  'rows:1', 'admin – SPEC §6.5: abilita un barbiere a un servizio');
select is(
  pg_temp.outcome($q$ delete from public.barber_services where barber_id = 'ba000000-0000-4000-8000-000000000504' $q$),
  'rows:1', 'admin – SPEC §6.5: rimuove un servizio abilitato');
select is(
  pg_temp.outcome($q$ delete from public.barbers where id = 'ba000000-0000-4000-8000-000000000504' $q$),
  'rows:1', 'admin – SPEC §6.5: elimina un barbiere senza prenotazioni');

select is(
  pg_temp.outcome($q$ insert into public.working_hours (id, barber_id, weekday, start_time, end_time)
    values ('a0a00000-0000-4000-8000-000000000502', 'ba000000-0000-4000-8000-000000000502', 2, '15:00', '19:30') $q$),
  'rows:1', 'admin – SPEC §6.5: inserisce un orario di lavoro');
select is(
  pg_temp.outcome($q$ update public.working_hours set end_time = '19:00' where id = 'a0a00000-0000-4000-8000-000000000502' $q$),
  'rows:1', 'admin – SPEC §6.5: modifica un orario di lavoro');
select is(
  pg_temp.outcome($q$ delete from public.working_hours where id = 'a0a00000-0000-4000-8000-000000000502' $q$),
  'rows:1', 'admin – SPEC §6.5: elimina un orario di lavoro');

select is(
  pg_temp.outcome($q$ insert into public.time_off (id, barber_id, starts_at, ends_at, reason)
    values ('70ff0000-0000-4000-8000-000000000502', 'ba000000-0000-4000-8000-000000000502', '2040-03-04 00:00+01', '2040-03-05 00:00+01', 'malattia') $q$),
  'rows:1', 'admin – SPEC §6.5: inserisce un''assenza per qualsiasi barbiere');
select is(
  pg_temp.outcome($q$ update public.time_off set reason = 'ferie' where id = '70ff0000-0000-4000-8000-000000000501' $q$),
  'rows:1', 'admin – SPEC §6.5: modifica l''assenza di un barbiere');
select is(
  pg_temp.outcome($q$ delete from public.time_off where id = '70ff0000-0000-4000-8000-000000000502' $q$),
  'rows:1', 'admin – SPEC §6.5: elimina un''assenza');

select is(
  pg_temp.outcome($q$ insert into public.shop_closures (id, starts_at, ends_at, reason)
    values ('c1050000-0000-4000-8000-000000000502', '2040-08-12 00:00+02', '2040-08-19 00:00+02', 'ferie collettive') $q$),
  'rows:1', 'admin – SPEC §6.6: inserisce una chiusura');
select is(
  pg_temp.outcome($q$ update public.shop_closures set reason = 'ferie estive' where id = 'c1050000-0000-4000-8000-000000000502' $q$),
  'rows:1', 'admin – SPEC §6.6: modifica una chiusura');
select is(
  pg_temp.outcome($q$ delete from public.shop_closures where id = 'c1050000-0000-4000-8000-000000000502' $q$),
  'rows:1', 'admin – SPEC §6.6: elimina una chiusura');

select is(
  pg_temp.outcome($q$ update public.shop_settings set name = 'Adm negozio', cancel_limit_min = 90, slot_granularity_min = 30 $q$),
  'rows:1', 'admin – SPEC §6.8: modifica le impostazioni del negozio');
select is(
  (select row(name, cancel_limit_min, slot_granularity_min)::text from public.shop_settings),
  row('Adm negozio'::text, 90, 30)::text, 'admin – SPEC §6.8: impostazioni aggiornate');

-- ---------------------------------------------------------------------------
-- SPEC §6.7: clienti – blocco/sblocco e ruoli
-- ---------------------------------------------------------------------------
select is(
  pg_temp.outcome($q$ update public.profiles set is_blocked = true where id = 'c0000000-0000-4000-8000-000000000501' $q$),
  'rows:1', 'admin – SPEC §6.7: blocca un cliente');
select is((select is_blocked from public.profiles where id = 'c0000000-0000-4000-8000-000000000501'),
  true, 'admin – SPEC §6.7: is_blocked aggiornato');
select is(
  pg_temp.outcome($q$ update public.profiles set is_blocked = false where id = 'c0000000-0000-4000-8000-000000000501' $q$),
  'rows:1', 'admin – SPEC §6.7: sblocca un cliente');
select is(
  pg_temp.outcome($q$ update public.profiles set role = 'barber' where id = 'c0000000-0000-4000-8000-000000000502' $q$),
  'rows:1', 'admin – SPEC §2: cambia il ruolo di un altro utente');
select is((select role::text from public.profiles where id = 'c0000000-0000-4000-8000-000000000502'),
  'barber', 'admin – SPEC §2: role aggiornato');
select is(
  pg_temp.outcome($q$ update public.profiles set role = 'customer', full_name = 'Admqa Cliente Due bis' where id = 'c0000000-0000-4000-8000-000000000502' $q$),
  'rows:1', 'admin – SPEC §6.7: modifica i dati di un altro profilo');

-- ---------------------------------------------------------------------------
-- SPEC §6.1–§6.3: prenotazioni
-- ---------------------------------------------------------------------------
select is(
  pg_temp.outcome($q$ insert into public.bookings (id, guest_name, guest_phone, barber_id, service_id, starts_at, source)
    values ('b00c0000-0000-4000-8000-000000000504', 'Adm Ospite', '+390500999001', 'ba000000-0000-4000-8000-000000000502',
            '5e000000-0000-4000-8000-000000000501', '2040-01-07 06:00+01', 'manual') $q$),
  'rows:1', 'admin – SPEC §6.2 / §3.7.5: crea una prenotazione manuale per qualsiasi barbiere, anche fuori orario');
select is(
  pg_temp.outcome($q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
    values ('c0000000-0000-4000-8000-000000000501', 'ba000000-0000-4000-8000-000000000501',
            '5e000000-0000-4000-8000-000000000501', '2040-01-07 10:15+01', 'manual') $q$),
  '23P01', 'admin – SPEC §3.7.5: la prenotazione manuale dell''admin non può sovrapporsi (23P01)');

-- Spostamento (SPEC §6.3). L'admin passa starts_at, ends_at e blocked_until coerenti: il test non
-- dipende dal fatto che un trigger li ricalcoli o meno in UPDATE (punto segnalato come aperto).
select is(
  pg_temp.outcome($q$ update public.bookings
                         set starts_at = '2040-01-07 09:45+01', ends_at = '2040-01-07 10:15+01', blocked_until = '2040-01-07 10:15+01'
                       where id = 'b00c0000-0000-4000-8000-000000000501' $q$),
  '23P01', 'admin – SPEC §6.3: spostare una prenotazione su un orario occupato è rifiutato (23P01)');
select is(
  pg_temp.outcome($q$ update public.bookings
                         set barber_id = 'ba000000-0000-4000-8000-000000000502',
                             starts_at = '2040-01-07 11:00+01', ends_at = '2040-01-07 11:30+01', blocked_until = '2040-01-07 11:30+01'
                       where id = 'b00c0000-0000-4000-8000-000000000501' $q$),
  '23P01', 'admin – SPEC §6.3: spostare una prenotazione su un altro barbiere già occupato è rifiutato (23P01)');
select is(
  (select row(barber_id, starts_at)::text from public.bookings where id = 'b00c0000-0000-4000-8000-000000000501'),
  row('ba000000-0000-4000-8000-000000000501'::uuid, '2040-01-07 09:00+01'::timestamptz)::text,
  'admin – SPEC §6.3: dopo gli spostamenti rifiutati la prenotazione è invariata');
select is(
  pg_temp.outcome($q$ update public.bookings
                         set starts_at = '2040-01-07 15:00+01', ends_at = '2040-01-07 15:30+01', blocked_until = '2040-01-07 15:30+01'
                       where id = 'b00c0000-0000-4000-8000-000000000501' $q$),
  'rows:1', 'admin – SPEC §6.3: sposta una prenotazione su un orario libero');
select is(
  pg_temp.outcome($q$ update public.bookings
                         set barber_id = 'ba000000-0000-4000-8000-000000000502',
                             starts_at = '2040-01-07 16:00+01', ends_at = '2040-01-07 16:30+01', blocked_until = '2040-01-07 16:30+01'
                       where id = 'b00c0000-0000-4000-8000-000000000501' $q$),
  'rows:1', 'admin – SPEC §6.3: sposta una prenotazione su un altro barbiere libero');
select is(
  (select row(barber_id, starts_at, ends_at, blocked_until, status, price_cents, duration_min)::text
     from public.bookings where id = 'b00c0000-0000-4000-8000-000000000501'),
  row('ba000000-0000-4000-8000-000000000502'::uuid, '2040-01-07 16:00+01'::timestamptz,
      '2040-01-07 16:30+01'::timestamptz, '2040-01-07 16:30+01'::timestamptz,
      'confirmed'::public.booking_status, 2500, 30)::text,
  'admin – SPEC §6.3: la prenotazione spostata ha nuovo barbiere e orario, stesso prezzo e durata');

-- ---------------------------------------------------------------------------
-- SPEC §3.6 / §6.3: in UPDATE il trigger ricalcola sempre ends_at e blocked_until (prenotazione 505)
-- ---------------------------------------------------------------------------
select is(
  pg_temp.outcome($q$ update public.bookings set starts_at = '2040-01-09 10:00+01' where id = 'b00c0000-0000-4000-8000-000000000505' $q$),
  'rows:1', 'admin – SPEC §6.3: sposta una prenotazione cambiando solo starts_at');
select is(
  (select row(starts_at, ends_at, blocked_until)::text from public.bookings where id = 'b00c0000-0000-4000-8000-000000000505'),
  row('2040-01-09 10:00+01'::timestamptz, '2040-01-09 10:30+01'::timestamptz, '2040-01-09 10:30+01'::timestamptz)::text,
  'admin – SPEC §6.3: ends_at e blocked_until ricalcolati dal trigger dopo il cambio di starts_at');
select is(
  pg_temp.outcome($q$ update public.bookings
                         set starts_at = '2040-01-09 11:00+01', ends_at = '2040-01-09 23:00+01', blocked_until = '2040-01-09 23:30+01'
                       where id = 'b00c0000-0000-4000-8000-000000000505' $q$),
  'rows:1', 'admin – SPEC §6.3: update con ends_at/blocked_until falsi accettato...');
select is(
  (select row(starts_at, ends_at, blocked_until)::text from public.bookings where id = 'b00c0000-0000-4000-8000-000000000505'),
  row('2040-01-09 11:00+01'::timestamptz, '2040-01-09 11:30+01'::timestamptz, '2040-01-09 11:30+01'::timestamptz)::text,
  'admin – SPEC §6.3: ...ma ends_at e blocked_until passati in update sono sovrascritti');
select is(
  pg_temp.outcome($q$ update public.bookings set ends_at = '2040-01-09 23:00+01' where id = 'b00c0000-0000-4000-8000-000000000505' $q$),
  'rows:1', 'admin – SPEC §3.6: update del solo ends_at accettato...');
select is(
  (select ends_at from public.bookings where id = 'b00c0000-0000-4000-8000-000000000505'),
  '2040-01-09 11:30+01'::timestamptz,
  'admin – SPEC §3.6: ...ma ends_at resta starts_at + duration_min');

-- SPEC §3.7.3: barbiere abilitato al servizio verificato anche in UPDATE
select matches(
  pg_temp.outcome($q$ update public.bookings set barber_id = 'ba000000-0000-4000-8000-000000000503' where id = 'b00c0000-0000-4000-8000-000000000505' $q$),
  '^(23514|23503|P0001)$', 'admin – SPEC §3.7.3: spostamento a un barbiere non abilitato al servizio rifiutato');
select matches(
  pg_temp.outcome($q$ update public.bookings set service_id = '5e000000-0000-4000-8000-000000000504' where id = 'b00c0000-0000-4000-8000-000000000505' $q$),
  '^(23514|23503|P0001)$', 'admin – SPEC §3.7.3: cambio a un servizio non abilitato per quel barbiere rifiutato');
select is(
  (select row(barber_id, service_id, duration_min, price_cents)::text from public.bookings where id = 'b00c0000-0000-4000-8000-000000000505'),
  row('ba000000-0000-4000-8000-000000000501'::uuid, '5e000000-0000-4000-8000-000000000501'::uuid, 30, 2500)::text,
  'admin – SPEC §3.7.3: dopo i tentativi rifiutati barbiere, servizio, durata e prezzo sono invariati');

-- Cambio servizio: durata e prezzo ricopiati dal nuovo servizio, buffer_min resta quello originale
select is(
  pg_temp.outcome($q$ update public.shop_settings set buffer_min = 10 $q$),
  'rows:1', 'admin – SPEC §6.8: porta shop_settings.buffer_min a 10');
select is(
  pg_temp.outcome($q$ update public.bookings
                         set barber_id = 'ba000000-0000-4000-8000-000000000502', service_id = '5e000000-0000-4000-8000-000000000504'
                       where id = 'b00c0000-0000-4000-8000-000000000505' $q$),
  'rows:1', 'admin – SPEC §3.7.3: spostamento verso barbiere e servizio abilitati ammesso');
select is(
  (select row(barber_id, service_id, duration_min, price_cents, buffer_min, starts_at, ends_at, blocked_until)::text
     from public.bookings where id = 'b00c0000-0000-4000-8000-000000000505'),
  row('ba000000-0000-4000-8000-000000000502'::uuid, '5e000000-0000-4000-8000-000000000504'::uuid, 45, 4000, 0,
      '2040-01-09 11:00+01'::timestamptz, '2040-01-09 11:45+01'::timestamptz, '2040-01-09 11:45+01'::timestamptz)::text,
  'admin – SPEC §3.6: cambiando servizio durata e prezzo sono ricopiati, ends_at/blocked_until ricalcolati, buffer_min resta quello originale');
select is(
  pg_temp.outcome($q$ update public.shop_settings set buffer_min = 0 $q$),
  'rows:1', 'admin – SPEC §6.8: riporta shop_settings.buffer_min a 0');

-- ---------------------------------------------------------------------------
-- SPEC §3.6: cambi di stato dell'admin
-- ---------------------------------------------------------------------------

-- completed e no_show solo su prenotazioni già iniziate, anche per l'admin (501 è futura)
select matches(
  pg_temp.outcome($q$ update public.bookings set status = 'completed' where id = 'b00c0000-0000-4000-8000-000000000501' $q$),
  '^(42501|P0001|23514)$', 'admin – SPEC §3.6: completed rifiutato su una prenotazione futura');
select matches(
  pg_temp.outcome($q$ update public.bookings set status = 'no_show' where id = 'b00c0000-0000-4000-8000-000000000501' $q$),
  '^(42501|P0001|23514)$', 'admin – SPEC §3.6: no_show rifiutato su una prenotazione futura');
select is((select status::text from public.bookings where id = 'b00c0000-0000-4000-8000-000000000501'),
  'confirmed', 'admin – SPEC §3.6: la prenotazione futura resta confirmed');

-- Uscita dagli stati finali: cancelled_by_shop → confirmed con slot libero
select is(
  pg_temp.outcome($q$ update public.bookings set status = 'cancelled_by_shop' where id = 'b00c0000-0000-4000-8000-000000000502' $q$),
  'rows:1', 'admin – SPEC §3.6: confirmed → cancelled_by_shop');
select ok(
  (select status_changed_by = 'a0000000-0000-4000-8000-000000000501' and status_changed_at >= now()
     from public.bookings where id = 'b00c0000-0000-4000-8000-000000000502'),
  'admin – SPEC §3.6: status_changed_by = id dell''admin e status_changed_at valorizzato');
select is(
  pg_temp.outcome($q$ update public.bookings set status = 'confirmed' where id = 'b00c0000-0000-4000-8000-000000000502' $q$),
  'rows:1', 'admin – SPEC §3.6: cancelled_by_shop → confirmed ammesso se lo slot è libero');

-- Ritorno a confirmed con slot nel frattempo occupato (503: barbiere 2, 11:00)
select is(
  pg_temp.outcome($q$ update public.bookings set status = 'cancelled_by_customer' where id = 'b00c0000-0000-4000-8000-000000000503' $q$),
  'rows:1', 'admin – SPEC §3.6: confirmed → cancelled_by_customer');
select is(
  pg_temp.outcome($q$ insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, source)
    values ('Adm Ospite', '+390500999002', 'ba000000-0000-4000-8000-000000000502',
            '5e000000-0000-4000-8000-000000000501', '2040-01-07 11:00+01', 'manual') $q$),
  'rows:1', 'admin – SPEC §3.7.1: lo slot liberato dalla cancellazione viene occupato da un''altra prenotazione');
select is(
  pg_temp.outcome($q$ update public.bookings set status = 'confirmed' where id = 'b00c0000-0000-4000-8000-000000000503' $q$),
  '23P01', 'admin – SPEC §3.7.1: il ritorno a confirmed su uno slot ormai occupato è rifiutato (23P01)');
select is((select status::text from public.bookings where id = 'b00c0000-0000-4000-8000-000000000503'),
  'cancelled_by_customer', 'admin – SPEC §3.7.1: la prenotazione resta cancellata');

-- Contatore no-show simmetrico (511 e 512 sono passate, cliente c1)
select is(
  pg_temp.outcome($q$ update public.bookings set status = 'no_show', notes = 'non si è presentato' where id = 'b00c0000-0000-4000-8000-000000000511' $q$),
  'rows:1', 'admin – SPEC §3.6: confirmed → no_show con nota (prenotazione già iniziata)');
select is((select no_show_count from public.profiles where id = 'c0000000-0000-4000-8000-000000000501'),
  1, 'admin – SPEC §6.7: entrando in no_show il contatore del cliente sale a 1');
select is(
  pg_temp.outcome($q$ update public.bookings set status = 'completed' where id = 'b00c0000-0000-4000-8000-000000000511' $q$),
  'rows:1', 'admin – SPEC §3.6: no_show → completed (correzione di un errore)');
select is((select no_show_count from public.profiles where id = 'c0000000-0000-4000-8000-000000000501'),
  0, 'admin – SPEC §6.7: uscendo da no_show il contatore torna a 0');
select is(
  pg_temp.outcome($q$ update public.bookings set status = 'confirmed' where id = 'b00c0000-0000-4000-8000-000000000511' $q$),
  'rows:1', 'admin – SPEC §3.6: completed → confirmed (uscita da uno stato finale)');
select is((select no_show_count from public.profiles where id = 'c0000000-0000-4000-8000-000000000501'),
  0, 'admin – SPEC §6.7: una transizione che non riguarda no_show non tocca il contatore');

select is(
  pg_temp.outcome($q$ update public.bookings set status = 'no_show' where id = 'b00c0000-0000-4000-8000-000000000512' $q$),
  'rows:1', 'admin – SPEC §3.6: secondo no_show dello stesso cliente');
select is(
  pg_temp.outcome($q$ update public.profiles set no_show_count = 0 where id = 'c0000000-0000-4000-8000-000000000501' $q$),
  '42501', 'admin – SPEC §6.7: nemmeno l''admin modifica direttamente no_show_count (42501)');
select is((select no_show_count from public.profiles where id = 'c0000000-0000-4000-8000-000000000501'),
  1, 'admin – SPEC §6.7: dopo il tentativo rifiutato no_show_count è invariato');

-- Il contatore viene forzato a 0 nel contesto postgres (senza JWT), poi si torna admin
reset role;
select set_config('request.jwt.claims', '', true);
update public.profiles set no_show_count = 0 where id = 'c0000000-0000-4000-8000-000000000501';
select is((select no_show_count from public.profiles where id = 'c0000000-0000-4000-8000-000000000501'),
  0, 'SPEC §6.7: nel contesto postgres senza JWT il contatore si può forzare a 0');
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-000000000501', 'role', 'authenticated')::text, true);
select is(
  pg_temp.outcome($q$ update public.bookings set status = 'completed' where id = 'b00c0000-0000-4000-8000-000000000512' $q$),
  'rows:1', 'admin – SPEC §6.7: uscita da no_show con contatore già a 0, senza errore');
select is((select no_show_count from public.profiles where id = 'c0000000-0000-4000-8000-000000000501'),
  0, 'admin – SPEC §6.7: il contatore non scende mai sotto zero');

select is(
  pg_temp.outcome($q$ delete from public.bookings where id = 'b00c0000-0000-4000-8000-000000000504' $q$),
  'rows:1', 'admin – SPEC §2: elimina una prenotazione');

select * from finish();
rollback;
