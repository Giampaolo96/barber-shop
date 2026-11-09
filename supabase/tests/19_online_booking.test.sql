-- Fetta 8h: modifica approvata dall'utente il 2026-11-08 (amr password nei claim staff / nome della RPC), nessuna asserzione cambiata.
-- Test di accettazione – FETTA 5 (SPEC §11: "Flusso prenotazione cliente + Le mie prenotazioni").
-- 19 – Prenotazione e cancellazione online nel database: online_slot_error, create_online_booking,
-- cancel_own_booking, visibilità di servizi e barbieri disattivati collegati alle proprie prenotazioni.
-- SPEC §3.6, §3.7 (regole 1–4), §4, §8 (rate limiting), §12; ADR 001 (scritture del cliente solo
-- tramite funzioni security definer), ADR 004 (griglia, anticipo, orizzonte, buffer, assegnazione).
--
-- Interfaccia attesa (decisioni approvate per la fetta 5):
--   public.online_slot_error(p_service_id uuid, p_barber_id uuid, p_starts_at timestamptz) returns text
--     security definer; execute solo ad authenticated. null = slot valido e libero, altrimenti uno fra
--     service_unavailable, not_aligned, too_soon, too_far, closed, barber_unavailable,
--     outside_hours, unavailable (assenza del barbiere o orario occupato, senza distinguerli:
--     review fetta 5, il cliente non deve dedurre le assenze).
--   public.create_online_booking(p_service_id uuid, p_barber_id uuid, p_starts_at timestamptz,
--     p_notes text) returns uuid
--     security definer; execute solo ad authenticated. Errori: raise exception '<codice>' using
--     errcode = 'P0001'. p_barber_id null = "Nessuna preferenza".
--   public.cancel_own_booking(p_booking_id uuid) returns void
--     security definer; execute solo ad authenticated. Errori P0001: not_customer, not_found,
--     not_cancellable, too_late.
--
-- Note:
--   - now() è fisso per tutta la transazione: i bordi (anticipo, limite di cancellazione) sono esatti
--     quando la funzione usa now(), come previsto dalle decisioni.
--   - L'anticipo minimo con il bordo esattamente uguale (inizio = now() + anticipo) non è riproducibile
--     qui (now() ha secondi e microsecondi, gli slot no): si verifica il valore appena sotto e appena
--     sopra il minuto. Il bordo esatto è coperto dal motore (availability-engine.test.ts).
--   - Concorrenza: questo file verifica SOLO che create_online_booking prenda il lock advisory di
--     transazione per cliente. L'effetto in una gara reale fra due sessioni è verificato in
--     tests/acceptance/booking-db.test.ts (Promise.all sul DB locale).
--   - Ogni caso d'errore viola una sola regola.
-- I dati sono creati dal test e annullati dal rollback. Non modificare durante l'implementazione.
begin;
create extension if not exists pgtap with schema extensions;

select plan(100);

-- ---------------------------------------------------------------------------
-- Helper
-- ---------------------------------------------------------------------------
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

-- authenticated senza utente (token senza sub): auth.uid() è null
create function pg_temp.act_as_nouser() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  set local role authenticated;
end $f$;

create function pg_temp.act_as_anon() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;

create function pg_temp.act_as_postgres() returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $f$;

create function pg_temp.fn(fname text) returns oid language sql as $f$
  select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = fname
$f$;

create function pg_temp.can_exec(r text, sig text) returns boolean language plpgsql as $f$
begin
  return has_function_privilege(r, sig, 'execute');
exception when others then
  return null;
end $f$;

-- EXECUTE concesso a PUBLIC (grantee 0)?
create function pg_temp.public_exec(fname text) returns boolean language sql as $f$
  select coalesce(bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE'), false)
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.oid = pg_temp.fn(fname)
$f$;

-- security definer con search_path fissato a ''
create function pg_temp.definer_fixed_path(fname text) returns boolean language sql as $f$
  select coalesce((select p.prosecdef
                      and exists (select 1 from unnest(p.proconfig) c where c ~ '^search_path=("")?$')
                     from pg_proc p where p.oid = pg_temp.fn(fname)), false)
$f$;

-- online_slot_error con il ruolo corrente; 'missing' se la funzione non esiste
create function pg_temp.ose(s uuid, b uuid, t timestamptz) returns text language plpgsql as $f$
declare r text;
begin
  execute 'select public.online_slot_error($1, $2, $3)' into r using s, b, t;
  return r;
exception
  when undefined_function then return 'missing';
  when others then return 'ERR ' || sqlstate || ': ' || sqlerrm;
end $f$;

-- create_online_booking con il ruolo corrente. Restituisce 'ok' e salva l'id in f5.<k>,
-- altrimenti il codice e il messaggio dell'errore (così il test fallisce mostrando la causa).
create function pg_temp.book(k text, s uuid, b uuid, t timestamptz, n text default null)
returns text language plpgsql as $f$
declare new_id uuid;
begin
  execute 'select public.create_online_booking($1, $2, $3, $4)' into new_id using s, b, t, n;
  perform set_config('f5.' || k, coalesce(new_id::text, ''), true);
  return case when new_id is null then 'id null' else 'ok' end;
exception when others then
  perform set_config('f5.' || k, '', true);
  return sqlstate || ': ' || sqlerrm;
end $f$;

create function pg_temp.bid(k text) returns uuid language sql stable as $f$
  select nullif(current_setting('f5.' || k, true), '')::uuid
$f$;

-- Date e istanti nella timezone del negozio
create function pg_temp.today() returns date language sql stable as $f$
  select (now() at time zone 'Europe/Rome')::date
$f$;
create function pg_temp.loc(d date, t text) returns timestamptz language sql stable as $f$
  select (d + t::time) at time zone 'Europe/Rome'
$f$;
-- Giorno di riferimento: almeno dopodomani, mai di domenica (quindi mai un cambio d'ora)
create function pg_temp.d() returns date language sql stable as $f$
  select min(x)::date from generate_series((pg_temp.today() + 2)::timestamp,
                                           (pg_temp.today() + 4)::timestamp, interval '1 day') x
   where extract(isodow from x) <> 7
$f$;
-- Secondo giorno lavorativo dopo d
create function pg_temp.d2() returns date language sql stable as $f$
  select min(x)::date from generate_series((pg_temp.d() + 1)::timestamp,
                                           (pg_temp.d() + 3)::timestamp, interval '1 day') x
   where extract(isodow from x) <> 7
$f$;
-- Prima domenica dopo d
create function pg_temp.sun() returns date language sql stable as $f$
  select min(x)::date from generate_series((pg_temp.d() + 1)::timestamp,
                                           (pg_temp.d() + 7)::timestamp, interval '1 day') x
   where extract(isodow from x) = 7
$f$;
-- Primo istante allineato a step minuti (secondi a zero) non prima di ts. Roma ha offset di ore
-- intere: l'allineamento in UTC coincide con quello dell'orologio locale.
create function pg_temp.grid(ts timestamptz, step int) returns timestamptz language sql stable as $f$
  select to_timestamp(ceil(extract(epoch from ts) / (step * 60)) * (step * 60))
$f$;

-- ---------------------------------------------------------------------------
-- Dati (come postgres)
-- ---------------------------------------------------------------------------
update public.shop_settings
   set timezone = 'Europe/Rome', slot_granularity_min = 15, min_advance_min = 60,
       max_horizon_days = 30, cancel_limit_min = 120, buffer_min = 0, no_show_block_threshold = 3;
delete from public.shop_closures;

create function pg_temp.mk_user(uid uuid, r text, nm text, ph text) returns void language plpgsql as $f$
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'f5-' || uid || '@qa.test', '{}'::jsonb, '{}'::jsonb, now(), now());
  -- Profilo completo: nome, telefono e consenso privacy alla versione corrente
  update public.profiles
     set role = r::public.user_role, full_name = nm, phone = ph,
         privacy_policy_version = (select ss.privacy_policy_version from public.shop_settings ss),
         privacy_consent_at = now()
   where id = uid;
end $f$;

select pg_temp.mk_user('a5000000-0000-4000-8000-000000001901', 'customer', 'F5 Uno', '+393400001901');      -- c1
select pg_temp.mk_user('a5000000-0000-4000-8000-000000001902', 'customer', 'F5 Errori', '+393400001902');   -- c2
select pg_temp.mk_user('a5000000-0000-4000-8000-000000001903', 'customer', 'F5 Profilo', '+393400001903');  -- cp
select pg_temp.mk_user('a5000000-0000-4000-8000-000000001904', 'customer', 'F5 Bloccato', '+393400001904'); -- cb
select pg_temp.mk_user('a5000000-0000-4000-8000-000000001905', 'customer', 'F5 Note', '+393400001905');     -- cn
select pg_temp.mk_user('a5000000-0000-4000-8000-000000001906', 'customer', 'F5 Future', '+393400001906');   -- cf
select pg_temp.mk_user('a5000000-0000-4000-8000-000000001907', 'customer', 'F5 Recenti', '+393400001907');  -- cr
select pg_temp.mk_user('a5000000-0000-4000-8000-000000001908', 'customer', 'F5 Sovrapp', '+393400001908');  -- co
select pg_temp.mk_user('a5000000-0000-4000-8000-000000001909', 'customer', 'F5 Qualsiasi', '+393400001909');-- ca
select pg_temp.mk_user('a5000000-0000-4000-8000-000000001910', 'customer', 'F5 Cancella', '+393400001910'); -- cc
select pg_temp.mk_user('a5000000-0000-4000-8000-000000001911', 'customer', 'F5 Altro', '+393400001911');    -- cx
select pg_temp.mk_user('a5000000-0000-4000-8000-000000001912', 'customer', 'F5 Storico', '+393400001912');  -- cv
select pg_temp.mk_user('a5000000-0000-4000-8000-000000001921', 'barber', 'F5 Barbiere', '+393400001921');   -- ub
select pg_temp.mk_user('a5000000-0000-4000-8000-000000001922', 'admin', 'F5 Admin', '+393400001922');       -- ua

insert into public.services (id, name, duration_min, price_cents, is_active) values
  ('e5000000-0000-4000-8000-000000001901', 'F5 Taglio', 30, 2000, true),        -- S
  ('e5000000-0000-4000-8000-000000001902', 'F5 Rapido', 5, 500, true),          -- S5
  ('e5000000-0000-4000-8000-000000001903', 'F5 Disattivato', 30, 2000, false),  -- SX
  ('e5000000-0000-4000-8000-000000001904', 'F5 Vecchio', 30, 2500, true);       -- SV (disattivato dopo)
insert into public.barbers (id, display_name, is_active) values
  ('eb000000-0000-4000-8000-000000001901', 'F5 A', true),
  ('eb000000-0000-4000-8000-000000001902', 'F5 B', true),
  ('eb000000-0000-4000-8000-000000001903', 'F5 T', true),             -- tutto il giorno
  ('eb000000-0000-4000-8000-000000001904', 'F5 Non abilitato', true), -- N
  ('eb000000-0000-4000-8000-000000001905', 'F5 Inattivo', false),     -- I
  ('eb000000-0000-4000-8000-000000001906', 'F5 Ex', true);            -- BV (disattivato dopo)
insert into public.barber_services (barber_id, service_id) values
  ('eb000000-0000-4000-8000-000000001901', 'e5000000-0000-4000-8000-000000001901'),
  ('eb000000-0000-4000-8000-000000001901', 'e5000000-0000-4000-8000-000000001903'),
  ('eb000000-0000-4000-8000-000000001902', 'e5000000-0000-4000-8000-000000001901'),
  ('eb000000-0000-4000-8000-000000001903', 'e5000000-0000-4000-8000-000000001902'),
  ('eb000000-0000-4000-8000-000000001904', 'e5000000-0000-4000-8000-000000001902'),
  ('eb000000-0000-4000-8000-000000001905', 'e5000000-0000-4000-8000-000000001901'),
  ('eb000000-0000-4000-8000-000000001906', 'e5000000-0000-4000-8000-000000001904');

-- A, B, N, I, BV: lunedì–sabato 09:00–13:00 e 15:00–19:00. T: tutti i giorni 00:00–24:00.
insert into public.working_hours (barber_id, weekday, start_time, end_time)
select b.id, wd, f.s, f.e
  from (values ('eb000000-0000-4000-8000-000000001901'::uuid), ('eb000000-0000-4000-8000-000000001902'),
               ('eb000000-0000-4000-8000-000000001904'), ('eb000000-0000-4000-8000-000000001905'),
               ('eb000000-0000-4000-8000-000000001906')) b (id)
 cross join generate_series(1, 6) wd
 cross join (values ('09:00'::time, '13:00'::time), ('15:00', '19:00')) f (s, e);
insert into public.working_hours (barber_id, weekday, start_time, end_time)
select 'eb000000-0000-4000-8000-000000001903', wd, '00:00', '24:00' from generate_series(1, 7) wd;

-- Giorno d: assenza parziale di A a metà mattina, chiusura del negozio nel pomeriggio
insert into public.time_off (barber_id, starts_at, ends_at) values
  ('eb000000-0000-4000-8000-000000001901', pg_temp.loc(pg_temp.d(), '10:00'), pg_temp.loc(pg_temp.d(), '11:00'));
insert into public.shop_closures (starts_at, ends_at) values
  (pg_temp.loc(pg_temp.d(), '16:00'), pg_temp.loc(pg_temp.d(), '17:00'));

-- Prenotazioni di ospiti (manuali) nel giorno d
insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, status, source) values
  ('F5 Ospite', '+390300001901', 'eb000000-0000-4000-8000-000000001901', 'e5000000-0000-4000-8000-000000001901',
   pg_temp.loc(pg_temp.d(), '11:30'), 'confirmed', 'manual'),
  ('F5 Ospite', '+390300001901', 'eb000000-0000-4000-8000-000000001902', 'e5000000-0000-4000-8000-000000001901',
   pg_temp.loc(pg_temp.d(), '11:30'), 'confirmed', 'manual'),
  -- cancellata: non occupa
  ('F5 Ospite', '+390300001901', 'eb000000-0000-4000-8000-000000001901', 'e5000000-0000-4000-8000-000000001901',
   pg_temp.loc(pg_temp.d(), '12:30'), 'cancelled_by_customer', 'manual');
-- Buffer copiato di 10' (blocked_until = 18:10)
update public.shop_settings set buffer_min = 10;
insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, status, source) values
  ('F5 Ospite', '+390300001901', 'eb000000-0000-4000-8000-000000001901', 'e5000000-0000-4000-8000-000000001901',
   pg_temp.loc(pg_temp.d(), '17:30'), 'confirmed', 'manual');
update public.shop_settings set buffer_min = 0;

-- ===========================================================================
-- 1. Struttura e privilegi (CLAUDE.md – Sicurezza; ADR 001)
-- ===========================================================================
select has_function('public', 'online_slot_error',
  array['uuid', 'uuid', 'timestamp with time zone'],
  'fetta 5: esiste public.online_slot_error(uuid, uuid, timestamptz)');
select is(pg_get_function_identity_arguments(pg_temp.fn('online_slot_error')) || ' -> '
          || pg_get_function_result(pg_temp.fn('online_slot_error')),
  'p_service_id uuid, p_barber_id uuid, p_starts_at timestamp with time zone -> text',
  'fetta 5: online_slot_error – nomi dei parametri e tipo di ritorno text');
select ok(pg_temp.definer_fixed_path('online_slot_error'),
  'fetta 5: online_slot_error è security definer con search_path = ''''');
select is(array[pg_temp.public_exec('online_slot_error'),
                pg_temp.can_exec('anon', 'public.online_slot_error(uuid, uuid, timestamptz)'),
                pg_temp.can_exec('authenticated', 'public.online_slot_error(uuid, uuid, timestamptz)')],
  array[false, false, true],
  'CLAUDE.md – Sicurezza: online_slot_error eseguibile solo da authenticated (né PUBLIC né anon)');

select has_function('public', 'create_online_booking',
  array['uuid', 'uuid', 'timestamp with time zone', 'text'],
  'fetta 5: esiste public.create_online_booking(uuid, uuid, timestamptz, text)');
select is(pg_get_function_identity_arguments(pg_temp.fn('create_online_booking')) || ' -> '
          || pg_get_function_result(pg_temp.fn('create_online_booking')),
  'p_service_id uuid, p_barber_id uuid, p_starts_at timestamp with time zone, p_notes text -> uuid',
  'fetta 5: create_online_booking – nomi dei parametri e ritorno uuid (id della prenotazione)');
select ok(pg_temp.definer_fixed_path('create_online_booking'),
  'ADR 001: create_online_booking è security definer con search_path = ''''');
select is(array[pg_temp.public_exec('create_online_booking'),
                pg_temp.can_exec('anon', 'public.create_online_booking(uuid, uuid, timestamptz, text)'),
                pg_temp.can_exec('authenticated', 'public.create_online_booking(uuid, uuid, timestamptz, text)')],
  array[false, false, true],
  'CLAUDE.md – Sicurezza: create_online_booking eseguibile solo da authenticated (né PUBLIC né anon)');

select has_function('public', 'cancel_own_booking', array['uuid'],
  'fetta 5: esiste public.cancel_own_booking(uuid)');
select is(pg_get_function_identity_arguments(pg_temp.fn('cancel_own_booking')) || ' -> '
          || pg_get_function_result(pg_temp.fn('cancel_own_booking')),
  'p_booking_id uuid -> void',
  'fetta 5: cancel_own_booking – nome del parametro e ritorno void');
select ok(pg_temp.definer_fixed_path('cancel_own_booking'),
  'ADR 001: cancel_own_booking è security definer con search_path = ''''');
select is(array[pg_temp.public_exec('cancel_own_booking'),
                pg_temp.can_exec('anon', 'public.cancel_own_booking(uuid)'),
                pg_temp.can_exec('authenticated', 'public.cancel_own_booking(uuid)')],
  array[false, false, true],
  'CLAUDE.md – Sicurezza: cancel_own_booking eseguibile solo da authenticated (né PUBLIC né anon)');

-- ===========================================================================
-- 2. online_slot_error (SPEC §3.7.2, §3.7.3, §4, §12) – barbiere A, servizio da 30'
-- ===========================================================================
select pg_temp.act_as('a5000000-0000-4000-8000-000000001902');

select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '09:00')), null,
  'SPEC §3.7.2: 09:00 all''inizio della fascia → valido e libero (null)');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '12:30')), null,
  'SPEC §3.7.2: 12:30 finisce esattamente alle 13:00; la prenotazione cancellata non occupa');

-- Fascia di lavoro (SPEC §12: pausa pranzo, oltre la chiusura)
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '12:45')), 'outside_hours',
  'SPEC §12: servizio che finirebbe dentro la pausa pranzo → outside_hours');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '14:00')), 'outside_hours',
  'SPEC §3.7.2: inizio dentro la pausa pranzo → outside_hours');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '18:45')), 'outside_hours',
  'SPEC §12: servizio che finirebbe oltre la chiusura → outside_hours');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '08:45')), 'outside_hours',
  'SPEC §3.7.2: inizio prima dell''apertura → outside_hours');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.sun(), '10:00')), 'outside_hours',
  'SPEC §3.7.2: giorno senza fasce di lavoro (domenica) → outside_hours');

-- Assenza parziale (SPEC §12)
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '10:00')), 'unavailable',
  'SPEC §12: assenza parziale a metà mattina – inizio dentro l''assenza → unavailable');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '09:45')), 'unavailable',
  'SPEC §12: assenza parziale – servizio che finirebbe dentro l''assenza → unavailable');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '09:30')), null,
  'SPEC §12: assenza parziale – servizio che finisce all''inizio dell''assenza → valido');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001902',
  pg_temp.loc(pg_temp.d(), '10:00')), null,
  'SPEC §3.5: l''assenza di A non tocca B');

-- Chiusura del negozio
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '16:00')), 'closed',
  'SPEC §3.7.2: inizio dentro una chiusura del negozio → closed');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '15:45')), 'closed',
  'SPEC §3.7.2: servizio che finirebbe dentro una chiusura → closed');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '17:00')), null,
  'SPEC §3.7.2: dalla fine della chiusura, fino a una prenotazione successiva senza buffer → valido');

-- Prenotazioni esistenti (SPEC §3.7.1, §12 buffer > 0)
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '11:30')), 'unavailable',
  'SPEC §3.7.1: stesso inizio di una confirmed → unavailable');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '11:15')), 'unavailable',
  'SPEC §3.7.1: servizio che finirebbe dentro una confirmed → unavailable');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '11:00')), null,
  'SPEC §4: con buffer corrente 0 lo slot che finisce all''inizio della confirmed è valido');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '18:00')), 'unavailable',
  'SPEC §12: buffer > 0 – la confirmed delle 17:30 con buffer copiato di 10'' occupa fino alle 18:10');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '18:15')), null,
  'SPEC §12: buffer > 0 – dopo blocked_until lo slot è libero');

select pg_temp.act_as_postgres();
update public.shop_settings set buffer_min = 10;
select pg_temp.act_as('a5000000-0000-4000-8000-000000001902');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '11:00')), 'unavailable',
  'SPEC §12: buffer corrente 10'' – 11:00 + 30'' + 10'' tocca la confirmed delle 11:30 → unavailable');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '17:00')), 'unavailable',
  'SPEC §12: buffer corrente 10'' – 17:00 + 30'' + 10'' tocca la confirmed delle 17:30 → unavailable');
select pg_temp.act_as_postgres();
update public.shop_settings set buffer_min = 0;
select pg_temp.act_as('a5000000-0000-4000-8000-000000001902');

-- Griglia (ADR 004)
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '15:07')), 'not_aligned',
  'ADR 004: minuti non multipli di slot_granularity_min → not_aligned');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '15:00') + interval '30 seconds'), 'not_aligned',
  'ADR 004: secondi diversi da zero → not_aligned');

-- Barbiere e servizio (SPEC §3.7.3, §3.2, §12)
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001904',
  pg_temp.loc(pg_temp.d(), '10:00')), 'barber_unavailable',
  'SPEC §12: barbiere non abilitato al servizio → barber_unavailable');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001905',
  pg_temp.loc(pg_temp.d(), '10:00')), 'barber_unavailable',
  'SPEC §3.3: barbiere disattivato → barber_unavailable');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-0000000019ff',
  pg_temp.loc(pg_temp.d(), '10:00')), 'barber_unavailable',
  'fetta 5: barbiere inesistente → barber_unavailable');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001903', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '15:00')), 'service_unavailable',
  'SPEC §3.2: servizio disattivato non più prenotabile → service_unavailable');
select is(pg_temp.ose('e5000000-0000-4000-8000-0000000019ff', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '15:00')), 'service_unavailable',
  'fetta 5: servizio inesistente → service_unavailable');

-- Anticipo minimo (SPEC §3.1, §4.5) – barbiere T (tutto il giorno), servizio da 5', griglia di 5'
select pg_temp.act_as_postgres();
update public.shop_settings set slot_granularity_min = 5,
  min_advance_min = floor(extract(epoch from pg_temp.grid(now() + interval '60 minutes', 5) - now()) / 60);
select pg_temp.act_as('a5000000-0000-4000-8000-000000001902');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001902', 'eb000000-0000-4000-8000-000000001903',
  pg_temp.grid(now() + interval '60 minutes', 5)), null,
  'SPEC §4.5: inizio ≥ now() + min_advance_min → valido');
select pg_temp.act_as_postgres();
update public.shop_settings set
  min_advance_min = floor(extract(epoch from pg_temp.grid(now() + interval '60 minutes', 5) - now()) / 60) + 1;
select pg_temp.act_as('a5000000-0000-4000-8000-000000001902');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001902', 'eb000000-0000-4000-8000-000000001903',
  pg_temp.grid(now() + interval '60 minutes', 5)), 'too_soon',
  'SPEC §4.5: inizio < now() + min_advance_min (meno di un minuto) → too_soon');
select pg_temp.act_as_postgres();
update public.shop_settings set slot_granularity_min = 15, min_advance_min = 60;
select pg_temp.act_as('a5000000-0000-4000-8000-000000001902');

-- Orizzonte (SPEC §3.1, ADR 004: fino alla fine del giorno locale di oggi + max_horizon_days = 30)
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001902', 'eb000000-0000-4000-8000-000000001903',
  pg_temp.loc(pg_temp.today() + 30, '23:45')), null,
  'ADR 004: ultimo slot dell''ultimo giorno dell''orizzonte → valido');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001902', 'eb000000-0000-4000-8000-000000001903',
  pg_temp.loc(pg_temp.today() + 31, '00:00')), 'too_far',
  'ADR 004: mezzanotte del giorno dopo l''orizzonte → too_far');
select is(pg_temp.ose('e5000000-0000-4000-8000-000000001902', 'eb000000-0000-4000-8000-000000001903',
  pg_temp.loc(pg_temp.today() + 31, '10:00')), 'too_far',
  'SPEC §3.1: oltre max_horizon_days → too_far');

-- ===========================================================================
-- 3. create_online_booking – creazione riuscita (SPEC §3.6, regola 4 di CLAUDE.md)
-- ===========================================================================
select pg_temp.act_as('a5000000-0000-4000-8000-000000001901');
select is(pg_temp.book('c1', 'e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '09:00'), '  Sfumatura bassa  '), 'ok',
  'SPEC §5.2: il cliente con profilo completo prenota uno slot valido e riceve l''id');

-- Concorrenza: lock advisory di transazione per cliente (verifica solo la presa del lock)
select is(
  (select count(*)::int
     from pg_locks l,
          (select hashtextextended('create_online_booking:' || 'a5000000-0000-4000-8000-000000001901', 0) k) x
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted and l.mode = 'ExclusiveLock'
      and l.classid = ((x.k >> 32) & 4294967295)::oid
      and l.objid = (x.k & 4294967295)::oid
      and l.objsubid = 1),
  1, 'SPEC §8 / fetta 5: create_online_booking prende pg_advisory_xact_lock sulla chiave del cliente');

select pg_temp.act_as_postgres();
select results_eq(
  $q$ select customer_id, barber_id, service_id, source::text, status::text, duration_min, price_cents,
             ends_at, blocked_until, notes, status_changed_by
        from public.bookings where id = pg_temp.bid('c1') $q$,
  $q$ values ('a5000000-0000-4000-8000-000000001901'::uuid, 'eb000000-0000-4000-8000-000000001901'::uuid,
              'e5000000-0000-4000-8000-000000001901'::uuid, 'online', 'confirmed', 30, 2000,
              pg_temp.loc(pg_temp.d(), '09:30'), pg_temp.loc(pg_temp.d(), '09:30'), 'Sfumatura bassa',
              'a5000000-0000-4000-8000-000000001901'::uuid) $q$,
  'SPEC §3.6: online, confirmed, del cliente; durata, prezzo, fine e buffer dal database; nota senza spazi');

-- ===========================================================================
-- 4. create_online_booking – errori dello slot con barbiere esplicito (SPEC §3.7.2, §3.7.3)
-- ===========================================================================
select pg_temp.act_as('a5000000-0000-4000-8000-000000001902');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001903',
  'eb000000-0000-4000-8000-000000001901', pg_temp.loc(pg_temp.d(), '15:00'), null) $q$,
  'P0001', 'service_unavailable', 'SPEC §3.2: servizio disattivato → service_unavailable');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  'eb000000-0000-4000-8000-000000001904', pg_temp.loc(pg_temp.d(), '10:00'), null) $q$,
  'P0001', 'barber_unavailable', 'SPEC §12: barbiere non abilitato al servizio → barber_unavailable');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  'eb000000-0000-4000-8000-000000001901', pg_temp.loc(pg_temp.d(), '15:07'), null) $q$,
  'P0001', 'not_aligned', 'ADR 004: fuori griglia → not_aligned');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001902',
  'eb000000-0000-4000-8000-000000001903', pg_temp.grid(now() + interval '30 minutes', 15), null) $q$,
  'P0001', 'too_soon', 'SPEC §3.7.2: prima dell''anticipo minimo → too_soon');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001902',
  'eb000000-0000-4000-8000-000000001903', pg_temp.loc(pg_temp.today() + 31, '10:00'), null) $q$,
  'P0001', 'too_far', 'SPEC §3.7.2: oltre l''orizzonte → too_far');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  'eb000000-0000-4000-8000-000000001901', pg_temp.loc(pg_temp.d(), '12:45'), null) $q$,
  'P0001', 'outside_hours', 'SPEC §12: finirebbe nella pausa pranzo → outside_hours');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  'eb000000-0000-4000-8000-000000001901', pg_temp.loc(pg_temp.d(), '10:00'), null) $q$,
  'P0001', 'unavailable', 'SPEC §12: assenza parziale → unavailable (non distinta da occupato)');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  'eb000000-0000-4000-8000-000000001901', pg_temp.loc(pg_temp.d(), '16:00'), null) $q$,
  'P0001', 'closed', 'SPEC §3.7.2: chiusura del negozio → closed');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  'eb000000-0000-4000-8000-000000001901', pg_temp.loc(pg_temp.d(), '11:30'), null) $q$,
  'P0001', 'unavailable', 'SPEC §3.7.1: slot occupato → unavailable');

-- "Nessuna preferenza"
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  null, pg_temp.loc(pg_temp.d(), '11:30'), null) $q$,
  'P0001', 'unavailable', 'SPEC §4: nessun barbiere libero nello slot → unavailable');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  null, pg_temp.grid(now() + interval '30 minutes', 15), null) $q$,
  'P0001', 'too_soon', 'review fetta 5: "Nessuna preferenza" prima dell''anticipo → too_soon, non unavailable');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  null, pg_temp.loc(pg_temp.d(), '16:00'), null) $q$,
  'P0001', 'closed', 'review fetta 5: "Nessuna preferenza" durante una chiusura → closed, non unavailable');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001903',
  null, pg_temp.loc(pg_temp.d(), '15:00'), null) $q$,
  'P0001', 'service_unavailable', 'SPEC §3.2: servizio disattivato senza barbiere scelto → service_unavailable');

select pg_temp.act_as_postgres();
select is((select count(*)::int from public.bookings
            where customer_id = 'a5000000-0000-4000-8000-000000001902'), 0,
  'fetta 5: nessuna prenotazione creata dalle chiamate rifiutate');

-- ===========================================================================
-- 5. Ruolo e profilo (SPEC §2, §5.5, §8; ADR 001)
-- ===========================================================================
select pg_temp.act_as('a5000000-0000-4000-8000-000000001921');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  'eb000000-0000-4000-8000-000000001902', pg_temp.loc(pg_temp.d(), '15:00'), null) $q$,
  'P0001', 'not_customer', 'SPEC §2: il barbiere non prenota online → not_customer');
select pg_temp.act_as('a5000000-0000-4000-8000-000000001922');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  'eb000000-0000-4000-8000-000000001902', pg_temp.loc(pg_temp.d(), '15:00'), null) $q$,
  'P0001', 'not_customer', 'SPEC §2: l''admin non prenota online → not_customer');
select pg_temp.act_as_nouser();
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  'eb000000-0000-4000-8000-000000001902', pg_temp.loc(pg_temp.d(), '15:00'), null) $q$,
  'P0001', 'not_customer', 'fetta 5: senza utente autenticato → not_customer');

-- Profilo incompleto (cp), slot valido B 15:00
select pg_temp.act_as_postgres();
update public.profiles set full_name = '' where id = 'a5000000-0000-4000-8000-000000001903';
select pg_temp.act_as('a5000000-0000-4000-8000-000000001903');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  'eb000000-0000-4000-8000-000000001902', pg_temp.loc(pg_temp.d(), '15:00'), null) $q$,
  'P0001', 'profile_incomplete', 'SPEC §5.5: nome vuoto → profile_incomplete');
select pg_temp.act_as_postgres();
update public.profiles set full_name = 'F5 Profilo', phone = null where id = 'a5000000-0000-4000-8000-000000001903';
select pg_temp.act_as('a5000000-0000-4000-8000-000000001903');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  'eb000000-0000-4000-8000-000000001902', pg_temp.loc(pg_temp.d(), '15:00'), null) $q$,
  'P0001', 'profile_incomplete', 'SPEC §5.5: telefono mancante → profile_incomplete');
select pg_temp.act_as_postgres();
update public.profiles set phone = '+393400001903', privacy_policy_version = 'f5-versione-vecchia'
 where id = 'a5000000-0000-4000-8000-000000001903';
select pg_temp.act_as('a5000000-0000-4000-8000-000000001903');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  'eb000000-0000-4000-8000-000000001902', pg_temp.loc(pg_temp.d(), '15:00'), null) $q$,
  'P0001', 'profile_incomplete', 'SPEC §8: consenso privacy a una versione non corrente → profile_incomplete');
select pg_temp.act_as_postgres();
update public.profiles set privacy_policy_version = null, privacy_consent_at = null
 where id = 'a5000000-0000-4000-8000-000000001903';
select pg_temp.act_as('a5000000-0000-4000-8000-000000001903');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  'eb000000-0000-4000-8000-000000001902', pg_temp.loc(pg_temp.d(), '15:00'), null) $q$,
  'P0001', 'profile_incomplete', 'SPEC §8: consenso privacy mancante → profile_incomplete');

-- ===========================================================================
-- 6. Blocco (SPEC §3.1 no_show_block_threshold, §6.7, §12 cliente bloccato per no-show)
-- ===========================================================================
select pg_temp.act_as_postgres();
update public.profiles set is_blocked = true where id = 'a5000000-0000-4000-8000-000000001904';
select pg_temp.act_as('a5000000-0000-4000-8000-000000001904');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  'eb000000-0000-4000-8000-000000001902', pg_temp.loc(pg_temp.d(), '15:00'), null) $q$,
  'P0001', 'blocked', 'SPEC §6.7: cliente bloccato dall''admin → blocked');
select pg_temp.act_as_postgres();
update public.profiles set is_blocked = false, no_show_count = 3 where id = 'a5000000-0000-4000-8000-000000001904';
select pg_temp.act_as('a5000000-0000-4000-8000-000000001904');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  'eb000000-0000-4000-8000-000000001902', pg_temp.loc(pg_temp.d(), '15:00'), null) $q$,
  'P0001', 'blocked', 'SPEC §12: no-show pari alla soglia (3 su 3) → blocked');
select pg_temp.act_as_postgres();
update public.profiles set no_show_count = 5 where id = 'a5000000-0000-4000-8000-000000001904';
update public.shop_settings set no_show_block_threshold = 0;
select pg_temp.act_as('a5000000-0000-4000-8000-000000001904');
select is(pg_temp.book('cb0', 'e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001902',
  pg_temp.loc(pg_temp.d(), '15:00')), 'ok',
  'SPEC §3.1: soglia 0 = blocco per no-show disattivato (5 no-show, prenota)');
select pg_temp.act_as_postgres();
update public.profiles set no_show_count = 2 where id = 'a5000000-0000-4000-8000-000000001904';
update public.shop_settings set no_show_block_threshold = 3;
select pg_temp.act_as('a5000000-0000-4000-8000-000000001904');
select is(pg_temp.book('cb2', 'e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001902',
  pg_temp.loc(pg_temp.d(), '15:30')), 'ok',
  'SPEC §3.1: no-show sotto la soglia (2 su 3) → prenota');

-- ===========================================================================
-- 7. Nota del cliente (SPEC §3.6, §5.2)
-- ===========================================================================
select pg_temp.act_as('a5000000-0000-4000-8000-000000001905');
select throws_ok(format($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  'eb000000-0000-4000-8000-000000001902', pg_temp.loc(pg_temp.d(), '17:00'), %L) $q$, repeat('x', 501)),
  'P0001', 'notes_too_long', 'fetta 5: nota di 501 caratteri → notes_too_long');
select is(pg_temp.book('cn500', 'e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001902',
  pg_temp.loc(pg_temp.d(), '17:00'), '   ' || repeat('y', 500) || '   '), 'ok',
  'fetta 5: nota di 500 caratteri dopo il trim → accettata');
select is(pg_temp.book('cnblank', 'e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001902',
  pg_temp.loc(pg_temp.d(), '17:30'), '    '), 'ok',
  'fetta 5: nota di soli spazi → accettata');
select pg_temp.act_as_postgres();
select is((select notes = repeat('y', 500) from public.bookings where id = pg_temp.bid('cn500')), true,
  'fetta 5: la nota è salvata senza spazi iniziali e finali');
select is((select coalesce(notes, '<null>') from public.bookings where id = pg_temp.bid('cnblank')), '<null>',
  'fetta 5: nota vuota o di soli spazi → null');

-- ===========================================================================
-- 8. Limiti anti-abuso (SPEC §8: rate limiting sulla creazione)
-- ===========================================================================
-- cf: 2 online confirmed future, più prenotazioni che non contano (manuale, cancellata, passate)
insert into public.bookings (customer_id, barber_id, service_id, starts_at, status, source) values
  ('a5000000-0000-4000-8000-000000001906', 'eb000000-0000-4000-8000-000000001903', 'e5000000-0000-4000-8000-000000001902',
   pg_temp.loc(pg_temp.d() + 1, '08:00'), 'confirmed', 'online'),
  ('a5000000-0000-4000-8000-000000001906', 'eb000000-0000-4000-8000-000000001903', 'e5000000-0000-4000-8000-000000001902',
   pg_temp.loc(pg_temp.d() + 1, '08:30'), 'confirmed', 'online'),
  ('a5000000-0000-4000-8000-000000001906', 'eb000000-0000-4000-8000-000000001903', 'e5000000-0000-4000-8000-000000001902',
   pg_temp.loc(pg_temp.d() + 1, '09:00'), 'confirmed', 'manual'),
  ('a5000000-0000-4000-8000-000000001906', 'eb000000-0000-4000-8000-000000001903', 'e5000000-0000-4000-8000-000000001902',
   pg_temp.loc(pg_temp.d() + 1, '09:30'), 'cancelled_by_customer', 'online'),
  ('a5000000-0000-4000-8000-000000001906', 'eb000000-0000-4000-8000-000000001903', 'e5000000-0000-4000-8000-000000001902',
   now() - interval '2 days', 'completed', 'online'),
  ('a5000000-0000-4000-8000-000000001906', 'eb000000-0000-4000-8000-000000001903', 'e5000000-0000-4000-8000-000000001902',
   now() - interval '1 day', 'confirmed', 'online');
select pg_temp.act_as('a5000000-0000-4000-8000-000000001906');
select is(pg_temp.book('cf3', 'e5000000-0000-4000-8000-000000001902', 'eb000000-0000-4000-8000-000000001903',
  pg_temp.loc(pg_temp.d() + 1, '10:00')), 'ok',
  'fetta 5: contano solo le online confirmed future (2) → la terza è ammessa');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001902',
  'eb000000-0000-4000-8000-000000001903', pg_temp.loc(pg_temp.d() + 1, '10:30'), null) $q$,
  'P0001', 'too_many_future', 'fetta 5: già 3 prenotazioni online confirmed future → too_many_future');

-- cr: 9 online create nelle ultime 24 ore (qualsiasi stato), una online più vecchia, una manuale
select pg_temp.act_as_postgres();
insert into public.bookings (customer_id, barber_id, service_id, starts_at, status, source)
select 'a5000000-0000-4000-8000-000000001907', 'eb000000-0000-4000-8000-000000001903',
       'e5000000-0000-4000-8000-000000001902',
       pg_temp.loc(pg_temp.d() + 2, '08:00') + make_interval(mins => 10 * i), 'cancelled_by_customer', 'online'
  from generate_series(1, 9) i;
insert into public.bookings (customer_id, barber_id, service_id, starts_at, status, source, created_at) values
  ('a5000000-0000-4000-8000-000000001907', 'eb000000-0000-4000-8000-000000001903', 'e5000000-0000-4000-8000-000000001902',
   pg_temp.loc(pg_temp.d() + 2, '10:00'), 'cancelled_by_customer', 'online', now() - interval '25 hours');
insert into public.bookings (customer_id, barber_id, service_id, starts_at, status, source) values
  ('a5000000-0000-4000-8000-000000001907', 'eb000000-0000-4000-8000-000000001903', 'e5000000-0000-4000-8000-000000001902',
   pg_temp.loc(pg_temp.d() + 2, '10:30'), 'cancelled_by_shop', 'manual');
select pg_temp.act_as('a5000000-0000-4000-8000-000000001907');
select is(pg_temp.book('cr10', 'e5000000-0000-4000-8000-000000001902', 'eb000000-0000-4000-8000-000000001903',
  pg_temp.loc(pg_temp.d() + 2, '12:00')), 'ok',
  'fetta 5: 9 online nelle ultime 24 ore (la più vecchia e la manuale non contano) → la decima è ammessa');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001902',
  'eb000000-0000-4000-8000-000000001903', pg_temp.loc(pg_temp.d() + 2, '12:30'), null) $q$,
  'P0001', 'too_many_recent', 'fetta 5: già 10 prenotazioni online create nelle ultime 24 ore → too_many_recent');

-- co: il cliente ha già una confirmed (manuale, con B) dalle 18:00 alle 18:30
select pg_temp.act_as_postgres();
insert into public.bookings (customer_id, barber_id, service_id, starts_at, status, source) values
  ('a5000000-0000-4000-8000-000000001908', 'eb000000-0000-4000-8000-000000001902', 'e5000000-0000-4000-8000-000000001901',
   pg_temp.loc(pg_temp.d(), '18:00'), 'confirmed', 'manual');
select pg_temp.act_as('a5000000-0000-4000-8000-000000001908');
select throws_ok($q$ select public.create_online_booking('e5000000-0000-4000-8000-000000001901',
  'eb000000-0000-4000-8000-000000001901', pg_temp.loc(pg_temp.d(), '18:15'), null) $q$,
  'P0001', 'customer_overlap', 'SPEC §3.7.4 / fetta 5: il cliente ha già un appuntamento sovrapposto (altro barbiere) → customer_overlap');
select is(pg_temp.book('co', 'e5000000-0000-4000-8000-000000001901', 'eb000000-0000-4000-8000-000000001901',
  pg_temp.loc(pg_temp.d(), '18:30')), 'ok',
  'fetta 5: appuntamento subito dopo il proprio (adiacente, buffer 0) → ammesso');

-- ===========================================================================
-- 9. "Nessuna preferenza": barbiere con meno prenotazioni non cancellate nel giorno (SPEC §4, ADR 004)
-- ===========================================================================
select pg_temp.act_as_postgres();
insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, status, source) values
  ('F5 Ospite', '+390300001901', 'eb000000-0000-4000-8000-000000001901', 'e5000000-0000-4000-8000-000000001901',
   pg_temp.loc(pg_temp.d2(), '09:00'), 'confirmed', 'manual'),
  ('F5 Ospite', '+390300001901', 'eb000000-0000-4000-8000-000000001902', 'e5000000-0000-4000-8000-000000001901',
   pg_temp.loc(pg_temp.d2(), '09:00'), 'cancelled_by_shop', 'manual'),
  ('F5 Ospite', '+390300001901', 'eb000000-0000-4000-8000-000000001902', 'e5000000-0000-4000-8000-000000001901',
   pg_temp.loc(pg_temp.d2(), '09:30'), 'cancelled_by_customer', 'manual');
select pg_temp.act_as('a5000000-0000-4000-8000-000000001909');
select is(pg_temp.book('ca', 'e5000000-0000-4000-8000-000000001901', null,
  pg_temp.loc(pg_temp.d2(), '10:00')), 'ok',
  'SPEC §4: "Nessuna preferenza" con almeno un barbiere libero → prenotazione creata');
select pg_temp.act_as_postgres();
select is((select barber_id from public.bookings where id = pg_temp.bid('ca')),
  'eb000000-0000-4000-8000-000000001902'::uuid,
  'SPEC §4: vince B (0 non cancellate) su A (1); le cancellate non contano, il barbiere inattivo non è candidato');

-- ===========================================================================
-- 10. cancel_own_booking (SPEC §5.3, §12 cancellazione esattamente al limite)
-- ===========================================================================
insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, status, source) values
  -- esattamente al limite: now() = starts_at - cancel_limit_min
  ('bc000000-0000-4000-8000-000000001901', 'a5000000-0000-4000-8000-000000001910', 'eb000000-0000-4000-8000-000000001903',
   'e5000000-0000-4000-8000-000000001902', now() + interval '120 minutes', 'confirmed', 'online'),
  ('bc000000-0000-4000-8000-000000001903', 'a5000000-0000-4000-8000-000000001910', 'eb000000-0000-4000-8000-000000001904',
   'e5000000-0000-4000-8000-000000001902', now() + interval '1 day', 'cancelled_by_shop', 'online'),
  ('bc000000-0000-4000-8000-000000001904', 'a5000000-0000-4000-8000-000000001910', 'eb000000-0000-4000-8000-000000001904',
   'e5000000-0000-4000-8000-000000001902', now() + interval '3 days', 'confirmed', 'online'),
  -- di un altro cliente
  ('bc000000-0000-4000-8000-000000001905', 'a5000000-0000-4000-8000-000000001911', 'eb000000-0000-4000-8000-000000001904',
   'e5000000-0000-4000-8000-000000001902', now() + interval '2 days', 'confirmed', 'online');

select pg_temp.act_as('a5000000-0000-4000-8000-000000001910');
select lives_ok($q$ select public.cancel_own_booking('bc000000-0000-4000-8000-000000001901') $q$,
  'SPEC §12: esattamente al limite di cancel_limit_min → cancellazione ammessa');

-- Fetta 6 (regola 6, SPEC §3.7.6): la 1902 si sovrappone alla 1901 dello stesso cliente, quindi si
-- inserisce dopo la cancellazione della 1901 (prima le due confirmed coesistevano).
select pg_temp.act_as_postgres();
insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, status, source) values
  -- un minuto oltre il limite
  ('bc000000-0000-4000-8000-000000001902', 'a5000000-0000-4000-8000-000000001910', 'eb000000-0000-4000-8000-000000001904',
   'e5000000-0000-4000-8000-000000001902', now() + interval '119 minutes', 'confirmed', 'online');

select pg_temp.act_as('a5000000-0000-4000-8000-000000001910');
select throws_ok($q$ select public.cancel_own_booking('bc000000-0000-4000-8000-000000001902') $q$,
  'P0001', 'too_late', 'SPEC §12: un minuto oltre cancel_limit_min → too_late');
select throws_ok($q$ select public.cancel_own_booking('bc000000-0000-4000-8000-000000001903') $q$,
  'P0001', 'not_cancellable', 'SPEC §3.6: prenotazione non confirmed → not_cancellable');
select throws_ok($q$ select public.cancel_own_booking('bc000000-0000-4000-8000-000000001905') $q$,
  'P0001', 'not_found', 'SPEC §3.7.4: prenotazione di un altro cliente → not_found (non rivela nulla)');
select throws_ok($q$ select public.cancel_own_booking('bc000000-0000-4000-8000-0000000019ff') $q$,
  'P0001', 'not_found', 'fetta 5: prenotazione inesistente → not_found');

select pg_temp.act_as('a5000000-0000-4000-8000-000000001921');
select throws_ok($q$ select public.cancel_own_booking('bc000000-0000-4000-8000-000000001904') $q$,
  'P0001', 'not_customer', 'SPEC §2: lo staff non usa la cancellazione del cliente → not_customer');
select pg_temp.act_as_nouser();
select throws_ok($q$ select public.cancel_own_booking('bc000000-0000-4000-8000-000000001904') $q$,
  'P0001', 'not_customer', 'fetta 5: senza utente autenticato → not_customer');

select pg_temp.act_as_postgres();
select results_eq(
  $q$ select id, status::text, status_changed_by from public.bookings
       where id in ('bc000000-0000-4000-8000-000000001901', 'bc000000-0000-4000-8000-000000001902',
                    'bc000000-0000-4000-8000-000000001904', 'bc000000-0000-4000-8000-000000001905')
       order by id $q$,
  $q$ values
       ('bc000000-0000-4000-8000-000000001901'::uuid, 'cancelled_by_customer', 'a5000000-0000-4000-8000-000000001910'::uuid),
       ('bc000000-0000-4000-8000-000000001902', 'confirmed', null),
       ('bc000000-0000-4000-8000-000000001904', 'confirmed', null),
       ('bc000000-0000-4000-8000-000000001905', 'confirmed', null) $q$,
  'SPEC §3.6: solo la cancellazione ammessa cambia stato (cancelled_by_customer, autore il cliente)');

-- ===========================================================================
-- 11. Servizi e barbieri disattivati sulle proprie prenotazioni (SPEC §3.2, §12, §3.7.4)
-- ===========================================================================
insert into public.bookings (customer_id, barber_id, service_id, starts_at, status, source) values
  ('a5000000-0000-4000-8000-000000001912', 'eb000000-0000-4000-8000-000000001906', 'e5000000-0000-4000-8000-000000001904',
   pg_temp.loc(pg_temp.d(), '10:00'), 'confirmed', 'online');
update public.services set is_active = false where id = 'e5000000-0000-4000-8000-000000001904';
update public.barbers set is_active = false where id = 'eb000000-0000-4000-8000-000000001906';

select pg_temp.act_as('a5000000-0000-4000-8000-000000001912');
select results_eq(
  $q$ select b.status::text, s.name, br.display_name
        from public.bookings b
        join public.services s on s.id = b.service_id
        join public.barbers br on br.id = b.barber_id
       where b.customer_id = 'a5000000-0000-4000-8000-000000001912' $q$,
  $q$ values ('confirmed', 'F5 Vecchio', 'F5 Ex') $q$,
  'SPEC §12: servizio (e barbiere) disattivati con prenotazione futura – la prenotazione resta e il cliente ne legge i nomi');
select is_empty(
  $q$ select id from public.services where id = 'e5000000-0000-4000-8000-000000001903' $q$,
  'SPEC §3.2: il cliente non legge un servizio disattivato non collegato alle sue prenotazioni');
select is_empty(
  $q$ select id from public.barbers where id = 'eb000000-0000-4000-8000-000000001905' $q$,
  'SPEC §3.3: il cliente non legge un barbiere disattivato non collegato alle sue prenotazioni');
select throws_ok(
  $q$ select profile_id from public.barbers where id = 'eb000000-0000-4000-8000-000000001906' $q$,
  '42501', null, 'ADR 001: anche sul barbiere collegato il cliente legge solo le colonne pubbliche');

select pg_temp.act_as('a5000000-0000-4000-8000-000000001902');
select is_empty(
  $q$ select s.id from public.services s where s.id = 'e5000000-0000-4000-8000-000000001904'
      union all
      select b.id from public.barbers b where b.id = 'eb000000-0000-4000-8000-000000001906' $q$,
  'SPEC §3.7.4: un altro cliente non legge servizio e barbiere disattivati delle prenotazioni altrui');

select pg_temp.act_as_anon();
select is_empty(
  $q$ select s.id from public.services s where s.id = 'e5000000-0000-4000-8000-000000001904'
      union all
      select b.id from public.barbers b where b.id = 'eb000000-0000-4000-8000-000000001906' $q$,
  'fetta 5: anon non legge servizi e barbieri disattivati');

select pg_temp.act_as_postgres();
select * from finish();
rollback;
