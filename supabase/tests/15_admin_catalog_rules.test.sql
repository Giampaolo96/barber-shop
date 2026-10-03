-- Test di accettazione – FETTA 3 (SPEC §11: "Admin: servizi, barbieri, orari, assenze, chiusure").
-- 15 – regole del catalogo viste dall'admin autenticato (non da postgres) e impostazioni.
-- SPEC §3.1, §3.2, §3.3, §3.5, §6.4–6.8, §12 ("Servizio disattivato con prenotazioni future già
-- esistenti") + decisioni approvate per la fetta 3 (punto D). I casi già coperti da 02–05 non sono
-- ripetuti: qui solo l'eliminazione di un barbiere con prenotazioni da admin, la disattivazione con
-- prenotazioni future seguita da modifiche al servizio, l'aggiornamento di tutte le impostazioni
-- della §3.1, i vincoli decisi per la fetta 3 (granularità fra 5, 10, 15, 20, 30, 60; orizzonte
-- di almeno un giorno; riga di shop_settings non eliminabile) e le assenze di un barbiere admin.
-- I dati sono creati dal test e annullati dal rollback. Non modificare durante l'implementazione.
begin;
create extension if not exists pgtap with schema extensions;

select plan(29);

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

-- Tenta di eliminare la riga delle impostazioni e annulla comunque l'effetto, così un'eventuale
-- eliminazione riuscita non altera i test successivi: 'rows:N remaining:M' oppure 'SQLSTATE remaining:1'
create function pg_temp.try_delete_settings() returns text language plpgsql as $f$
declare n bigint; remaining bigint; result text;
begin
  begin
    delete from public.shop_settings;
    get diagnostics n = row_count;
    select count(*) into remaining from public.shop_settings;
    result := 'rows:' || n || ' remaining:' || remaining;
    raise exception 'annulla' using errcode = 'P0099';
  exception
    when sqlstate 'P0099' then return result;
    when others then return sqlstate || ' remaining:1';
  end;
end $f$;

-- ---------------------------------------------------------------------------
-- Dati di base (come postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('d3000000-0000-4000-8000-000000001501', 'f3-cat-admin@qa.test'),
  ('d3000000-0000-4000-8000-000000001502', 'f3-cat-barber@qa.test'),
  ('d3000000-0000-4000-8000-000000001503', 'f3-cat-customer@qa.test');
update public.profiles set role = 'admin' where id = 'd3000000-0000-4000-8000-000000001501';
update public.profiles set role = 'barber' where id = 'd3000000-0000-4000-8000-000000001502';

update public.shop_settings set buffer_min = 0;

insert into public.services (id, name, duration_min, price_cents, is_active, sort_order) values
  ('d5000000-0000-4000-8000-000000001501', 'F3 Cat Taglio', 30, 2500, true, 9501);

-- L'admin è anche barbiere (SPEC §2): scheda collegata al suo profilo
insert into public.barbers (id, display_name, is_active, profile_id) values
  ('db000000-0000-4000-8000-000000001501', 'F3 Cat Con Prenotazioni', true, 'd3000000-0000-4000-8000-000000001502'),
  ('db000000-0000-4000-8000-000000001502', 'F3 Cat Titolare', true, 'd3000000-0000-4000-8000-000000001501');

insert into public.barber_services (barber_id, service_id) values
  ('db000000-0000-4000-8000-000000001501', 'd5000000-0000-4000-8000-000000001501'),
  ('db000000-0000-4000-8000-000000001502', 'd5000000-0000-4000-8000-000000001501');

-- Prenotazioni future confermate (2040) del barbiere 1501
insert into public.bookings (id, customer_id, guest_name, guest_phone, barber_id, service_id, starts_at, source) values
  ('d0000000-0000-4000-8000-000000001501', 'd3000000-0000-4000-8000-000000001503', null, null,
   'db000000-0000-4000-8000-000000001501', 'd5000000-0000-4000-8000-000000001501', '2040-05-08 10:00+02', 'online'),
  ('d0000000-0000-4000-8000-000000001502', null, 'F3 Ospite', '+390500000001',
   'db000000-0000-4000-8000-000000001501', 'd5000000-0000-4000-8000-000000001501', '2040-05-08 11:00+02', 'manual');

-- ===========================================================================
-- ADMIN
-- ===========================================================================
select pg_temp.act_as('d3000000-0000-4000-8000-000000001501');

-- ADR 001: barbieri e servizi con prenotazioni si disattivano, non si eliminano
select is(
  pg_temp.outcome($q$ delete from public.barbers where id = 'db000000-0000-4000-8000-000000001501' $q$),
  '23503', 'admin – SPEC §6.5: un barbiere con prenotazioni non si elimina (23503)');
select is(
  pg_temp.outcome($q$ delete from public.services where id = 'd5000000-0000-4000-8000-000000001501' $q$),
  '23503', 'admin – SPEC §6.4: un servizio con prenotazioni non si elimina (23503)');

-- SPEC §12: "Servizio disattivato con prenotazioni future già esistenti"
select is(
  pg_temp.outcome($q$ update public.services set is_active = false where id = 'd5000000-0000-4000-8000-000000001501' $q$),
  'rows:1', 'admin – SPEC §12: disattiva un servizio con prenotazioni future');
select is(
  pg_temp.outcome($q$ update public.services set price_cents = 9900, duration_min = 90
                       where id = 'd5000000-0000-4000-8000-000000001501' $q$),
  'rows:1', 'admin – SPEC §6.4: modifica prezzo e durata del servizio disattivato');
select is(
  (select array_agg(row(status, price_cents, duration_min, ends_at)::text order by starts_at)
     from public.bookings where service_id = 'd5000000-0000-4000-8000-000000001501'),
  array[row('confirmed'::public.booking_status, 2500, 30, '2040-05-08 10:30+02'::timestamptz)::text,
        row('confirmed'::public.booking_status, 2500, 30, '2040-05-08 11:30+02'::timestamptz)::text],
  'admin – SPEC §3.6 / §12: le prenotazioni future restano confirmed con prezzo, durata e fine copiati');

-- Disattivazione del barbiere: nessuna cancellazione automatica (decisione fetta 3)
select is(
  pg_temp.outcome($q$ update public.barbers set is_active = false where id = 'db000000-0000-4000-8000-000000001501' $q$),
  'rows:1', 'admin – SPEC §6.5: disattiva un barbiere con prenotazioni future');
select is(
  (select count(*) from public.bookings
    where barber_id = 'db000000-0000-4000-8000-000000001501' and status = 'confirmed'),
  2::bigint, 'admin – decisione fetta 3: le prenotazioni del barbiere disattivato restano confirmed');

-- Servizi abilitati: la modifica avviene sulle righe di barber_services
select is(
  pg_temp.outcome($q$ delete from public.barber_services
                       where barber_id = 'db000000-0000-4000-8000-000000001502'
                         and service_id = 'd5000000-0000-4000-8000-000000001501' $q$),
  'rows:1', 'admin – SPEC §6.5: toglie un servizio abilitato a un barbiere senza prenotazioni per quel servizio');

-- SPEC §3.1 / §6.8: l'admin aggiorna tutti i parametri delle impostazioni
select is(
  pg_temp.outcome($q$ update public.shop_settings
                         set name = 'F3 Negozio', address = 'Via Test 3', phone = '+39 06 0000003',
                             logo_url = 'https://example.com/logo.png', timezone = 'Europe/Rome',
                             slot_granularity_min = 10, min_advance_min = 30, max_horizon_days = 60,
                             cancel_limit_min = 180, buffer_min = 5, no_show_block_threshold = 0,
                             privacy_policy_version = '2026-11' $q$),
  'rows:1', 'admin – SPEC §6.8: aggiorna tutti i parametri della §3.1');
select is(
  (select row(name, address, phone, logo_url, timezone, slot_granularity_min, min_advance_min,
              max_horizon_days, cancel_limit_min, buffer_min, no_show_block_threshold,
              privacy_policy_version)::text from public.shop_settings),
  row('F3 Negozio', 'Via Test 3', '+39 06 0000003', 'https://example.com/logo.png', 'Europe/Rome',
      10, 30, 60, 180, 5, 0, '2026-11')::text,
  'admin – SPEC §3.1: i valori salvati sono quelli inviati');
select is(
  pg_temp.outcome($q$ update public.shop_settings set slot_granularity_min = 0 $q$),
  '23514', 'admin – SPEC §3.1: granularità 0 rifiutata dal database (23514)');
-- Decisione fetta 3 (utente): granularità solo fra 5, 10, 15, 20, 30, 60
select is(
  pg_temp.outcome($q$ update public.shop_settings set slot_granularity_min = 7 $q$),
  '23514', 'admin – decisione fetta 3: granularità 7 rifiutata dal database (23514)');
select is(
  pg_temp.outcome($q$ update public.shop_settings set slot_granularity_min = 45 $q$),
  '23514', 'admin – decisione fetta 3: granularità 45 rifiutata dal database (23514)');
select is(
  pg_temp.outcome($q$ update public.shop_settings set slot_granularity_min = 5 $q$),
  'rows:1', 'admin – decisione fetta 3: granularità 5 ammessa');
select is(
  pg_temp.outcome($q$ update public.shop_settings set slot_granularity_min = 60 $q$),
  'rows:1', 'admin – decisione fetta 3: granularità 60 ammessa');
-- Decisione fetta 3 (utente): max_horizon_days >= 1
select is(
  pg_temp.outcome($q$ update public.shop_settings set max_horizon_days = 0 $q$),
  '23514', 'admin – decisione fetta 3: max_horizon_days = 0 rifiutato dal database (23514)');
select is(
  pg_temp.outcome($q$ update public.shop_settings set max_horizon_days = 1 $q$),
  'rows:1', 'admin – decisione fetta 3: max_horizon_days = 1 ammesso');
-- Decisione fetta 3 (utente): nessuno elimina la riga delle impostazioni dall'app
select matches(pg_temp.try_delete_settings(), '^(rows:0|42501|P0001) remaining:1$',
  'admin – decisione fetta 3: la riga di shop_settings non si elimina e resta');
select is(
  pg_temp.outcome($q$ update public.shop_settings set privacy_policy_version = '   ' $q$),
  '23514', 'admin – SPEC §8: versione dell''informativa vuota rifiutata (23514)');
select is(
  pg_temp.outcome($q$ update public.shop_settings set timezone = 'Mars/Olympus_Mons' $q$),
  '23514', 'admin – SPEC §3.1: timezone inesistente rifiutata (23514)');

-- SPEC §2: l'admin che è anche barbiere gestisce le assenze della propria scheda
select is(
  pg_temp.outcome($q$ insert into public.time_off (id, barber_id, starts_at, ends_at, reason)
    values ('d7000000-0000-4000-8000-000000001501', 'db000000-0000-4000-8000-000000001502',
            '2040-06-01 00:00+02', '2040-06-03 00:00+02', 'Ferie titolare') $q$),
  'rows:1', 'admin barbiere – SPEC §2: inserisce un''assenza sulla propria scheda');

-- ===========================================================================
-- BARBER
-- ===========================================================================
select pg_temp.act_as('d3000000-0000-4000-8000-000000001502');

select is((select count(*) from public.time_off where id = 'd7000000-0000-4000-8000-000000001501'),
  0::bigint, 'barber – SPEC §2: non vede le assenze del titolare');
select matches(
  pg_temp.outcome($q$ update public.shop_settings set privacy_policy_version = 'forged' $q$),
  '^(rows:0|42501)$', 'barber – SPEC §6.8: non modifica la versione dell''informativa');
select matches(pg_temp.try_delete_settings(), '^(rows:0|42501|P0001) remaining:1$',
  'barber – decisione fetta 3: non elimina la riga di shop_settings');
select matches(
  pg_temp.outcome($q$ update public.barbers set is_active = true where id = 'db000000-0000-4000-8000-000000001501' $q$),
  '^(rows:0|42501)$', 'barber – SPEC §2: non riattiva la propria scheda');
-- Una propria assenza (anche sovrapposta a prenotazioni: l'avviso è nell'app, decisione fetta 3)
select is(
  pg_temp.outcome($q$ insert into public.time_off (barber_id, starts_at, ends_at, reason)
    values ('db000000-0000-4000-8000-000000001501', '2040-05-08 09:00+02', '2040-05-08 12:00+02', 'Visita') $q$),
  'rows:1', 'barber – SPEC §3.5: inserisce una propria assenza parziale anche sopra prenotazioni confermate');

-- ===========================================================================
-- CUSTOMER
-- ===========================================================================
select pg_temp.act_as('d3000000-0000-4000-8000-000000001503');
select matches(
  pg_temp.outcome($q$ update public.shop_settings set privacy_policy_version = 'forged' $q$),
  '^(rows:0|42501)$', 'customer – SPEC §6.8: non modifica la versione dell''informativa');

select pg_temp.act_as_postgres();
select is((select privacy_policy_version from public.shop_settings), '2026-11',
  'SPEC §8: la versione dell''informativa è quella salvata dall''admin');
select is(
  (select count(*) from public.bookings
    where barber_id = 'db000000-0000-4000-8000-000000001501' and status = 'confirmed'),
  2::bigint, 'decisione fetta 3: un''assenza sopra prenotazioni confermate non le cancella');

select * from finish();
rollback;
