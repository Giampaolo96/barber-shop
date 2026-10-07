-- Test di accettazione – FETTA 6c ("Spostamento con trascinamento sul calendario").
-- 26 – Vincoli del database sullo spostamento dell'orario da parte del barbiere.
-- SPEC §2 (ruoli), §3.6 (prezzo e durata copiati, fine ricalcolata dal database), §3.7.1 (nessuna
-- sovrapposizione del barbiere, buffer incluso), §3.7.6 (nessuna sovrapposizione del cliente), §6.3
-- + decisioni approvate per la fetta 6c:
--   decisione 1: l'admin sposta qualunque confirmed non ancora iniziata, anche tra colonne; il barbiere
--     (non admin) solo le proprie confirmed con starts_at > now, solo nell'orario (stesso barbiere).
--   decisione 2: bookings_before_write ridefinito: per lo staff non admin è ammesso cambiare SOLO
--     starts_at, se old.status = 'confirmed', lo stato non cambia nello stesso update e
--     old.starts_at > now(). Restano vietati barber_id, service_id, customer_id, duration_min,
--     price_cents, buffer_min, source. ends_at e blocked_until li ricalcola il trigger. RLS invariata.
--     I vincoli di esclusione valgono anche per questi spostamenti. La destinazione può essere nel
--     passato: conta solo che l'origine sia futura.
--
-- Esiti delle scritture: 'rows:N' oppure SQLSTATE, seguito da ':<vincolo>' quando l'errore ne
-- nomina uno (es. '23P01:bookings_no_overlap').
-- I dati sono creati dal test e annullati dal rollback. Non modificare durante l'implementazione.
begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

-- ---------------------------------------------------------------------------
-- Helper (come 21_staff_calendar)
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
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
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
          'f6c-' || uid || '@qa.test', '{}'::jsonb, '{}'::jsonb, now(), now());
  update public.profiles
     set role = r::public.user_role, full_name = nm, phone = ph,
         privacy_policy_version = (select ss.privacy_policy_version from public.shop_settings ss),
         privacy_consent_at = now()
   where id = uid;
end $f$;

-- ---------------------------------------------------------------------------
-- Dati (come postgres). Buffer di 10 minuti, copiato sulle prenotazioni alla creazione.
-- Giorno fisso futuro: 2041-03-06 (ora solare, UTC+1).
-- ---------------------------------------------------------------------------
update public.shop_settings set timezone = 'Europe/Rome', slot_granularity_min = 15, buffer_min = 10;

select pg_temp.mk_user('a6c00000-0000-4000-8000-000000002601', 'admin', 'F6C Admin', '+393400002601');
select pg_temp.mk_user('a6c00000-0000-4000-8000-000000002602', 'barber', 'F6C Barbiere Uno', '+393400002602');
select pg_temp.mk_user('a6c00000-0000-4000-8000-000000002603', 'barber', 'F6C Barbiere Due', '+393400002603');
select pg_temp.mk_user('a6c00000-0000-4000-8000-000000002604', 'customer', 'F6C Cliente', '+393400002604');

insert into public.services (id, name, duration_min, price_cents, is_active) values
  ('e6c00000-0000-4000-8000-000000002601', 'F6C Taglio', 30, 2000, true),
  ('e6c00000-0000-4000-8000-000000002602', 'F6C Barba', 20, 1500, true);
insert into public.barbers (id, display_name, is_active, profile_id) values
  ('eb6c0000-0000-4000-8000-000000002601', 'F6C X1', true, 'a6c00000-0000-4000-8000-000000002602'),
  ('eb6c0000-0000-4000-8000-000000002602', 'F6C X2', true, 'a6c00000-0000-4000-8000-000000002603');
insert into public.barber_services (barber_id, service_id) values
  ('eb6c0000-0000-4000-8000-000000002601', 'e6c00000-0000-4000-8000-000000002601'),
  ('eb6c0000-0000-4000-8000-000000002601', 'e6c00000-0000-4000-8000-000000002602'),
  ('eb6c0000-0000-4000-8000-000000002602', 'e6c00000-0000-4000-8000-000000002601');

-- X1 = barbiere Uno, X2 = barbiere Due. Tutte ospiti salvo b8 e b9 (cliente registrato).
insert into public.bookings (id, guest_name, guest_phone, customer_id, barber_id, service_id, starts_at, status, source) values
  -- b1: propria, futura, confirmed (spostata dal barbiere)
  ('bd6c0000-0000-4000-8000-000000002601', 'F6C Ospite 1', '+390300002601', null,
   'eb6c0000-0000-4000-8000-000000002601', 'e6c00000-0000-4000-8000-000000002601', '2041-03-06 10:00+01', 'confirmed', 'manual'),
  -- b2: di un altro barbiere (X2), futura
  ('bd6c0000-0000-4000-8000-000000002602', 'F6C Ospite 2', '+390300002602', null,
   'eb6c0000-0000-4000-8000-000000002602', 'e6c00000-0000-4000-8000-000000002601', '2041-03-06 10:00+01', 'confirmed', 'manual'),
  -- b3: propria, già iniziata (2 ore fa)
  ('bd6c0000-0000-4000-8000-000000002603', 'F6C Ospite 3', '+390300002603', null,
   'eb6c0000-0000-4000-8000-000000002601', 'e6c00000-0000-4000-8000-000000002601', now() - interval '2 hours', 'confirmed', 'manual'),
  -- b3b: propria, inizia esattamente adesso (bordo: starts_at = now() non è "non ancora iniziata")
  ('bd6c0000-0000-4000-8000-000000002613', 'F6C Ospite 3b', '+390300002613', null,
   'eb6c0000-0000-4000-8000-000000002601', 'e6c00000-0000-4000-8000-000000002602', now(), 'confirmed', 'manual'),
  -- b4: propria, futura, non confirmed
  ('bd6c0000-0000-4000-8000-000000002604', 'F6C Ospite 4', '+390300002604', null,
   'eb6c0000-0000-4000-8000-000000002601', 'e6c00000-0000-4000-8000-000000002601', '2041-03-06 08:00+01', 'cancelled_by_shop', 'manual'),
  -- b5: propria, futura, confirmed (tentativi di modifica oltre all'orario)
  ('bd6c0000-0000-4000-8000-000000002605', 'F6C Ospite 5', '+390300002605', null,
   'eb6c0000-0000-4000-8000-000000002601', 'e6c00000-0000-4000-8000-000000002601', '2041-03-06 12:00+01', 'confirmed', 'manual'),
  -- b6 e b7: buffer (b6 14:00–14:30, occupato fino alle 14:40; b7 15:00–15:30, occupato fino alle 15:40)
  ('bd6c0000-0000-4000-8000-000000002606', 'F6C Ospite 6', '+390300002606', null,
   'eb6c0000-0000-4000-8000-000000002601', 'e6c00000-0000-4000-8000-000000002601', '2041-03-06 14:00+01', 'confirmed', 'manual'),
  ('bd6c0000-0000-4000-8000-000000002607', 'F6C Ospite 7', '+390300002607', null,
   'eb6c0000-0000-4000-8000-000000002601', 'e6c00000-0000-4000-8000-000000002601', '2041-03-06 15:00+01', 'confirmed', 'manual'),
  -- b8 (X1, 17:00) e b9 (X2, 17:45): stesso cliente registrato
  ('bd6c0000-0000-4000-8000-000000002608', null, null, 'a6c00000-0000-4000-8000-000000002604',
   'eb6c0000-0000-4000-8000-000000002601', 'e6c00000-0000-4000-8000-000000002601', '2041-03-06 17:00+01', 'confirmed', 'manual'),
  ('bd6c0000-0000-4000-8000-000000002609', null, null, 'a6c00000-0000-4000-8000-000000002604',
   'eb6c0000-0000-4000-8000-000000002602', 'e6c00000-0000-4000-8000-000000002601', '2041-03-06 17:45+01', 'confirmed', 'manual');

-- ===========================================================================
-- 1. Barbiere Uno: sposta una propria confirmed futura (decisioni 1 e 2)
-- ===========================================================================
select pg_temp.act_as('a6c00000-0000-4000-8000-000000002602');

select is(pg_temp.outcome($q$ update public.bookings set starts_at = '2041-03-06 11:00+01'
                               where id = 'bd6c0000-0000-4000-8000-000000002601' $q$),
  'rows:1', 'decisione 2: il barbiere sposta l''orario di una propria confirmed futura');
select is(
  (select row(barber_id, starts_at, ends_at, blocked_until, duration_min, price_cents, status)::text
     from public.bookings where id = 'bd6c0000-0000-4000-8000-000000002601'),
  row('eb6c0000-0000-4000-8000-000000002601'::uuid, '2041-03-06 11:00+01'::timestamptz,
      '2041-03-06 11:30+01'::timestamptz, '2041-03-06 11:40+01'::timestamptz, 30, 2000,
      'confirmed'::public.booking_status)::text,
  'SPEC §3.6 / decisione 2: stesso barbiere, fine e buffer ricalcolati dal database, durata e prezzo invariati');

-- ===========================================================================
-- 2. Barbiere Uno: rifiuti
-- ===========================================================================
select is(pg_temp.outcome($q$ update public.bookings set starts_at = '2041-03-06 11:00+01'
                               where id = 'bd6c0000-0000-4000-8000-000000002602' $q$),
  'rows:0', 'SPEC §2 / decisione 1: la prenotazione di un altro barbiere non è aggiornabile (RLS: 0 righe)');
select is(pg_temp.outcome($q$ update public.bookings
                                  set barber_id = 'eb6c0000-0000-4000-8000-000000002602', starts_at = '2041-03-06 12:30+01'
                                where id = 'bd6c0000-0000-4000-8000-000000002601' $q$),
  '42501', 'decisione 1: il barbiere non sposta una propria prenotazione su un''altra colonna (barber_id)');
select is(pg_temp.outcome($q$ update public.bookings set starts_at = '2041-03-06 09:00+01'
                               where id = 'bd6c0000-0000-4000-8000-000000002603' $q$),
  '42501', 'decisione 2: il barbiere non sposta una propria prenotazione già iniziata');
select is(pg_temp.outcome($q$ update public.bookings set starts_at = '2041-03-06 09:00+01'
                               where id = 'bd6c0000-0000-4000-8000-000000002613' $q$),
  '42501', 'decisione 2 (bordo): starts_at = now() conta come già iniziata');
select is(pg_temp.outcome($q$ update public.bookings set starts_at = '2041-03-06 09:00+01'
                               where id = 'bd6c0000-0000-4000-8000-000000002604' $q$),
  '42501', 'decisione 2: il barbiere non sposta una prenotazione non confirmed');
select is(pg_temp.outcome($q$ update public.bookings set starts_at = '2041-03-06 12:30+01', status = 'cancelled_by_shop'
                               where id = 'bd6c0000-0000-4000-8000-000000002605' $q$),
  '42501', 'decisione 2: lo spostamento non può cambiare lo stato nello stesso update');
select is(pg_temp.outcome($q$ update public.bookings set starts_at = '2041-03-06 12:30+01', duration_min = 60
                               where id = 'bd6c0000-0000-4000-8000-000000002605' $q$),
  '42501', 'SPEC §3.6 / decisione 2: spostando, il barbiere non cambia la durata');
select is(pg_temp.outcome($q$ update public.bookings set starts_at = '2041-03-06 12:30+01', price_cents = 1
                               where id = 'bd6c0000-0000-4000-8000-000000002605' $q$),
  '42501', 'SPEC §3.6 / decisione 2: spostando, il barbiere non cambia il prezzo');
select is(pg_temp.outcome($q$ update public.bookings set starts_at = '2041-03-06 12:30+01',
                                      service_id = 'e6c00000-0000-4000-8000-000000002602'
                               where id = 'bd6c0000-0000-4000-8000-000000002605' $q$),
  '42501', 'decisione 2: spostando, il barbiere non cambia il servizio');

-- ===========================================================================
-- 3. Vincoli di esclusione anche per lo spostamento del barbiere (SPEC §3.7.1, §3.7.6)
-- ===========================================================================
select is(pg_temp.outcome($q$ update public.bookings set starts_at = '2041-03-06 15:35+01'
                               where id = 'bd6c0000-0000-4000-8000-000000002606' $q$),
  '23P01:bookings_no_overlap', 'SPEC §3.7.1: lo spostamento del barbiere dentro il buffer di un''altra prenotazione è rifiutato');
select is(pg_temp.outcome($q$ update public.bookings set starts_at = '2041-03-06 14:25+01'
                               where id = 'bd6c0000-0000-4000-8000-000000002606' $q$),
  '23P01:bookings_no_overlap', 'SPEC §3.7.1: il buffer della prenotazione spostata non può toccare la successiva');
select is(pg_temp.outcome($q$ update public.bookings set starts_at = '2041-03-06 15:40+01'
                               where id = 'bd6c0000-0000-4000-8000-000000002606' $q$),
  'rows:1', 'SPEC §3.7.1: adiacente alla fine del buffer della precedente → ammesso');
select is(pg_temp.outcome($q$ update public.bookings set starts_at = '2041-03-06 17:30+01'
                               where id = 'bd6c0000-0000-4000-8000-000000002608' $q$),
  '23P01:bookings_customer_no_overlap',
  'SPEC §3.7.6: lo spostamento del barbiere non sovrappone due appuntamenti dello stesso cliente');

-- Destinazione nel passato: conta solo che l'origine sia futura (decisione 2)
select is(pg_temp.outcome($q$ update public.bookings set starts_at = '2024-01-09 10:00+01'
                               where id = 'bd6c0000-0000-4000-8000-000000002601' $q$),
  'rows:1', 'decisione 2: una confirmed futura si può spostare anche su un orario passato');

-- ===========================================================================
-- 4. Admin invariato: sposta anche tra colonne (SPEC §6.3, decisione 1)
-- ===========================================================================
select pg_temp.act_as('a6c00000-0000-4000-8000-000000002601');
select is(pg_temp.outcome($q$ update public.bookings
                                  set barber_id = 'eb6c0000-0000-4000-8000-000000002601', starts_at = '2041-03-06 09:00+01'
                                where id = 'bd6c0000-0000-4000-8000-000000002602' $q$),
  'rows:1', 'SPEC §6.3: l''admin sposta una prenotazione su un''altra colonna');

-- ===========================================================================
-- 5. Verifica finale come postgres
-- ===========================================================================
select pg_temp.act_as_postgres();
select is(
  (select row(barber_id, starts_at, ends_at)::text from public.bookings where id = 'bd6c0000-0000-4000-8000-000000002602'),
  row('eb6c0000-0000-4000-8000-000000002601'::uuid, '2041-03-06 09:00+01'::timestamptz,
      '2041-03-06 09:30+01'::timestamptz)::text,
  'SPEC §6.3: dopo lo spostamento dell''admin nuovo barbiere e fine ricalcolata');
select is(
  (select array_agg(row(starts_at, status, service_id, duration_min, price_cents)::text order by id)
     from public.bookings
    where id in ('bd6c0000-0000-4000-8000-000000002604', 'bd6c0000-0000-4000-8000-000000002605',
                 'bd6c0000-0000-4000-8000-000000002608')),
  array[
    row('2041-03-06 08:00+01'::timestamptz, 'cancelled_by_shop'::public.booking_status,
        'e6c00000-0000-4000-8000-000000002601'::uuid, 30, 2000)::text,
    row('2041-03-06 12:00+01'::timestamptz, 'confirmed'::public.booking_status,
        'e6c00000-0000-4000-8000-000000002601'::uuid, 30, 2000)::text,
    row('2041-03-06 17:00+01'::timestamptz, 'confirmed'::public.booking_status,
        'e6c00000-0000-4000-8000-000000002601'::uuid, 30, 2000)::text],
  'decisione 2: le prenotazioni degli spostamenti rifiutati sono invariate');

select * from finish();
rollback;
