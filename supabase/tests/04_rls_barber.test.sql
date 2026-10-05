-- Test di accettazione – FETTA 1 (SPEC §11: "Schema DB + RLS + seed dati demo").
-- 04 – RLS per il barbiere (profilo role barber collegato a una riga barbers) e search_customers.
-- SPEC §2, §3.7, §6.2. I dati sono creati dal test (come postgres) e annullati dal rollback.
-- Non modificare durante l'implementazione.
--
-- Convenzione per le scritture negate: zero righe toccate, permesso negato (42501), eccezione di
-- un trigger (P0001) o violazione di check (23514). Qualsiasi altro esito fa fallire il test.
begin;
create extension if not exists pgtap with schema extensions;

select plan(98);

create function pg_temp.outcome(q text) returns text language plpgsql as $f$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return 'rows:' || n;
exception when others then
  return sqlstate;
end $f$;

-- Come outcome, ma annulla la scrittura riuscita (sottotransazione): verifica che sia ammessa
-- senza cambiare i dati usati dai test successivi. Aggiunto con la fetta 6 (decisione 3).
create function pg_temp.outcome_undone(q text) returns text language plpgsql as $f$
declare n bigint;
begin
  begin
    execute q;
    get diagnostics n = row_count;
    raise exception using errcode = 'QA001', message = 'rows:' || n;
  exception when sqlstate 'QA001' then
    return sqlerrm;
  end;
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
select pg_temp.mk_user('b0000000-0000-4000-8000-000000000401', 'brb-b1@qa.test', 'barber', 'Zzstaffqa Barbiere Uno', '+390400000001');
select pg_temp.mk_user('b0000000-0000-4000-8000-000000000402', 'brb-b2@qa.test', 'barber', 'Zzstaffqa Barbiere Due', '+390400000002');
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000401', 'brb-admin@qa.test', 'admin', 'Zzstaffqa Titolare', '+390400000003');
select pg_temp.mk_user('c0000000-0000-4000-8000-000000000401', 'brb-c1@qa.test', 'customer', 'Qaone Cliente Uno', '+390400111001');
select pg_temp.mk_user('c0000000-0000-4000-8000-000000000402', 'brb-c2@qa.test', 'customer', 'Qaone Cliente Due', '+390400111002');
select pg_temp.mk_user('c0000000-0000-4000-8000-000000000403', 'brb-c3@qa.test', 'customer', 'Qaone Cliente Tre', '+390400777003');
select pg_temp.mk_user('c0000000-0000-4000-8000-000000000404', 'brb-c4@qa.test', 'customer', 'Qafour Cliente Quattro', '+39 377 5550461');
select pg_temp.mk_user('c0000000-0000-4000-8000-000000000405', 'brb-c5@qa.test', 'customer', 'Qafive Cliente Cinque', '366 808 4567');
-- 12 clienti per il limite di 10 risultati
select pg_temp.mk_user(('c0000000-0000-4000-8000-0000000004' || lpad((10 + g)::text, 2, '0'))::uuid,
                       'brb-many' || g || '@qa.test', 'customer', 'Zzmanyqa Cliente ' || g, '+39040055500' || g)
  from generate_series(1, 12) g;

insert into public.shop_settings (name) values ('QA shop') on conflict do nothing;
update public.shop_settings set buffer_min = 0;

insert into public.services (id, name, description, duration_min, price_cents, is_active, sort_order) values
  ('5e000000-0000-4000-8000-000000000401', 'Brb Taglio', null, 30, 2500, true, 901),
  ('5e000000-0000-4000-8000-000000000402', 'Brb Disattivato', null, 30, 2500, false, 902);

insert into public.barbers (id, display_name, is_active, profile_id) values
  ('ba000000-0000-4000-8000-000000000401', 'Brb Uno', true, 'b0000000-0000-4000-8000-000000000401'),
  ('ba000000-0000-4000-8000-000000000402', 'Brb Due', true, 'b0000000-0000-4000-8000-000000000402'),
  ('ba000000-0000-4000-8000-000000000403', 'Brb Disattivato', false, null);

insert into public.barber_services (barber_id, service_id) values
  ('ba000000-0000-4000-8000-000000000401', '5e000000-0000-4000-8000-000000000401'),
  ('ba000000-0000-4000-8000-000000000402', '5e000000-0000-4000-8000-000000000401');

insert into public.working_hours (id, barber_id, weekday, start_time, end_time) values
  ('a0a00000-0000-4000-8000-000000000401', 'ba000000-0000-4000-8000-000000000401', 1, '09:00', '13:00'),
  ('a0a00000-0000-4000-8000-000000000402', 'ba000000-0000-4000-8000-000000000402', 1, '09:00', '13:00');

insert into public.time_off (id, barber_id, starts_at, ends_at, reason) values
  ('70ff0000-0000-4000-8000-000000000401', 'ba000000-0000-4000-8000-000000000401', '2040-02-04 10:00+01', '2040-02-04 11:00+01', 'mio permesso'),
  ('70ff0000-0000-4000-8000-000000000402', 'ba000000-0000-4000-8000-000000000402', '2040-02-04 10:00+01', '2040-02-04 11:00+01', 'permesso altrui');

insert into public.shop_closures (id, starts_at, ends_at, reason) values
  ('c1050000-0000-4000-8000-000000000401', '2040-12-25 00:00+01', '2040-12-26 00:00+01', 'Natale');

-- Prenotazioni del barbiere 1: passate (2024-01-08) 401 09:00, 403 10:00, 404 11:00 (ospite);
-- futura (2040-01-07) 405 12:00. completed e no_show sono ammessi solo su prenotazioni già iniziate.
-- Prenotazione del barbiere 2: 402 (cliente c2, che non ha mai prenotato con il barbiere 1).
insert into public.bookings (id, customer_id, guest_name, guest_phone, barber_id, service_id, starts_at, source) values
  ('b00c0000-0000-4000-8000-000000000401', 'c0000000-0000-4000-8000-000000000401', null, null, 'ba000000-0000-4000-8000-000000000401', '5e000000-0000-4000-8000-000000000401', '2024-01-08 09:00+01', 'online'),
  ('b00c0000-0000-4000-8000-000000000403', 'c0000000-0000-4000-8000-000000000401', null, null, 'ba000000-0000-4000-8000-000000000401', '5e000000-0000-4000-8000-000000000401', '2024-01-08 10:00+01', 'online'),
  ('b00c0000-0000-4000-8000-000000000404', null, 'Brb Ospite', '+390400999001', 'ba000000-0000-4000-8000-000000000401', '5e000000-0000-4000-8000-000000000401', '2024-01-08 11:00+01', 'manual'),
  ('b00c0000-0000-4000-8000-000000000405', 'c0000000-0000-4000-8000-000000000401', null, null, 'ba000000-0000-4000-8000-000000000401', '5e000000-0000-4000-8000-000000000401', '2040-01-07 12:00+01', 'online'),
  ('b00c0000-0000-4000-8000-000000000402', 'c0000000-0000-4000-8000-000000000402', null, null, 'ba000000-0000-4000-8000-000000000402', '5e000000-0000-4000-8000-000000000401', '2040-01-07 09:00+01', 'online');

-- ===========================================================================
-- BARBER (barbiere 1)
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'b0000000-0000-4000-8000-000000000401', 'role', 'authenticated')::text, true);

select is(public.current_user_role()::text, 'barber', 'barber – SPEC §2: current_user_role() = barber');
select is(public.is_staff(), true, 'barber – SPEC §2: is_staff() = true');
select is(public.is_admin(), false, 'barber – SPEC §2: is_admin() = false');

-- ---------------------------------------------------------------------------
-- SPEC §2: "vede il proprio calendario"
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from public.bookings where barber_id = 'ba000000-0000-4000-8000-000000000401'),
  4::bigint, 'barber – SPEC §2: vede le prenotazioni del proprio calendario');
select is(
  (select count(*) from public.bookings where barber_id <> 'ba000000-0000-4000-8000-000000000401'),
  0::bigint, 'barber – SPEC §2: non vede le prenotazioni degli altri barbieri');

-- ---------------------------------------------------------------------------
-- SPEC §2 / §3.7.4: profili visibili = il proprio + i clienti con almeno una prenotazione con lui
-- ---------------------------------------------------------------------------
select is((select count(*) from public.profiles where id = 'b0000000-0000-4000-8000-000000000401'),
  1::bigint, 'barber: vede il proprio profilo');
select is((select count(*) from public.profiles where id = 'c0000000-0000-4000-8000-000000000401'),
  1::bigint, 'barber – SPEC §6.2: vede il profilo di un cliente che ha prenotato con lui');
select is(
  (select count(*) from public.profiles
    where id in ('c0000000-0000-4000-8000-000000000402', 'c0000000-0000-4000-8000-000000000403')),
  0::bigint, 'barber – SPEC §3.7.4: non vede i profili dei clienti senza prenotazioni con lui');
select is((select count(*) from public.profiles), 2::bigint,
  'barber – SPEC §3.7.4: nessun altro profilo visibile (altri barbieri, admin, altri clienti)');

select matches(
  pg_temp.outcome($q$ update public.profiles set full_name = 'hacked' where id = 'c0000000-0000-4000-8000-000000000401' $q$),
  '^(rows:0|42501|P0001)$', 'barber: non aggiorna il profilo di un suo cliente');
select matches(
  pg_temp.outcome($q$ update public.profiles set is_blocked = true where id = 'c0000000-0000-4000-8000-000000000401' $q$),
  '^(rows:0|42501|P0001)$', 'barber – SPEC §6.7: non può bloccare un cliente');
select matches(
  pg_temp.outcome($q$ update public.profiles set full_name = 'hacked' where id = 'c0000000-0000-4000-8000-000000000403' $q$),
  '^(rows:0|42501|P0001)$', 'barber: non aggiorna il profilo di un cliente qualsiasi');
select throws_ok(
  $q$ update public.profiles set role = 'admin' where id = 'b0000000-0000-4000-8000-000000000401' $q$,
  '42501', null, 'barber – SPEC §2: non può promuoversi admin (42501)');
select throws_ok(
  $q$ update public.profiles set is_blocked = true where id = 'b0000000-0000-4000-8000-000000000401' $q$,
  '42501', null, 'barber: non può modificare is_blocked nemmeno sul proprio profilo (42501)');

-- ---------------------------------------------------------------------------
-- SPEC §6.2: search_customers
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(s.id::text order by s.full_name) from public.search_customers('qaone') s),
  array['c0000000-0000-4000-8000-000000000402', 'c0000000-0000-4000-8000-000000000403',
        'c0000000-0000-4000-8000-000000000401'],
  'barber – SPEC §6.2: search_customers cerca per nome (senza distinzione maiuscole) anche fra clienti mai serviti');
select is(
  (select array_agg(s.id::text) from public.search_customers('0400777003') s),
  array['c0000000-0000-4000-8000-000000000403'],
  'barber – SPEC §6.2: search_customers cerca per telefono');
select is(
  (select array_agg(k order by k)
     from (select to_jsonb(s) as j from public.search_customers('0400777003') s limit 1) r,
          jsonb_object_keys(r.j) k),
  array['full_name', 'id', 'phone'],
  'barber – SPEC §3.7.4: search_customers restituisce solo id, full_name, phone');
select is((select count(*) from public.search_customers('zzmanyqa')), 10::bigint,
  'barber – SPEC §6.2: search_customers restituisce al massimo 10 risultati');
select is((select count(*) from public.search_customers('zzstaffqa')), 0::bigint,
  'barber – SPEC §6.2: search_customers cerca solo fra i profili con role customer');
select is(pg_temp.outcome($q$ select * from public.search_customers('qa') $q$), 'rows:0',
  'barber – SPEC §3.7.4: search_customers con meno di 3 caratteri restituisce zero righe, senza eccezione');
select is(pg_temp.outcome($q$ select * from public.search_customers('') $q$), 'rows:0',
  'barber – SPEC §3.7.4: search_customers con stringa vuota restituisce zero righe');
select is(pg_temp.outcome($q$ select * from public.search_customers('   qa   ') $q$), 'rows:0',
  'barber – SPEC §3.7.4: i 3 caratteri minimi si contano dopo il trim');
select is(pg_temp.outcome($q$ select * from public.search_customers('  qaone  ') $q$), 'rows:3',
  'barber – SPEC §6.2: search_customers ignora gli spazi iniziali e finali');
select is(
  (select array_agg(s.id::text) from public.search_customers('377 55-50') s),
  array['c0000000-0000-4000-8000-000000000404'],
  'barber – SPEC §6.2: il telefono si confronta sulle sole cifre (q "377 55-50" trova "+39 377 5550461")');
select is(
  (select array_agg(s.id::text) from public.search_customers('3668084') s),
  array['c0000000-0000-4000-8000-000000000405'],
  'barber – SPEC §6.2: il telefono si confronta sulle sole cifre (q "3668084" trova "366 808 4567")');

-- ---------------------------------------------------------------------------
-- SPEC §2: "crea prenotazioni manuali per sé"
-- ---------------------------------------------------------------------------
select is(
  pg_temp.outcome($q$ insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, source)
    values ('Brb Walkin', '+390400999002', 'ba000000-0000-4000-8000-000000000401',
            '5e000000-0000-4000-8000-000000000401', '2040-01-07 14:00+01', 'manual') $q$),
  'rows:1', 'barber – SPEC §2: crea una prenotazione manuale per sé (ospite)');
select is(
  pg_temp.outcome($q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source, price_cents, duration_min)
    values ('c0000000-0000-4000-8000-000000000403', 'ba000000-0000-4000-8000-000000000401',
            '5e000000-0000-4000-8000-000000000401', '2040-01-07 15:00+01', 'manual', 1, 5) $q$),
  'rows:1', 'barber – SPEC §6.2: crea una prenotazione manuale per un cliente trovato con la ricerca');
select is(
  (select row(price_cents, duration_min, ends_at)::text from public.bookings
    where barber_id = 'ba000000-0000-4000-8000-000000000401' and starts_at = '2040-01-07 15:00+01'),
  row(2500, 30, '2040-01-07 15:30+01'::timestamptz)::text,
  'barber – SPEC §3.6: prezzo e durata passati dal barbiere sono sovrascritti dal trigger');
select is((select count(*) from public.profiles where id = 'c0000000-0000-4000-8000-000000000403'),
  1::bigint, 'barber: dopo la prenotazione vede il profilo del nuovo cliente');
select ok(
  (select status_changed_by = 'b0000000-0000-4000-8000-000000000401' and status_changed_at = created_at
     from public.bookings
    where barber_id = 'ba000000-0000-4000-8000-000000000401' and starts_at = '2040-01-07 14:00+01'),
  'barber – SPEC §3.6: all''insert status_changed_by = id di chi inserisce e status_changed_at = created_at');
select is(
  pg_temp.outcome($q$ insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, source,
                                                   status_changed_by, status_changed_at)
    values ('Brb Walkin Due', '+390400999003', 'ba000000-0000-4000-8000-000000000401',
            '5e000000-0000-4000-8000-000000000401', '2040-01-07 17:00+01', 'manual',
            'a0000000-0000-4000-8000-000000000401', '2000-01-01 00:00+00') $q$),
  'rows:1', 'barber – SPEC §3.6: insert manuale con status_changed_* falsificati accettato...');
select ok(
  (select status_changed_by = 'b0000000-0000-4000-8000-000000000401' and status_changed_at = created_at
     from public.bookings
    where barber_id = 'ba000000-0000-4000-8000-000000000401' and starts_at = '2040-01-07 17:00+01'),
  'barber – SPEC §3.6: ...ma status_changed_by/at passati in insert sono sovrascritti');
select matches(
  pg_temp.outcome($q$ insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, source)
    values ('Brb Walkin', '+390400999002', 'ba000000-0000-4000-8000-000000000401',
            '5e000000-0000-4000-8000-000000000401', '2040-01-07 16:00+01', 'online') $q$),
  '^(42501|P0001|23514)$', 'barber – SPEC §2: non può inserire prenotazioni con source online');
select matches(
  pg_temp.outcome($q$ insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, source)
    values ('Brb Walkin', '+390400999002', 'ba000000-0000-4000-8000-000000000402',
            '5e000000-0000-4000-8000-000000000401', '2040-01-07 16:00+01', 'manual') $q$),
  '^(42501|P0001|23514)$', 'barber – SPEC §2: non può inserire prenotazioni per un altro barbiere');
select is(
  pg_temp.outcome($q$ insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, source)
    values ('Brb Walkin', '+390400999002', 'ba000000-0000-4000-8000-000000000401',
            '5e000000-0000-4000-8000-000000000401', '2040-01-07 14:15+01', 'manual') $q$),
  '23P01', 'barber – SPEC §3.7.5: la prenotazione manuale non può sovrapporsi (23P01)');

-- ---------------------------------------------------------------------------
-- SPEC §2 / §3.6: "segna completata / no-show" – transizioni di stato
-- ---------------------------------------------------------------------------
select is(
  pg_temp.outcome($q$ update public.bookings set status = 'completed' where id = 'b00c0000-0000-4000-8000-000000000401' $q$),
  'rows:1', 'barber – SPEC §3.6: confirmed → completed (prenotazione già iniziata)');
select ok(
  (select status_changed_by = 'b0000000-0000-4000-8000-000000000401' and status_changed_at >= now()
     from public.bookings where id = 'b00c0000-0000-4000-8000-000000000401'),
  'barber – SPEC §3.6: dopo il cambio di stato status_changed_by = id del barbiere e status_changed_at valorizzato');
select is(
  pg_temp.outcome($q$ update public.bookings set status = 'no_show' where id = 'b00c0000-0000-4000-8000-000000000403' $q$),
  'rows:1', 'barber – SPEC §3.6: confirmed → no_show (prenotazione già iniziata)');
select is((select no_show_count from public.profiles where id = 'c0000000-0000-4000-8000-000000000401'),
  1, 'barber – SPEC §6.7: il no_show segnato dal barbiere incrementa no_show_count del cliente');
select is(
  pg_temp.outcome($q$ update public.bookings
                         set status = 'cancelled_by_shop',
                             status_changed_by = 'a0000000-0000-4000-8000-000000000401',
                             status_changed_at = '2000-01-01 00:00+00'
                       where id = 'b00c0000-0000-4000-8000-000000000404' $q$),
  'rows:1', 'barber – SPEC §3.6: confirmed → cancelled_by_shop (con status_changed_* falsificati)');
select ok(
  (select status_changed_by = 'b0000000-0000-4000-8000-000000000401' and status_changed_at >= now()
     from public.bookings where id = 'b00c0000-0000-4000-8000-000000000404'),
  'barber – SPEC §3.6: status_changed_by/at passati dal client sono sovrascritti dal trigger');
select matches(
  pg_temp.outcome($q$ update public.bookings set status = 'completed' where id = 'b00c0000-0000-4000-8000-000000000405' $q$),
  '^(42501|P0001|23514)$', 'barber – SPEC §3.6: completed rifiutato su una prenotazione futura');
select matches(
  pg_temp.outcome($q$ update public.bookings set status = 'no_show' where id = 'b00c0000-0000-4000-8000-000000000405' $q$),
  '^(42501|P0001|23514)$', 'barber – SPEC §3.6: no_show rifiutato su una prenotazione futura');
-- Fetta 6, decisione 3 approvata dall'utente: il barbiere può segnare cancelled_by_customer sulle
-- proprie prenotazioni (prima era rifiutato). La scrittura viene annullata: 405 resta confirmed.
select is(
  pg_temp.outcome_undone($q$ update public.bookings set status = 'cancelled_by_customer' where id = 'b00c0000-0000-4000-8000-000000000405' $q$),
  'rows:1', 'barber – fetta 6 (decisione 3): confirmed → cancelled_by_customer ammesso sulle proprie');
select matches(
  pg_temp.outcome($q$ update public.bookings set status = 'confirmed' where id = 'b00c0000-0000-4000-8000-000000000401' $q$),
  '^(rows:0|42501|P0001|23514)$', 'barber – SPEC §3.6: completed → confirmed non ammesso (stato finale)');
select matches(
  pg_temp.outcome($q$ update public.bookings set status = 'no_show' where id = 'b00c0000-0000-4000-8000-000000000401' $q$),
  '^(rows:0|42501|P0001|23514)$', 'barber – SPEC §3.6: completed → no_show non ammesso (stato finale)');
select matches(
  pg_temp.outcome($q$ update public.bookings set status = 'completed' where id = 'b00c0000-0000-4000-8000-000000000403' $q$),
  '^(rows:0|42501|P0001|23514)$', 'barber – SPEC §3.6: no_show → completed non ammesso (stato finale)');
select matches(
  pg_temp.outcome($q$ update public.bookings set status = 'confirmed' where id = 'b00c0000-0000-4000-8000-000000000404' $q$),
  '^(rows:0|42501|P0001|23514)$', 'barber – SPEC §3.6: cancelled_by_shop → confirmed non ammesso (stato finale)');
select is(
  (select array_agg(status::text order by id) from public.bookings
    where id in ('b00c0000-0000-4000-8000-000000000401', 'b00c0000-0000-4000-8000-000000000403',
                 'b00c0000-0000-4000-8000-000000000404', 'b00c0000-0000-4000-8000-000000000405')),
  array['completed', 'no_show', 'cancelled_by_shop', 'confirmed'],
  'barber – SPEC §3.6: stati finali dopo le transizioni');
select is((select no_show_count from public.profiles where id = 'c0000000-0000-4000-8000-000000000401'),
  1, 'barber – SPEC §6.7: i tentativi rifiutati non alterano no_show_count');

-- ---------------------------------------------------------------------------
-- SPEC §3.6: il barbiere non altera i dati copiati né sposta la prenotazione (405, confirmed)
-- ---------------------------------------------------------------------------
select matches(
  pg_temp.outcome($q$ update public.bookings set price_cents = 1 where id = 'b00c0000-0000-4000-8000-000000000405' $q$),
  '^(rows:0|42501|P0001|23514)$', 'barber – SPEC §3.6: non modifica price_cents');
select matches(
  pg_temp.outcome($q$ update public.bookings set duration_min = 5 where id = 'b00c0000-0000-4000-8000-000000000405' $q$),
  '^(rows:0|42501|P0001|23514)$', 'barber – SPEC §3.6: non modifica duration_min');
select matches(
  pg_temp.outcome($q$ update public.bookings set buffer_min = 0 + 7 where id = 'b00c0000-0000-4000-8000-000000000405' $q$),
  '^(rows:0|42501|P0001|23514)$', 'barber – SPEC §3.6: non modifica buffer_min');
select matches(
  pg_temp.outcome($q$ update public.bookings set customer_id = 'c0000000-0000-4000-8000-000000000403' where id = 'b00c0000-0000-4000-8000-000000000405' $q$),
  '^(rows:0|42501|P0001|23514)$', 'barber – SPEC §3.6: non modifica customer_id');
select matches(
  pg_temp.outcome($q$ update public.bookings set starts_at = '2040-01-07 17:00+01' where id = 'b00c0000-0000-4000-8000-000000000405' $q$),
  '^(rows:0|42501|P0001|23514)$', 'barber – SPEC §6.3: non modifica starts_at (lo spostamento è dell''admin)');
select matches(
  pg_temp.outcome($q$ update public.bookings set ends_at = '2040-01-07 12:45+01' where id = 'b00c0000-0000-4000-8000-000000000405' $q$),
  '^(rows:0|42501|P0001|23514)$', 'barber – SPEC §3.6: non modifica ends_at');
select matches(
  pg_temp.outcome($q$ update public.bookings set barber_id = 'ba000000-0000-4000-8000-000000000402' where id = 'b00c0000-0000-4000-8000-000000000405' $q$),
  '^(rows:0|42501|P0001|23514)$', 'barber – SPEC §6.3: non riassegna la prenotazione a un altro barbiere');

-- Prenotazioni degli altri barbieri e delete
select matches(
  pg_temp.outcome($q$ update public.bookings set status = 'completed' where id = 'b00c0000-0000-4000-8000-000000000402' $q$),
  '^(rows:0|42501)$', 'barber – SPEC §2: non aggiorna le prenotazioni di un altro barbiere');
select matches(
  pg_temp.outcome($q$ delete from public.bookings where id = 'b00c0000-0000-4000-8000-000000000405' $q$),
  '^(rows:0|42501|P0001)$', 'barber: nessun DELETE sulle proprie prenotazioni');
select matches(
  pg_temp.outcome($q$ delete from public.bookings $q$),
  '^(rows:0|42501|P0001)$', 'barber: nessun DELETE su bookings');

-- ---------------------------------------------------------------------------
-- SPEC §2 / §3.5: "gestisce le proprie assenze"
-- ---------------------------------------------------------------------------
select is((select count(*) from public.time_off where barber_id = 'ba000000-0000-4000-8000-000000000401'),
  1::bigint, 'barber – SPEC §2: vede le proprie assenze');
select is((select count(*) from public.time_off where barber_id <> 'ba000000-0000-4000-8000-000000000401'),
  0::bigint, 'barber – SPEC §2: non vede le assenze degli altri barbieri');
select is(
  pg_temp.outcome($q$ insert into public.time_off (id, barber_id, starts_at, ends_at, reason)
    values ('70ff0000-0000-4000-8000-000000000403', 'ba000000-0000-4000-8000-000000000401',
            '2040-03-04 00:00+01', '2040-03-11 00:00+01', 'ferie') $q$),
  'rows:1', 'barber – SPEC §2: inserisce una propria assenza (senza approvazione)');
select is(
  pg_temp.outcome($q$ update public.time_off set reason = 'ferie estive' where id = '70ff0000-0000-4000-8000-000000000403' $q$),
  'rows:1', 'barber – SPEC §2: modifica una propria assenza');
select is(
  pg_temp.outcome($q$ delete from public.time_off where id = '70ff0000-0000-4000-8000-000000000403' $q$),
  'rows:1', 'barber – SPEC §2: elimina una propria assenza');
select matches(
  pg_temp.outcome($q$ insert into public.time_off (barber_id, starts_at, ends_at, reason)
    values ('ba000000-0000-4000-8000-000000000402', '2040-03-04 00:00+01', '2040-03-11 00:00+01', 'x') $q$),
  '^(42501|P0001)$', 'barber – SPEC §2: non inserisce assenze per un altro barbiere');
select matches(
  pg_temp.outcome($q$ update public.time_off set reason = 'hacked' where id = '70ff0000-0000-4000-8000-000000000402' $q$),
  '^(rows:0|42501|P0001)$', 'barber – SPEC §2: non modifica le assenze di un altro barbiere');
select matches(
  pg_temp.outcome($q$ update public.time_off set barber_id = 'ba000000-0000-4000-8000-000000000402' where id = '70ff0000-0000-4000-8000-000000000401' $q$),
  '^(rows:0|42501|P0001)$', 'barber – SPEC §2: non riassegna una propria assenza a un altro barbiere');
select matches(
  pg_temp.outcome($q$ delete from public.time_off where id = '70ff0000-0000-4000-8000-000000000402' $q$),
  '^(rows:0|42501|P0001)$', 'barber – SPEC §2: non elimina le assenze di un altro barbiere');

-- ---------------------------------------------------------------------------
-- SPEC §2: orari, chiusure, catalogo e impostazioni sono dell'admin
-- ---------------------------------------------------------------------------
select is((select count(*) from public.working_hours where barber_id = 'ba000000-0000-4000-8000-000000000401'),
  1::bigint, 'barber – SPEC §3.4: vede i propri orari di lavoro');
select is((select count(*) from public.working_hours where id = 'a0a00000-0000-4000-8000-000000000402'),
  1::bigint, 'barber – SPEC §3.4: legge anche gli orari di lavoro degli altri barbieri');
select matches(
  pg_temp.outcome($q$ update public.working_hours set end_time = '20:00' where id = 'a0a00000-0000-4000-8000-000000000402' $q$),
  '^(rows:0|42501|P0001)$', 'barber – SPEC §2: non modifica gli orari di lavoro degli altri barbieri');
select matches(
  pg_temp.outcome($q$ insert into public.working_hours (barber_id, weekday, start_time, end_time)
    values ('ba000000-0000-4000-8000-000000000401', 2, '09:00', '13:00') $q$),
  '^(42501|P0001)$', 'barber – SPEC §2: non inserisce orari di lavoro');
select matches(
  pg_temp.outcome($q$ update public.working_hours set end_time = '20:00' where id = 'a0a00000-0000-4000-8000-000000000401' $q$),
  '^(rows:0|42501|P0001)$', 'barber – SPEC §2: non modifica i propri orari di lavoro');
select matches(
  pg_temp.outcome($q$ delete from public.working_hours where id = 'a0a00000-0000-4000-8000-000000000401' $q$),
  '^(rows:0|42501|P0001)$', 'barber – SPEC §2: non elimina i propri orari di lavoro');

select is((select count(*) from public.shop_closures where id = 'c1050000-0000-4000-8000-000000000401'),
  1::bigint, 'barber – SPEC §3.5: vede le chiusure del negozio');
select matches(
  pg_temp.outcome($q$ insert into public.shop_closures (starts_at, ends_at, reason) values ('2040-08-01 00:00+02', '2040-08-02 00:00+02', 'x') $q$),
  '^(42501|P0001)$', 'barber – SPEC §2: non inserisce chiusure');
select matches(
  pg_temp.outcome($q$ update public.shop_closures set reason = 'hacked' where id = 'c1050000-0000-4000-8000-000000000401' $q$),
  '^(rows:0|42501|P0001)$', 'barber – SPEC §2: non modifica chiusure');
select matches(
  pg_temp.outcome($q$ delete from public.shop_closures where id = 'c1050000-0000-4000-8000-000000000401' $q$),
  '^(rows:0|42501|P0001)$', 'barber – SPEC §2: non elimina chiusure');

select is((select count(*) from public.shop_settings), 1::bigint, 'barber: legge shop_settings');
select is((select count(*) from public.services where id = '5e000000-0000-4000-8000-000000000401'),
  1::bigint, 'barber: legge i servizi');
select is(
  (select count(*) from public.barbers
    where id in ('ba000000-0000-4000-8000-000000000401', 'ba000000-0000-4000-8000-000000000402')),
  2::bigint, 'barber: legge i barbieri');
select is((select count(*) from public.barber_services where service_id = '5e000000-0000-4000-8000-000000000401'),
  2::bigint, 'barber: legge barber_services');
select is((select count(*) from public.services where id = '5e000000-0000-4000-8000-000000000402'),
  1::bigint, 'barber – SPEC §3.2: legge anche i servizi disattivati');
select is((select count(*) from public.barbers where id = 'ba000000-0000-4000-8000-000000000403'),
  1::bigint, 'barber – SPEC §3.3: legge anche i barbieri disattivati');
select matches(pg_temp.outcome($q$ update public.shop_settings set buffer_min = 30 $q$),
  '^(rows:0|42501|P0001)$', 'barber – SPEC §2: non modifica shop_settings');
select matches(pg_temp.outcome($q$ insert into public.services (name, duration_min, price_cents, is_active, sort_order) values ('Brb x', 10, 100, true, 999) $q$),
  '^(42501|P0001)$', 'barber – SPEC §2: non inserisce servizi');
select matches(pg_temp.outcome($q$ update public.services set price_cents = 1 where id = '5e000000-0000-4000-8000-000000000401' $q$),
  '^(rows:0|42501|P0001)$', 'barber – SPEC §2: non modifica servizi');
select matches(pg_temp.outcome($q$ update public.barbers set display_name = 'hacked' where id = 'ba000000-0000-4000-8000-000000000401' $q$),
  '^(rows:0|42501|P0001)$', 'barber – SPEC §2: non modifica la propria riga barbers');
select matches(pg_temp.outcome($q$ insert into public.barbers (display_name, is_active) values ('Brb x', true) $q$),
  '^(42501|P0001)$', 'barber – SPEC §2: non inserisce barbieri');
select matches(pg_temp.outcome($q$ delete from public.barber_services where barber_id = 'ba000000-0000-4000-8000-000000000401' $q$),
  '^(rows:0|42501|P0001)$', 'barber – SPEC §2: non elimina barber_services');

-- ---------------------------------------------------------------------------
-- Verifica finale come postgres
-- ---------------------------------------------------------------------------
reset role;
select is(
  (select row(status, price_cents, duration_min, buffer_min, customer_id, barber_id, starts_at, ends_at)::text
     from public.bookings where id = 'b00c0000-0000-4000-8000-000000000405'),
  row('confirmed'::public.booking_status, 2500, 30, 0, 'c0000000-0000-4000-8000-000000000401'::uuid,
      'ba000000-0000-4000-8000-000000000401'::uuid, '2040-01-07 12:00+01'::timestamptz,
      '2040-01-07 12:30+01'::timestamptz)::text,
  'barber – SPEC §3.6: la prenotazione che ha provato ad alterare è invariata');
select is(
  (select status::text from public.bookings where id = 'b00c0000-0000-4000-8000-000000000402'),
  'confirmed', 'barber: la prenotazione dell''altro barbiere è invariata');
select is(
  (select count(*) from public.bookings where barber_id = 'ba000000-0000-4000-8000-000000000402'),
  1::bigint, 'barber: nessuna prenotazione creata per l''altro barbiere');
select is(
  (select count(*) from public.bookings
    where barber_id = 'ba000000-0000-4000-8000-000000000401' and source = 'online'),
  3::bigint, 'barber: nessuna prenotazione online creata dal barbiere');
select is(
  (select row(p1.full_name, p1.is_blocked, p3.full_name, pb.role)::text
     from public.profiles p1, public.profiles p3, public.profiles pb
    where p1.id = 'c0000000-0000-4000-8000-000000000401'
      and p3.id = 'c0000000-0000-4000-8000-000000000403'
      and pb.id = 'b0000000-0000-4000-8000-000000000401'),
  row('Qaone Cliente Uno'::text, false, 'Qaone Cliente Tre'::text, 'barber'::public.user_role)::text,
  'barber: i profili sono invariati');
select is(
  (select row(t.reason, t.barber_id, w.end_time, c.reason)::text
     from public.time_off t, public.working_hours w, public.shop_closures c
    where t.id = '70ff0000-0000-4000-8000-000000000402'
      and w.id = 'a0a00000-0000-4000-8000-000000000401'
      and c.id = 'c1050000-0000-4000-8000-000000000401'),
  row('permesso altrui'::text, 'ba000000-0000-4000-8000-000000000402'::uuid, '13:00'::time, 'Natale'::text)::text,
  'barber: assenze altrui, orari e chiusure invariati');
select is(
  (select row(s.buffer_min, sv.price_cents, b.display_name)::text
     from public.shop_settings s, public.services sv, public.barbers b
    where sv.id = '5e000000-0000-4000-8000-000000000401' and b.id = 'ba000000-0000-4000-8000-000000000401'),
  row(0, 2500, 'Brb Uno'::text)::text,
  'barber: impostazioni e catalogo invariati');

select * from finish();
rollback;
