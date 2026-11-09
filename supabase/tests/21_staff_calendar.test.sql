-- Fetta 8h: modifica approvata dall'utente il 2026-11-08 (amr password nei claim staff / nome della RPC), nessuna asserzione cambiata.
-- Test di accettazione – FETTA 6 (SPEC §11: "Calendario admin + prenotazioni manuali + cambi stato").
-- 21 – Vincoli del database per prenotazioni manuali, spostamenti e cambi di stato dello staff.
-- SPEC §2 (ruoli), §3.6 (stati, solo l'admin modifica orario/prezzo/durata), §3.7.1, §3.7.5,
-- §3.7.6, §6.2, §6.3 + decisioni approvate per la fetta 6:
--   decisione 2: vincolo di esclusione bookings_customer_no_overlap su
--     (customer_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
--     where status = 'confirmed' and customer_id is not null; senza buffer. Ospiti e cancellate esclusi.
--     Vale per manuali, spostamenti dell'admin, ripristino a confirmed e online (dove
--     create_online_booking continua a restituire customer_overlap).
--   decisione 3: il barbiere può portare le proprie prenotazioni da confirmed a
--     cancelled_by_customer (oltre a completed, no_show, cancelled_by_shop); continua a non poter
--     spostare, cambiare servizio, prezzo, durata o cliente, né creare per un altro barbiere.
--
-- Esiti delle scritture: 'rows:N' oppure SQLSTATE, seguito da ':<vincolo>' quando l'errore ne
-- nomina uno (es. '23P01:bookings_customer_no_overlap').
-- I dati sono creati dal test e annullati dal rollback. Non modificare durante l'implementazione.
begin;
create extension if not exists pgtap with schema extensions;

select plan(35);

-- ---------------------------------------------------------------------------
-- Helper
-- ---------------------------------------------------------------------------
create function pg_temp.outcome(q text) returns text language plpgsql as $f$
declare n bigint; c text;
begin
  execute q;
  get diagnostics n = row_count;
  return 'rows:' || n;
exception when others then
  get stacked diagnostics c = constraint_name;
  return sqlstate || coalesce(':' || nullif(c, ''), '');
end $f$;

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

create function pg_temp.mk_user(uid uuid, r text, nm text, ph text) returns void language plpgsql as $f$
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'f6-' || uid || '@qa.test', '{}'::jsonb, '{}'::jsonb, now(), now());
  update public.profiles
     set role = r::public.user_role, full_name = nm, phone = ph,
         privacy_policy_version = (select ss.privacy_policy_version from public.shop_settings ss),
         privacy_consent_at = now()
   where id = uid;
end $f$;

-- Giorno per la prenotazione online: almeno dopodomani, mai di domenica
create function pg_temp.d() returns date language sql stable as $f$
  select min(x)::date from generate_series(((now() at time zone 'Europe/Rome')::date + 2)::timestamp,
                                           ((now() at time zone 'Europe/Rome')::date + 4)::timestamp,
                                           interval '1 day') x
   where extract(isodow from x) <> 7
$f$;
create function pg_temp.loc(d date, t text) returns timestamptz language sql stable as $f$
  select (d + t::time) at time zone 'Europe/Rome'
$f$;

-- ---------------------------------------------------------------------------
-- Dati (come postgres)
-- ---------------------------------------------------------------------------
update public.shop_settings
   set timezone = 'Europe/Rome', slot_granularity_min = 15, min_advance_min = 60,
       max_horizon_days = 30, cancel_limit_min = 120, buffer_min = 10, no_show_block_threshold = 3;
delete from public.shop_closures;

select pg_temp.mk_user('a6000000-0000-4000-8000-000000002101', 'admin', 'F6 Admin', '+393400002101');
select pg_temp.mk_user('a6000000-0000-4000-8000-000000002102', 'barber', 'F6 Barbiere Uno', '+393400002102');
select pg_temp.mk_user('a6000000-0000-4000-8000-000000002103', 'barber', 'F6 Barbiere Due', '+393400002103');
select pg_temp.mk_user('a6000000-0000-4000-8000-000000002104', 'customer', 'F6 Cliente Uno', '+393400002104');
select pg_temp.mk_user('a6000000-0000-4000-8000-000000002105', 'customer', 'F6 Cliente Due', '+393400002105');
select pg_temp.mk_user('a6000000-0000-4000-8000-000000002106', 'customer', 'F6 Cliente Online', '+393400002106');

insert into public.services (id, name, duration_min, price_cents, is_active) values
  ('e6000000-0000-4000-8000-000000002101', 'F6 Taglio', 30, 2000, true),
  ('e6000000-0000-4000-8000-000000002102', 'F6 Taglio e barba', 45, 3500, true);
insert into public.barbers (id, display_name, is_active, profile_id) values
  ('eb600000-0000-4000-8000-000000002101', 'F6 X1', true, 'a6000000-0000-4000-8000-000000002102'),
  ('eb600000-0000-4000-8000-000000002102', 'F6 X2', true, 'a6000000-0000-4000-8000-000000002103');
insert into public.barber_services (barber_id, service_id) values
  ('eb600000-0000-4000-8000-000000002101', 'e6000000-0000-4000-8000-000000002101'),
  ('eb600000-0000-4000-8000-000000002102', 'e6000000-0000-4000-8000-000000002101'),
  ('eb600000-0000-4000-8000-000000002102', 'e6000000-0000-4000-8000-000000002102');
insert into public.working_hours (barber_id, weekday, start_time, end_time)
select b.id, wd, f.s, f.e
  from (values ('eb600000-0000-4000-8000-000000002101'::uuid), ('eb600000-0000-4000-8000-000000002102')) b (id)
 cross join generate_series(1, 6) wd
 cross join (values ('09:00'::time, '13:00'::time), ('15:00', '19:00')) f (s, e);

-- ===========================================================================
-- 1. Struttura (decisione 2)
-- ===========================================================================
select ok(
  exists (select 1 from pg_constraint
           where conname = 'bookings_customer_no_overlap'
             and conrelid = 'public.bookings'::regclass and contype = 'x'),
  'SPEC §3.7.6: esiste il vincolo di esclusione bookings_customer_no_overlap su bookings');
select ok(
  (select pg_get_constraintdef(oid) ~ 'customer_id WITH ='
          and pg_get_constraintdef(oid) ~ 'tstzrange\(starts_at, ends_at'
          and pg_get_constraintdef(oid) ~ 'confirmed'
     from pg_constraint where conname = 'bookings_customer_no_overlap'),
  'SPEC §3.7.6: stesso cliente, intervallo [starts_at, ends_at) senza buffer, solo confirmed');

-- ===========================================================================
-- 2. Admin: prenotazioni manuali e regola 6 (giorno fisso 2041-02-05, martedì)
-- ===========================================================================
select pg_temp.act_as('a6000000-0000-4000-8000-000000002101');

select is(pg_temp.outcome($q$ insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, source)
  values ('bd000000-0000-4000-8000-000000002101', 'a6000000-0000-4000-8000-000000002104',
          'eb600000-0000-4000-8000-000000002101', 'e6000000-0000-4000-8000-000000002101', '2041-02-05 10:00+01', 'manual') $q$),
  'rows:1', 'SPEC §6.2: l''admin crea una manuale per il cliente 1 con X1 alle 10:00');
select is(pg_temp.outcome($q$ insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, source)
  values ('bd000000-0000-4000-8000-000000002102', 'a6000000-0000-4000-8000-000000002104',
          'eb600000-0000-4000-8000-000000002102', 'e6000000-0000-4000-8000-000000002101', '2041-02-05 10:15+01', 'manual') $q$),
  '23P01:bookings_customer_no_overlap',
  'SPEC §3.7.6 / §3.7.5: stesso cliente con un altro barbiere in sovrapposizione → rifiutata anche se manuale');
select is(pg_temp.outcome($q$ insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, source)
  values ('bd000000-0000-4000-8000-000000002103', 'a6000000-0000-4000-8000-000000002104',
          'eb600000-0000-4000-8000-000000002102', 'e6000000-0000-4000-8000-000000002101', '2041-02-05 10:30+01', 'manual') $q$),
  'rows:1', 'SPEC §3.7.6: adiacente dopo ([) e senza buffer: 10:30 con X2 ammessa (buffer di 10'' ignorato)');
select is(pg_temp.outcome($q$ insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, source)
  values ('bd000000-0000-4000-8000-000000002104', 'a6000000-0000-4000-8000-000000002104',
          'eb600000-0000-4000-8000-000000002102', 'e6000000-0000-4000-8000-000000002101', '2041-02-05 09:30+01', 'manual') $q$),
  'rows:1', 'SPEC §3.7.6: adiacente prima ([): 09:30–10:00 con X2 ammessa');
select is(pg_temp.outcome($q$ insert into public.bookings (id, guest_name, guest_phone, barber_id, service_id, starts_at, source) values
  ('bd000000-0000-4000-8000-000000002105', 'F6 Ospite', '+390300002101',
   'eb600000-0000-4000-8000-000000002101', 'e6000000-0000-4000-8000-000000002101', '2041-02-05 12:00+01', 'manual'),
  ('bd000000-0000-4000-8000-000000002106', 'F6 Ospite', '+390300002101',
   'eb600000-0000-4000-8000-000000002102', 'e6000000-0000-4000-8000-000000002101', '2041-02-05 12:00+01', 'manual') $q$),
  'rows:2', 'decisione 2: le prenotazioni intestate a un ospite sono escluse dal vincolo del cliente');
select is(pg_temp.outcome($q$ insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, status, source) values
  ('bd000000-0000-4000-8000-000000002107', 'a6000000-0000-4000-8000-000000002105',
   'eb600000-0000-4000-8000-000000002101', 'e6000000-0000-4000-8000-000000002101', '2041-02-05 14:00+01', 'cancelled_by_shop', 'manual'),
  ('bd000000-0000-4000-8000-000000002108', 'a6000000-0000-4000-8000-000000002105',
   'eb600000-0000-4000-8000-000000002102', 'e6000000-0000-4000-8000-000000002101', '2041-02-05 14:00+01', 'confirmed', 'manual') $q$),
  'rows:2', 'decisione 2: una cancellata non conta per la sovrapposizione del cliente');
select is(pg_temp.outcome($q$ insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, status, source) values
  ('bd000000-0000-4000-8000-000000002109', 'a6000000-0000-4000-8000-000000002105',
   'eb600000-0000-4000-8000-000000002101', 'e6000000-0000-4000-8000-000000002101', '2024-01-09 10:00+01', 'completed', 'manual'),
  ('bd000000-0000-4000-8000-000000002110', 'a6000000-0000-4000-8000-000000002105',
   'eb600000-0000-4000-8000-000000002102', 'e6000000-0000-4000-8000-000000002101', '2024-01-09 10:00+01', 'confirmed', 'manual') $q$),
  'rows:2', 'SPEC §3.7.6: vale solo fra confirmed (una completed non conta)');

-- Ripristino a confirmed (decisione 5: "Ripristina confermata" dell'admin)
select is(pg_temp.outcome($q$ update public.bookings set status = 'confirmed'
                               where id = 'bd000000-0000-4000-8000-000000002107' $q$),
  '23P01:bookings_customer_no_overlap',
  'SPEC §3.7.6: il ripristino a confirmed che sovrappone due appuntamenti dello stesso cliente è rifiutato');
select is((select status::text from public.bookings where id = 'bd000000-0000-4000-8000-000000002107'),
  'cancelled_by_shop', 'SPEC §3.7.6: dopo il rifiuto la prenotazione resta cancellata');

-- Spostamenti e modifiche dell'admin (SPEC §6.3)
select is(pg_temp.outcome($q$ update public.bookings set starts_at = '2041-02-05 10:15+01'
                               where id = 'bd000000-0000-4000-8000-000000002103' $q$),
  '23P01:bookings_customer_no_overlap',
  'SPEC §6.3 / §3.7.6: spostamento dell''admin sovrapposto a un altro appuntamento dello stesso cliente → rifiutato');
select is(pg_temp.outcome($q$ update public.bookings set duration_min = 45
                               where id = 'bd000000-0000-4000-8000-000000002101' $q$),
  '23P01:bookings_customer_no_overlap',
  'SPEC §3.6 / §3.7.6: allungare la durata fino a sovrapporsi a un altro appuntamento del cliente → rifiutato');
select is(pg_temp.outcome($q$ update public.bookings
                                  set barber_id = 'eb600000-0000-4000-8000-000000002101', starts_at = '2041-02-05 12:15+01'
                                where id = 'bd000000-0000-4000-8000-000000002108' $q$),
  '23P01:bookings_no_overlap',
  'SPEC §6.3 / §3.7.1: spostamento dell''admin su un barbiere occupato → rifiutato');
select is(pg_temp.outcome($q$ update public.bookings set starts_at = '2041-02-05 16:00+01'
                               where id = 'bd000000-0000-4000-8000-000000002108' $q$),
  'rows:1', 'SPEC §6.3: spostamento dell''admin su un orario libero → ammesso');
select is(
  (select row(barber_id, starts_at, ends_at)::text from public.bookings where id = 'bd000000-0000-4000-8000-000000002108'),
  row('eb600000-0000-4000-8000-000000002102'::uuid, '2041-02-05 16:00+01'::timestamptz, '2041-02-05 16:30+01'::timestamptz)::text,
  'SPEC §6.3: dopo lo spostamento barbiere invariato e fine ricalcolata dal database');

-- Cambio di servizio (decisione dell'utente, punto 3): durata e prezzo si ricopiano dal nuovo
-- servizio; quelli inviati nello stesso UPDATE vengono ignorati
select pg_temp.act_as_postgres();
insert into public.bookings (id, guest_name, guest_phone, barber_id, service_id, starts_at, source) values
  ('bd000000-0000-4000-8000-000000002112', 'F6 Ospite Servizio', '+390300002104',
   'eb600000-0000-4000-8000-000000002102', 'e6000000-0000-4000-8000-000000002101', '2041-02-05 08:00+01', 'manual');
select pg_temp.act_as('a6000000-0000-4000-8000-000000002101');
select is(pg_temp.outcome($q$ update public.bookings
                                  set service_id = 'e6000000-0000-4000-8000-000000002102', duration_min = 99, price_cents = 1
                                where id = 'bd000000-0000-4000-8000-000000002112' $q$),
  'rows:1', 'SPEC §3.6: l''admin cambia servizio (con durata e prezzo nello stesso UPDATE)');
select is(
  (select row(service_id, duration_min, price_cents, ends_at)::text from public.bookings
    where id = 'bd000000-0000-4000-8000-000000002112'),
  row('e6000000-0000-4000-8000-000000002102'::uuid, 45, 3500, '2041-02-05 08:45+01'::timestamptz)::text,
  'SPEC §3.6: cambiando servizio vincono durata e prezzo del nuovo servizio, fine ricalcolata');

-- ===========================================================================
-- 3. Barbiere X1 (decisione 3)
-- ===========================================================================
select pg_temp.act_as('a6000000-0000-4000-8000-000000002102');

select is(pg_temp.outcome($q$ update public.bookings set status = 'cancelled_by_customer'
                               where id = 'bd000000-0000-4000-8000-000000002101' $q$),
  'rows:1', 'decisione 3: il barbiere segna cancelled_by_customer una propria prenotazione confirmed');
select is(
  (select row(status, status_changed_by)::text from public.bookings where id = 'bd000000-0000-4000-8000-000000002101'),
  row('cancelled_by_customer'::public.booking_status, 'a6000000-0000-4000-8000-000000002102'::uuid)::text,
  'decisione 3: stato cancelled_by_customer con autore il barbiere');
select matches(pg_temp.outcome($q$ update public.bookings set status = 'cancelled_by_customer'
                                    where id = 'bd000000-0000-4000-8000-000000002103' $q$),
  '^(rows:0|42501)$', 'SPEC §2: il barbiere non cancella le prenotazioni di un altro barbiere');
select matches(pg_temp.outcome($q$ update public.bookings set status = 'confirmed'
                                    where id = 'bd000000-0000-4000-8000-000000002101' $q$),
  '^(rows:0|42501|P0001|23514)$', 'SPEC §3.6: il barbiere non ripristina una cancellata (stato finale)');
select is(pg_temp.outcome($q$ update public.bookings set status = 'cancelled_by_shop'
                               where id = 'bd000000-0000-4000-8000-000000002105' $q$),
  'rows:1', 'SPEC §3.6: resta ammesso confirmed → cancelled_by_shop');
select matches(pg_temp.outcome($q$ update public.bookings set status = 'confirmed'
                               where id = 'bd000000-0000-4000-8000-000000002105' $q$),
  '^(rows:0|42501|P0001|23514)$', 'SPEC §3.6: cancelled_by_shop → confirmed non ammesso al barbiere');

-- Il barbiere non sposta e non modifica (SPEC §3.6, §6.3: solo l'admin)
select pg_temp.act_as_postgres();
insert into public.bookings (id, guest_name, guest_phone, barber_id, service_id, starts_at, source) values
  ('bd000000-0000-4000-8000-000000002111', 'F6 Ospite Due', '+390300002102',
   'eb600000-0000-4000-8000-000000002101', 'e6000000-0000-4000-8000-000000002101', '2041-02-05 18:00+01', 'manual');
select pg_temp.act_as('a6000000-0000-4000-8000-000000002102');
select matches(pg_temp.outcome($q$ update public.bookings set starts_at = '2041-02-05 18:15+01'
                               where id = 'bd000000-0000-4000-8000-000000002111' $q$),
  '^rows:1$', 'fetta 6c (ADR 008): il barbiere sposta l''orario di una propria confirmed futura');
select matches(pg_temp.outcome($q$ update public.bookings set barber_id = 'eb600000-0000-4000-8000-000000002102'
                               where id = 'bd000000-0000-4000-8000-000000002111' $q$),
  '^(rows:0|42501|P0001|23514)$', 'SPEC §6.3: il barbiere non riassegna una propria prenotazione a un altro barbiere');
select matches(pg_temp.outcome($q$ update public.bookings set price_cents = 1000, duration_min = 60
                               where id = 'bd000000-0000-4000-8000-000000002111' $q$),
  '^(rows:0|42501|P0001|23514)$', 'SPEC §3.6: il barbiere non modifica prezzo e durata');
select matches(pg_temp.outcome($q$ update public.bookings set customer_id = 'a6000000-0000-4000-8000-000000002104'
                               where id = 'bd000000-0000-4000-8000-000000002111' $q$),
  '^(rows:0|42501|P0001|23514)$', 'decisione 3: il barbiere non cambia il cliente');

-- Creazione (SPEC §2: "crea prenotazioni manuali per sé")
select is(pg_temp.outcome($q$ insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, source)
  values ('F6 Ospite Tre', '+390300002103', 'eb600000-0000-4000-8000-000000002102',
          'e6000000-0000-4000-8000-000000002101', '2041-02-05 17:00+01', 'manual') $q$),
  '42501', 'SPEC §2: il barbiere non crea prenotazioni per un altro barbiere');
select is(pg_temp.outcome($q$ insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, source)
  values ('F6 Ospite Tre', '+390300002103', 'eb600000-0000-4000-8000-000000002101',
          'e6000000-0000-4000-8000-000000002101', '2041-02-05 17:00+01', 'manual') $q$),
  'rows:1', 'SPEC §2: il barbiere crea una manuale per sé');
select is(pg_temp.outcome($q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
  values ('a6000000-0000-4000-8000-000000002105', 'eb600000-0000-4000-8000-000000002101',
          'e6000000-0000-4000-8000-000000002101', '2041-02-05 16:15+01', 'manual') $q$),
  '23P01:bookings_customer_no_overlap',
  'SPEC §3.7.6: anche la manuale del barbiere non sovrappone due appuntamenti dello stesso cliente');

-- ===========================================================================
-- 4. Online: create_online_booking restituisce ancora customer_overlap (decisione 2)
-- ===========================================================================
select pg_temp.act_as_postgres();
insert into public.bookings (customer_id, barber_id, service_id, starts_at, status, source) values
  ('a6000000-0000-4000-8000-000000002106', 'eb600000-0000-4000-8000-000000002102', 'e6000000-0000-4000-8000-000000002101',
   pg_temp.loc(pg_temp.d(), '10:00'), 'confirmed', 'manual');
select pg_temp.act_as('a6000000-0000-4000-8000-000000002106');
select throws_ok($q$ select public.create_online_booking('e6000000-0000-4000-8000-000000002101',
  'eb600000-0000-4000-8000-000000002101', pg_temp.loc(pg_temp.d(), '10:15'), null) $q$,
  'P0001', 'customer_overlap',
  'decisione 2: online con sovrapposizione del cliente → ancora customer_overlap (non 23P01)');
select lives_ok($q$ select public.create_online_booking('e6000000-0000-4000-8000-000000002101',
  'eb600000-0000-4000-8000-000000002101', pg_temp.loc(pg_temp.d(), '10:30'), null) $q$,
  'SPEC §3.7.6: online adiacente alla propria prenotazione ([)) → ammessa');

-- ===========================================================================
-- 5. Verifica finale come postgres
-- ===========================================================================
select pg_temp.act_as_postgres();
select is(
  (select count(*) from public.bookings b1 join public.bookings b2
      on b1.customer_id = b2.customer_id and b1.id < b2.id
   where b1.status = 'confirmed' and b2.status = 'confirmed'
     and tstzrange(b1.starts_at, b1.ends_at, '[)') && tstzrange(b2.starts_at, b2.ends_at, '[)')),
  0::bigint, 'SPEC §3.7.6: nessun cliente con due confirmed sovrapposte');

select is(
  (select row(barber_id, customer_id, starts_at, ends_at, price_cents, duration_min, status)::text
     from public.bookings where id = 'bd000000-0000-4000-8000-000000002111'),
  row('eb600000-0000-4000-8000-000000002101'::uuid, null::uuid, '2041-02-05 18:15+01'::timestamptz,
      '2041-02-05 18:45+01'::timestamptz, 2000, 30, 'confirmed'::public.booking_status)::text,
  'SPEC §3.6 / fetta 6c: spostata solo nell''orario; barbiere, cliente, prezzo, durata e stato invariati');

select * from finish();
rollback;
