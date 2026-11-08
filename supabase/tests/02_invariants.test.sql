-- Fetta 8h: modifica approvata dall'utente il 2026-11-08 (amr password nei claim staff / nome della RPC), nessuna asserzione cambiata.
-- Test di accettazione – FETTA 1 (SPEC §11: "Schema DB + RLS + seed dati demo").
-- 02 – Regole invarianti garantite dal database (SPEC §3.7) e casi limite (SPEC §12).
-- Eseguito come postgres (proprietario delle tabelle, senza JWT), tranne i cambi di stato che
-- sono fatti da un admin: qui si verificano vincoli e trigger, non le policy. I dati sono creati dal test e annullati dal rollback.
-- Non modificare durante l'implementazione.
begin;
create extension if not exists pgtap with schema extensions;

select plan(77);

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

-- Crea un utente in auth.users (il trigger di registrazione crea il profilo) e ne imposta ruolo e dati.
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
-- Dati di base
-- ---------------------------------------------------------------------------
select pg_temp.mk_user('c0000000-0000-4000-8000-000000000201', 'inv-c1@qa.test', 'customer', 'Inv Cliente Uno', '+390200000001');
select pg_temp.mk_user('c0000000-0000-4000-8000-000000000202', 'inv-c2@qa.test', 'customer', 'Inv Cliente Due', '+390200000002');
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000201', 'inv-admin@qa.test', 'admin', 'Inv Titolare', '+390200000009');

insert into public.shop_settings (name) values ('QA shop') on conflict do nothing;
update public.shop_settings set buffer_min = 0;

insert into public.services (id, name, description, duration_min, price_cents, is_active, sort_order) values
  ('5e000000-0000-4000-8000-000000000201', 'Inv Taglio', null, 30, 2500, true, 901),
  ('5e000000-0000-4000-8000-000000000202', 'Inv Barba', null, 20, 1500, true, 902),
  ('5e000000-0000-4000-8000-000000000203', 'Inv Non abilitato', null, 45, 4000, true, 903),
  ('5e000000-0000-4000-8000-000000000204', 'Inv Senza prenotazioni', null, 15, 1000, true, 904);

insert into public.barbers (id, display_name, is_active) values
  ('ba000000-0000-4000-8000-000000000201', 'Inv Barbiere Uno', true),
  ('ba000000-0000-4000-8000-000000000202', 'Inv Barbiere Due', true);

insert into public.barber_services (barber_id, service_id) values
  ('ba000000-0000-4000-8000-000000000201', '5e000000-0000-4000-8000-000000000201'),
  ('ba000000-0000-4000-8000-000000000201', '5e000000-0000-4000-8000-000000000202'),
  ('ba000000-0000-4000-8000-000000000202', '5e000000-0000-4000-8000-000000000201');

-- ---------------------------------------------------------------------------
-- SPEC §3.1: shop_settings è una riga singola, con parametri non negativi
-- ---------------------------------------------------------------------------
select throws_ok(
  $q$ insert into public.shop_settings (name) values ('Secondo negozio') $q$,
  null, null, 'SPEC §3.1: un secondo insert in shop_settings fallisce (riga singola)');
select is((select count(*) from public.shop_settings), 1::bigint,
  'SPEC §3.1: shop_settings contiene esattamente una riga');
select throws_ok($q$ update public.shop_settings set slot_granularity_min = 0 $q$, '23514', null,
  'SPEC §3.1: slot_granularity_min deve essere > 0');
select throws_ok($q$ update public.shop_settings set min_advance_min = -1 $q$, '23514', null,
  'SPEC §3.1: min_advance_min >= 0');
select throws_ok($q$ update public.shop_settings set max_horizon_days = -1 $q$, '23514', null,
  'SPEC §3.1: max_horizon_days >= 0');
select throws_ok($q$ update public.shop_settings set cancel_limit_min = -1 $q$, '23514', null,
  'SPEC §3.1: cancel_limit_min >= 0');
select throws_ok($q$ update public.shop_settings set buffer_min = -1 $q$, '23514', null,
  'SPEC §3.1: buffer_min >= 0');
select throws_ok($q$ update public.shop_settings set no_show_block_threshold = -1 $q$, '23514', null,
  'SPEC §3.1: no_show_block_threshold >= 0');
select lives_ok($q$ update public.shop_settings set no_show_block_threshold = 0 $q$,
  'SPEC §3.1: no_show_block_threshold = 0 è ammesso (blocco disattivato)');

-- ---------------------------------------------------------------------------
-- SPEC §3.2: servizi
-- ---------------------------------------------------------------------------
select throws_ok(
  $q$ insert into public.services (name, duration_min, price_cents, is_active, sort_order)
      values ('Inv durata zero', 0, 1000, true, 990) $q$,
  '23514', null, 'SPEC §3.2: duration_min deve essere > 0');
select throws_ok(
  $q$ insert into public.services (name, duration_min, price_cents, is_active, sort_order)
      values ('Inv prezzo negativo', 30, -1, true, 991) $q$,
  '23514', null, 'SPEC §3.2: price_cents deve essere >= 0');
select lives_ok(
  $q$ insert into public.services (name, duration_min, price_cents, is_active, sort_order)
      values ('Inv gratuito', 30, 0, true, 992) $q$,
  'SPEC §3.2: price_cents = 0 è ammesso');

-- ---------------------------------------------------------------------------
-- SPEC §3.4: orari di lavoro, una o più fasce non sovrapposte per barbiere/giorno
-- ---------------------------------------------------------------------------
select lives_ok(
  $q$ insert into public.working_hours (barber_id, weekday, start_time, end_time)
      values ('ba000000-0000-4000-8000-000000000201', 1, '09:00', '13:00') $q$,
  'SPEC §3.4: prima fascia del lunedì (weekday 1)');
select lives_ok(
  $q$ insert into public.working_hours (barber_id, weekday, start_time, end_time)
      values ('ba000000-0000-4000-8000-000000000201', 1, '15:00', '19:30') $q$,
  'SPEC §3.4: seconda fascia nello stesso giorno (più fasce ammesse)');
select lives_ok(
  $q$ insert into public.working_hours (barber_id, weekday, start_time, end_time)
      values ('ba000000-0000-4000-8000-000000000201', 1, '13:00', '15:00') $q$,
  'SPEC §3.4: fasce adiacenti (fine 13:00 / inizio 13:00) ammesse');
select throws_ok(
  $q$ insert into public.working_hours (barber_id, weekday, start_time, end_time)
      values ('ba000000-0000-4000-8000-000000000201', 1, '12:00', '14:00') $q$,
  '23P01', null, 'SPEC §3.4: fasce sovrapposte dello stesso barbiere/giorno rifiutate');
select lives_ok(
  $q$ insert into public.working_hours (barber_id, weekday, start_time, end_time)
      values ('ba000000-0000-4000-8000-000000000201', 2, '09:00', '13:00') $q$,
  'SPEC §3.4: stessa fascia in un altro giorno ammessa');
select lives_ok(
  $q$ insert into public.working_hours (barber_id, weekday, start_time, end_time)
      values ('ba000000-0000-4000-8000-000000000202', 1, '09:00', '13:00') $q$,
  'SPEC §3.4: stessa fascia per un altro barbiere ammessa');
select lives_ok(
  $q$ insert into public.working_hours (barber_id, weekday, start_time, end_time)
      values ('ba000000-0000-4000-8000-000000000201', 7, '09:00', '13:00') $q$,
  'SPEC §3.4: weekday 7 (domenica, ISO) ammesso');
select throws_ok(
  $q$ insert into public.working_hours (barber_id, weekday, start_time, end_time)
      values ('ba000000-0000-4000-8000-000000000201', 0, '09:00', '13:00') $q$,
  '23514', null, 'SPEC §3.4: weekday 0 rifiutato (ISO 1..7)');
select throws_ok(
  $q$ insert into public.working_hours (barber_id, weekday, start_time, end_time)
      values ('ba000000-0000-4000-8000-000000000201', 8, '09:00', '13:00') $q$,
  '23514', null, 'SPEC §3.4: weekday 8 rifiutato (ISO 1..7)');
select throws_ok(
  $q$ insert into public.working_hours (barber_id, weekday, start_time, end_time)
      values ('ba000000-0000-4000-8000-000000000201', 3, '13:00', '09:00') $q$,
  '23514', null, 'SPEC §3.4: start_time deve precedere end_time');
select throws_ok(
  $q$ insert into public.working_hours (barber_id, weekday, start_time, end_time)
      values ('ba000000-0000-4000-8000-000000000201', 3, '09:00', '09:00') $q$,
  '23514', null, 'SPEC §3.4: fascia di durata zero rifiutata');

-- ---------------------------------------------------------------------------
-- SPEC §3.5: assenze e chiusure
-- ---------------------------------------------------------------------------
select lives_ok(
  $q$ insert into public.time_off (barber_id, starts_at, ends_at, reason)
      values ('ba000000-0000-4000-8000-000000000201', '2040-02-04 10:00+01', '2040-02-04 11:30+01', 'permesso') $q$,
  'SPEC §3.5 / §12: assenza parziale nella giornata ammessa');
select throws_ok(
  $q$ insert into public.time_off (barber_id, starts_at, ends_at, reason)
      values ('ba000000-0000-4000-8000-000000000201', '2040-02-05 11:00+01', '2040-02-05 11:00+01', 'x') $q$,
  '23514', null, 'SPEC §3.5: time_off richiede starts_at < ends_at');
select lives_ok(
  $q$ insert into public.shop_closures (starts_at, ends_at, reason)
      values ('2040-12-25 00:00+01', '2040-12-27 00:00+01', 'Natale') $q$,
  'SPEC §3.5: chiusura del negozio ammessa');
select throws_ok(
  $q$ insert into public.shop_closures (starts_at, ends_at, reason)
      values ('2040-12-27 00:00+01', '2040-12-25 00:00+01', 'x') $q$,
  '23514', null, 'SPEC §3.5: shop_closures richiede starts_at < ends_at');

-- ---------------------------------------------------------------------------
-- SPEC §3.6: durata e prezzo copiati sulla prenotazione, valori del client ignorati
-- ---------------------------------------------------------------------------
select lives_ok(
  $q$ insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, source)
      values ('b00c0000-0000-4000-8000-000000000201', 'c0000000-0000-4000-8000-000000000201',
              'ba000000-0000-4000-8000-000000000201', '5e000000-0000-4000-8000-000000000201',
              '2040-01-07 09:00+01', 'online') $q$,
  'SPEC §3.6: insert con i soli campi essenziali (il resto lo calcola il trigger)');
select is(
  (select row(status, duration_min, price_cents, buffer_min, ends_at, blocked_until)::text
     from public.bookings where id = 'b00c0000-0000-4000-8000-000000000201'),
  row('confirmed'::public.booking_status, 30, 2500, 0,
      '2040-01-07 09:30+01'::timestamptz, '2040-01-07 09:30+01'::timestamptz)::text,
  'SPEC §3.6: status confirmed, durata/prezzo dal servizio, ends_at = starts_at + durata, blocked_until = ends_at + buffer');

select lives_ok(
  $q$ insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, source,
                                   ends_at, duration_min, price_cents, buffer_min, blocked_until)
      values ('b00c0000-0000-4000-8000-000000000202', 'c0000000-0000-4000-8000-000000000201',
              'ba000000-0000-4000-8000-000000000201', '5e000000-0000-4000-8000-000000000202',
              '2040-01-07 11:00+01', 'online',
              '2040-01-07 11:01+01', 1, 1, 999, '2040-01-07 11:02+01') $q$,
  'SPEC §3.6: insert con ends_at/durata/prezzo/buffer falsi accettato...');
select is(
  (select row(duration_min, price_cents, buffer_min, ends_at, blocked_until)::text
     from public.bookings where id = 'b00c0000-0000-4000-8000-000000000202'),
  row(20, 1500, 0, '2040-01-07 11:20+01'::timestamptz, '2040-01-07 11:20+01'::timestamptz)::text,
  'SPEC §3.6: ...ma i valori passati dal client sono sovrascritti con quelli del servizio');

-- Modifiche successive al servizio non toccano le prenotazioni esistenti
update public.services set price_cents = 9900, duration_min = 60
 where id = '5e000000-0000-4000-8000-000000000201';
select is(
  (select row(duration_min, price_cents, ends_at)::text
     from public.bookings where id = 'b00c0000-0000-4000-8000-000000000201'),
  row(30, 2500, '2040-01-07 09:30+01'::timestamptz)::text,
  'SPEC §3.6: cambiare prezzo/durata del servizio non modifica le prenotazioni esistenti');
update public.services set price_cents = 2500, duration_min = 30
 where id = '5e000000-0000-4000-8000-000000000201';

-- ---------------------------------------------------------------------------
-- SPEC §3.7.1 / §12: nessuna sovrapposizione di prenotazioni confirmed dello stesso barbiere
-- (b...201 occupa 09:00–09:30 del 2040-01-07 per il barbiere 1)
-- ---------------------------------------------------------------------------
select throws_ok(
  $q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
      values ('c0000000-0000-4000-8000-000000000202', 'ba000000-0000-4000-8000-000000000201',
              '5e000000-0000-4000-8000-000000000201', '2040-01-07 09:00+01', 'online') $q$,
  '23P01', null, 'SPEC §12: due prenotazioni sullo stesso slot → la seconda è rifiutata (23P01)');
select throws_ok(
  $q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
      values ('c0000000-0000-4000-8000-000000000202', 'ba000000-0000-4000-8000-000000000201',
              '5e000000-0000-4000-8000-000000000201', '2040-01-07 09:15+01', 'online') $q$,
  '23P01', null, 'SPEC §3.7.1: sovrapposizione parziale (inizio dentro un''altra) rifiutata');
select throws_ok(
  $q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
      values ('c0000000-0000-4000-8000-000000000202', 'ba000000-0000-4000-8000-000000000201',
              '5e000000-0000-4000-8000-000000000201', '2040-01-07 08:45+01', 'online') $q$,
  '23P01', null, 'SPEC §3.7.1: sovrapposizione parziale (fine dentro un''altra) rifiutata');
select throws_ok(
  $q$ insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, source)
      values ('Inv Ospite', '+390200000099', 'ba000000-0000-4000-8000-000000000201',
              '5e000000-0000-4000-8000-000000000201', '2040-01-07 09:00+01', 'manual') $q$,
  '23P01', null, 'SPEC §3.7.5: anche le prenotazioni manuali non possono sovrapporsi');
select lives_ok(
  $q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
      values ('c0000000-0000-4000-8000-000000000202', 'ba000000-0000-4000-8000-000000000201',
              '5e000000-0000-4000-8000-000000000201', '2040-01-07 09:30+01', 'online') $q$,
  'SPEC §3.7.1: con buffer 0 la prenotazione adiacente (inizio = fine dell''altra) è ammessa');
select lives_ok(
  $q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
      values ('c0000000-0000-4000-8000-000000000202', 'ba000000-0000-4000-8000-000000000201',
              '5e000000-0000-4000-8000-000000000201', '2040-01-07 08:30+01', 'online') $q$,
  'SPEC §3.7.1: con buffer 0 la prenotazione che finisce all''inizio dell''altra è ammessa');
select lives_ok(
  $q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
      values ('c0000000-0000-4000-8000-000000000202', 'ba000000-0000-4000-8000-000000000202',
              '5e000000-0000-4000-8000-000000000201', '2040-01-07 09:00+01', 'online') $q$,
  'SPEC §3.7.1: stesso orario con un altro barbiere ammesso');

-- ---------------------------------------------------------------------------
-- SPEC §3.6 / §6.7: cambi di stato (eseguiti dall'admin) e contatore no-show.
-- completed e no_show sono ammessi solo per prenotazioni già iniziate: si usa un giorno passato
-- (2024-01-08), una prenotazione per ciascuno stato finale.
-- ---------------------------------------------------------------------------
insert into public.bookings (id, customer_id, guest_name, guest_phone, barber_id, service_id, starts_at, source) values
  ('b00c0000-0000-4000-8000-000000000211', 'c0000000-0000-4000-8000-000000000201', null, null, 'ba000000-0000-4000-8000-000000000201', '5e000000-0000-4000-8000-000000000201', '2024-01-08 09:00+01', 'online'),
  ('b00c0000-0000-4000-8000-000000000212', 'c0000000-0000-4000-8000-000000000201', null, null, 'ba000000-0000-4000-8000-000000000201', '5e000000-0000-4000-8000-000000000201', '2024-01-08 10:00+01', 'online'),
  ('b00c0000-0000-4000-8000-000000000213', 'c0000000-0000-4000-8000-000000000201', null, null, 'ba000000-0000-4000-8000-000000000201', '5e000000-0000-4000-8000-000000000201', '2024-01-08 11:00+01', 'online'),
  ('b00c0000-0000-4000-8000-000000000214', 'c0000000-0000-4000-8000-000000000201', null, null, 'ba000000-0000-4000-8000-000000000201', '5e000000-0000-4000-8000-000000000201', '2024-01-08 12:00+01', 'online'),
  ('b00c0000-0000-4000-8000-000000000215', null, 'Inv Ospite', '+390200000099', 'ba000000-0000-4000-8000-000000000201', '5e000000-0000-4000-8000-000000000201', '2024-01-08 15:00+01', 'manual');

select is((select no_show_count from public.profiles where id = 'c0000000-0000-4000-8000-000000000201'),
  0, 'SPEC §6.7: no_show_count parte da 0');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'a0000000-0000-4000-8000-000000000201', 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'password')))::text, true);

select is(
  pg_temp.outcome($q$ update public.bookings set status = 'cancelled_by_customer' where id = 'b00c0000-0000-4000-8000-000000000211' $q$),
  'rows:1', 'SPEC §3.6: confirmed → cancelled_by_customer');
select is(
  pg_temp.outcome($q$ update public.bookings set status = 'cancelled_by_shop' where id = 'b00c0000-0000-4000-8000-000000000212' $q$),
  'rows:1', 'SPEC §3.6: confirmed → cancelled_by_shop');
select is(
  pg_temp.outcome($q$ update public.bookings set status = 'completed' where id = 'b00c0000-0000-4000-8000-000000000213' $q$),
  'rows:1', 'SPEC §3.6: confirmed → completed su una prenotazione già iniziata');
select is((select no_show_count from public.profiles where id = 'c0000000-0000-4000-8000-000000000201'),
  0, 'SPEC §6.7: il passaggio a completed non incrementa no_show_count');
select is(
  pg_temp.outcome($q$ update public.bookings set status = 'no_show' where id = 'b00c0000-0000-4000-8000-000000000214' $q$),
  'rows:1', 'SPEC §3.6: confirmed → no_show su una prenotazione già iniziata');
select is((select no_show_count from public.profiles where id = 'c0000000-0000-4000-8000-000000000201'),
  1, 'SPEC §6.7: il passaggio a no_show incrementa no_show_count del cliente');
select is(
  pg_temp.outcome($q$ update public.bookings set notes = 'non si è presentato' where id = 'b00c0000-0000-4000-8000-000000000214' $q$),
  'rows:1', 'SPEC §3.6: aggiornare le note di una prenotazione no_show');
select is((select no_show_count from public.profiles where id = 'c0000000-0000-4000-8000-000000000201'),
  1, 'SPEC §6.7: aggiornare una prenotazione già no_show non incrementa di nuovo il contatore');
select is((select no_show_count from public.profiles where id = 'c0000000-0000-4000-8000-000000000202'),
  0, 'SPEC §6.7: il contatore degli altri clienti non cambia');
select is(
  pg_temp.outcome($q$ update public.bookings set status = 'no_show' where id = 'b00c0000-0000-4000-8000-000000000215' $q$),
  'rows:1', 'SPEC §6.7: no_show su una prenotazione senza cliente registrato non dà errore');

reset role;

-- SPEC §3.7.1: solo le prenotazioni confirmed occupano lo slot
select lives_ok(
  $q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
      values ('c0000000-0000-4000-8000-000000000202', 'ba000000-0000-4000-8000-000000000201',
              '5e000000-0000-4000-8000-000000000201', '2024-01-08 09:00+01', 'manual') $q$,
  'SPEC §3.7.1: lo slot di una prenotazione cancelled_by_customer è di nuovo prenotabile');
select lives_ok(
  $q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
      values ('c0000000-0000-4000-8000-000000000202', 'ba000000-0000-4000-8000-000000000201',
              '5e000000-0000-4000-8000-000000000201', '2024-01-08 10:00+01', 'manual') $q$,
  'SPEC §3.7.1: lo slot di una prenotazione cancelled_by_shop è di nuovo prenotabile');
select lives_ok(
  $q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
      values ('c0000000-0000-4000-8000-000000000202', 'ba000000-0000-4000-8000-000000000201',
              '5e000000-0000-4000-8000-000000000201', '2024-01-08 11:00+01', 'manual') $q$,
  'SPEC §3.7.1: una prenotazione completed non blocca il vincolo di esclusione');
select lives_ok(
  $q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
      values ('c0000000-0000-4000-8000-000000000202', 'ba000000-0000-4000-8000-000000000201',
              '5e000000-0000-4000-8000-000000000201', '2024-01-08 12:00+01', 'manual') $q$,
  'SPEC §3.7.1: lo slot di una prenotazione no_show è di nuovo prenotabile');

-- SPEC §3.6: nominativo e telefono dell'ospite non possono essere azzerati dopo l'inserimento
select matches(
  pg_temp.outcome($q$ update public.bookings set guest_name = null where id = 'b00c0000-0000-4000-8000-000000000215' $q$),
  '^(23514|P0001)$', 'SPEC §3.6: azzerare guest_name su una prenotazione senza cliente è rifiutato');
select matches(
  pg_temp.outcome($q$ update public.bookings set guest_phone = null where id = 'b00c0000-0000-4000-8000-000000000215' $q$),
  '^(23514|P0001)$', 'SPEC §3.6: azzerare guest_phone su una prenotazione senza cliente è rifiutato');
select matches(
  pg_temp.outcome($q$ update public.bookings set guest_name = null, guest_phone = null where id = 'b00c0000-0000-4000-8000-000000000215' $q$),
  '^(23514|P0001)$', 'SPEC §3.6: azzerare nominativo e telefono su una prenotazione senza cliente è rifiutato');
select is(
  (select row(guest_name, guest_phone)::text from public.bookings where id = 'b00c0000-0000-4000-8000-000000000215'),
  row('Inv Ospite'::text, '+390200000099'::text)::text,
  'SPEC §3.6: nominativo e telefono dell''ospite invariati');

-- ---------------------------------------------------------------------------
-- SPEC §12: buffer > 0 tra appuntamenti consecutivi (2040-01-09, buffer 10')
-- ---------------------------------------------------------------------------
update public.shop_settings set buffer_min = 10;
insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, source)
values ('b00c0000-0000-4000-8000-000000000221', 'c0000000-0000-4000-8000-000000000201',
        'ba000000-0000-4000-8000-000000000201', '5e000000-0000-4000-8000-000000000201',
        '2040-01-09 10:00+01', 'online');
select is(
  (select row(buffer_min, ends_at, blocked_until)::text
     from public.bookings where id = 'b00c0000-0000-4000-8000-000000000221'),
  row(10, '2040-01-09 10:30+01'::timestamptz, '2040-01-09 10:40+01'::timestamptz)::text,
  'SPEC §12: con buffer 10 la prenotazione copia buffer_min e blocca fino a ends_at + 10 minuti');
select is(
  (select row(buffer_min, blocked_until)::text
     from public.bookings where id = 'b00c0000-0000-4000-8000-000000000202'),
  row(0, '2040-01-07 11:20+01'::timestamptz)::text,
  'SPEC §3.6: cambiare shop_settings.buffer_min non tocca le prenotazioni esistenti');
select throws_ok(
  $q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
      values ('c0000000-0000-4000-8000-000000000202', 'ba000000-0000-4000-8000-000000000201',
              '5e000000-0000-4000-8000-000000000201', '2040-01-09 10:30+01', 'online') $q$,
  '23P01', null, 'SPEC §12: con buffer > 0 l''appuntamento immediatamente consecutivo è rifiutato');
select throws_ok(
  $q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
      values ('c0000000-0000-4000-8000-000000000202', 'ba000000-0000-4000-8000-000000000201',
              '5e000000-0000-4000-8000-000000000201', '2040-01-09 09:30+01', 'online') $q$,
  '23P01', null, 'SPEC §12: il buffer vale anche per chi prenota subito prima (09:30–10:00 + 10'')');
select lives_ok(
  $q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
      values ('c0000000-0000-4000-8000-000000000202', 'ba000000-0000-4000-8000-000000000201',
              '5e000000-0000-4000-8000-000000000201', '2040-01-09 10:40+01', 'online') $q$,
  'SPEC §12: con buffer > 0 è ammesso l''appuntamento che inizia a ends_at + buffer');
update public.shop_settings set buffer_min = 0;

-- ---------------------------------------------------------------------------
-- SPEC §3.6: cliente registrato OPPURE nominativo + telefono
-- ---------------------------------------------------------------------------
select matches(
  pg_temp.outcome($q$ insert into public.bookings (barber_id, service_id, starts_at, source)
    values ('ba000000-0000-4000-8000-000000000201', '5e000000-0000-4000-8000-000000000201',
            '2040-01-10 09:00+01', 'manual') $q$),
  '^(23514|P0001)$', 'SPEC §3.6: insert senza cliente né nominativo/telefono rifiutato');
select matches(
  pg_temp.outcome($q$ insert into public.bookings (guest_name, barber_id, service_id, starts_at, source)
    values ('Inv Solo Nome', 'ba000000-0000-4000-8000-000000000201', '5e000000-0000-4000-8000-000000000201',
            '2040-01-10 09:00+01', 'manual') $q$),
  '^(23514|P0001)$', 'SPEC §3.6: nominativo senza telefono rifiutato');
select matches(
  pg_temp.outcome($q$ insert into public.bookings (guest_phone, barber_id, service_id, starts_at, source)
    values ('+390200000098', 'ba000000-0000-4000-8000-000000000201', '5e000000-0000-4000-8000-000000000201',
            '2040-01-10 09:00+01', 'manual') $q$),
  '^(23514|P0001)$', 'SPEC §3.6: telefono senza nominativo rifiutato');
select is(
  pg_temp.outcome($q$ insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, source)
    values ('Inv Ospite', '+390200000099', 'ba000000-0000-4000-8000-000000000201', '5e000000-0000-4000-8000-000000000201',
            '2040-01-10 03:00+01', 'manual') $q$),
  'rows:1',
  'SPEC §3.6 / §3.7.5: prenotazione manuale con nominativo + telefono ammessa, anche fuori orario di lavoro');

-- ---------------------------------------------------------------------------
-- SPEC §3.7.3 / §12: barbiere non abilitato al servizio
-- ---------------------------------------------------------------------------
select matches(
  pg_temp.outcome($q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
    values ('c0000000-0000-4000-8000-000000000201', 'ba000000-0000-4000-8000-000000000201',
            '5e000000-0000-4000-8000-000000000203', '2040-01-10 10:00+01', 'online') $q$),
  '^(23514|23503|P0001)$', 'SPEC §3.7.3: prenotazione online con barbiere non abilitato al servizio rifiutata');
select matches(
  pg_temp.outcome($q$ insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, source)
    values ('Inv Ospite', '+390200000099', 'ba000000-0000-4000-8000-000000000201',
            '5e000000-0000-4000-8000-000000000203', '2040-01-10 10:00+01', 'manual') $q$),
  '^(23514|23503|P0001)$', 'SPEC §3.7.3: vale anche per le prenotazioni manuali');

-- ---------------------------------------------------------------------------
-- SPEC §3.2 / §12: servizi e barbieri con prenotazioni
-- ---------------------------------------------------------------------------
select throws_ok(
  $q$ delete from public.services where id = '5e000000-0000-4000-8000-000000000201' $q$,
  '23503', null, 'SPEC §3.2: un servizio con prenotazioni non è eliminabile');
select throws_ok(
  $q$ delete from public.barbers where id = 'ba000000-0000-4000-8000-000000000201' $q$,
  '23503', null, 'SPEC §3.6: un barbiere con prenotazioni non è eliminabile');
select lives_ok(
  $q$ delete from public.services where id = '5e000000-0000-4000-8000-000000000204' $q$,
  'SPEC §3.2: un servizio senza prenotazioni è eliminabile');

select lives_ok(
  $q$ update public.services set is_active = false where id = '5e000000-0000-4000-8000-000000000201' $q$,
  'SPEC §12: un servizio con prenotazioni future può essere disattivato');
select is(
  (select row(status, service_id, duration_min, price_cents)::text
     from public.bookings where id = 'b00c0000-0000-4000-8000-000000000221'),
  row('confirmed'::public.booking_status, '5e000000-0000-4000-8000-000000000201'::uuid, 30, 2500)::text,
  'SPEC §12: le prenotazioni future del servizio disattivato restano intatte');

-- ---------------------------------------------------------------------------
-- SPEC §8: eliminazione dell'account cliente → le prenotazioni restano senza dati personali
-- ---------------------------------------------------------------------------
select lives_ok(
  $q$ delete from auth.users where id = 'c0000000-0000-4000-8000-000000000201' $q$,
  'SPEC §8: l''utente con prenotazioni può essere eliminato');
select is((select count(*) from public.profiles where id = 'c0000000-0000-4000-8000-000000000201'),
  0::bigint, 'SPEC §8: il profilo viene eliminato a cascata');
select is(
  (select row(count(*), count(customer_id))::text from public.bookings
    where id in ('b00c0000-0000-4000-8000-000000000201', 'b00c0000-0000-4000-8000-000000000202',
                 'b00c0000-0000-4000-8000-000000000214', 'b00c0000-0000-4000-8000-000000000221')),
  row(4::bigint, 0::bigint)::text,
  'SPEC §8: le prenotazioni sopravvivono con customer_id NULL');

select * from finish();
rollback;
