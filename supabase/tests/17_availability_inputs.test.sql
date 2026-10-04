-- Test di accettazione – FETTA 4 (SPEC §11: "Motore disponibilità").
-- 17 – availability_inputs: dati minimi per il motore puro, leggibili da anon senza service_role.
-- SPEC §4 (passi 1–3, "solo orari, mai dati di altre prenotazioni"), §3.4 (fasce in ora locale),
-- §3.7.3 (barbiere abilitato), §12 (ora legale con date fisse, barbiere non abilitato), CLAUDE.md – regole 2 e 6,
-- Sicurezza + decisioni approvate per la fetta 4.
-- Interfaccia attesa:
--   public.availability_inputs(p_service_id uuid, p_barber_id uuid, p_from timestamptz, p_to timestamptz)
--     returns table (kind text, barber_id uuid, starts_at timestamptz, ends_at timestamptz)
--     security definer, stable, search_path = ''; eseguibile da anon e authenticated, non da PUBLIC.
--   kind: 'work' (fasce convertite nella timezone di shop_settings), 'time_off', 'closure'
--   (barber_id null), 'busy' (solo confirmed, ends_at = blocked_until).
--   Solo barbieri attivi abilitati a un servizio attivo (p_barber_id null = tutti i candidati).
--   Intervalli tagliati su [p_from, p_to) ∩ [now(), inizio del giorno locale oggi + max_horizon_days + 1).
--   public.local_band_to_interval(p_date date, p_start time, p_end time, p_tz text) returns tstzrange
--     conversione di una fascia locale in intervallo concreto ('[)'), usata da availability_inputs;
--     immutable o stable, search_path = ''; nessun grant (né PUBLIC, né anon, né authenticated).
-- Scelte di questo test (decisioni lasciate a spec-qa):
--   - le chiusure del negozio compaiono anche quando non c'è nessun barbiere candidato;
--   - p_from >= p_to restituisce zero righe (nessun errore);
--   - le fasce di lavoro non sono ridotte da assenze, chiusure o prenotazioni: la sottrazione
--     la fa il motore.
-- I dati sono creati dal test e annullati dal rollback. Non modificare durante l'implementazione.
begin;
create extension if not exists pgtap with schema extensions;

select plan(39);

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
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

create function pg_temp.can_exec(r text, sig text) returns boolean language plpgsql as $f$
begin
  return has_function_privilege(r, sig, 'execute');
exception when others then
  return null;
end $f$;

create function pg_temp.fn(fname text) returns oid language sql as $f$
  select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = fname
$f$;

-- Chiamata della funzione con il ruolo corrente. Se la funzione manca restituisce una riga
-- 'missing', così anche i controlli "nessuna riga" falliscono finché non esiste.
create function pg_temp.ai(s uuid, b uuid, f timestamptz, t timestamptz)
returns table (kind text, barber_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql as $f$
begin
  return query execute
    'select r.kind::text, r.barber_id, r.starts_at, r.ends_at
       from public.availability_inputs($1, $2, $3, $4) r'
    using s, b, f, t;
exception when undefined_function then
  return query select 'missing'::text, null::uuid, null::timestamptz, null::timestamptz;
end $f$;

-- Date e istanti (calcolati, nessuna tabella: utilizzabili anche da anon)
create function pg_temp.today() returns date language sql stable as $f$
  select (now() at time zone 'Europe/Rome')::date
$f$;
create function pg_temp.loc(d date, t text) returns timestamptz language sql stable as $f$
  select (d + t::time) at time zone 'Europe/Rome'
$f$;
-- Giorno di riferimento: almeno dopodomani, mai di domenica
create function pg_temp.d() returns date language sql stable as $f$
  select min(x)::date from generate_series((pg_temp.today() + 2)::timestamp, (pg_temp.today() + 4)::timestamp, interval '1 day') x
   where extract(isodow from x) <> 7
$f$;
-- Conversione di una fascia con il ruolo corrente; null se la funzione manca
create function pg_temp.lbi(d date, st time, en time, tz text) returns tstzrange language plpgsql as $f$
declare r tstzrange;
begin
  execute 'select public.local_band_to_interval($1, $2, $3, $4)' into r using d, st, en, tz;
  return r;
exception when undefined_function then
  return null;
end $f$;

-- ---------------------------------------------------------------------------
-- Dati (come postgres)
-- ---------------------------------------------------------------------------
update public.shop_settings
   set timezone = 'Europe/Rome', max_horizon_days = 365, buffer_min = 0;
delete from public.shop_closures;

insert into public.services (id, name, duration_min, price_cents, is_active) values
  ('e5000000-0000-4000-8000-000000001701', 'F4 Taglio', 30, 2000, true),
  ('e5000000-0000-4000-8000-000000001702', 'F4 Disattivato', 30, 2000, false);
insert into public.barbers (id, display_name, is_active) values
  ('eb000000-0000-4000-8000-000000001701', 'F4 Uno', true),
  ('eb000000-0000-4000-8000-000000001702', 'F4 Non abilitato', true),
  ('eb000000-0000-4000-8000-000000001703', 'F4 Inattivo', false),
  ('eb000000-0000-4000-8000-000000001704', 'F4 Quattro', true);
insert into public.barber_services (barber_id, service_id) values
  ('eb000000-0000-4000-8000-000000001701', 'e5000000-0000-4000-8000-000000001701'),
  ('eb000000-0000-4000-8000-000000001701', 'e5000000-0000-4000-8000-000000001702'),
  ('eb000000-0000-4000-8000-000000001702', 'e5000000-0000-4000-8000-000000001702'),
  ('eb000000-0000-4000-8000-000000001703', 'e5000000-0000-4000-8000-000000001701'),
  ('eb000000-0000-4000-8000-000000001704', 'e5000000-0000-4000-8000-000000001701');

-- Tutti i giorni 09:00–13:00 e 15:00–19:00; Uno anche la domenica 00:00–05:00
insert into public.working_hours (barber_id, weekday, start_time, end_time)
select b.id, wd, f.s, f.e
  from (values ('eb000000-0000-4000-8000-000000001701'::uuid), ('eb000000-0000-4000-8000-000000001702'),
               ('eb000000-0000-4000-8000-000000001703'), ('eb000000-0000-4000-8000-000000001704')) b (id)
 cross join generate_series(1, 7) wd
 cross join (values ('09:00'::time, '13:00'::time), ('15:00', '19:00')) f (s, e);
insert into public.working_hours (barber_id, weekday, start_time, end_time)
values ('eb000000-0000-4000-8000-000000001701', 7, '00:00', '05:00');

insert into public.time_off (barber_id, starts_at, ends_at) values
  ('eb000000-0000-4000-8000-000000001701', pg_temp.loc(pg_temp.d(), '10:00'), pg_temp.loc(pg_temp.d(), '11:00')),
  ('eb000000-0000-4000-8000-000000001701', now() - interval '5 days', now() - interval '5 days' + interval '2 hours'),
  ('eb000000-0000-4000-8000-000000001702', pg_temp.loc(pg_temp.d(), '10:00'), pg_temp.loc(pg_temp.d(), '11:00')),
  ('eb000000-0000-4000-8000-000000001704', pg_temp.loc(pg_temp.d() + 1, '10:00'), pg_temp.loc(pg_temp.d() + 1, '11:00'));

insert into public.shop_closures (starts_at, ends_at) values
  (pg_temp.loc(pg_temp.d(), '18:00'), pg_temp.loc(pg_temp.d(), '20:00')),
  (pg_temp.loc(pg_temp.d() + 20, '00:00'), pg_temp.loc(pg_temp.d() + 21, '00:00'));

-- Prenotazione con buffer copiato di 10' (blocked_until = fine + 10')
update public.shop_settings set buffer_min = 10;
insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, status, source) values
  ('F4 Ospite', '+390300001701', 'eb000000-0000-4000-8000-000000001701', 'e5000000-0000-4000-8000-000000001701',
   pg_temp.loc(pg_temp.d(), '09:00'), 'confirmed', 'manual');
update public.shop_settings set buffer_min = 0;
insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, status, source) values
  -- cancellata: non occupa
  ('F4 Ospite', '+390300001701', 'eb000000-0000-4000-8000-000000001701', 'e5000000-0000-4000-8000-000000001701',
   pg_temp.loc(pg_temp.d(), '11:00'), 'cancelled_by_customer', 'manual'),
  -- passata: fuori dal periodo consentito
  ('F4 Ospite', '+390300001701', 'eb000000-0000-4000-8000-000000001701', 'e5000000-0000-4000-8000-000000001701',
   now() - interval '3 days', 'confirmed', 'manual'),
  ('F4 Ospite', '+390300001701', 'eb000000-0000-4000-8000-000000001704', 'e5000000-0000-4000-8000-000000001701',
   pg_temp.loc(pg_temp.d(), '15:00'), 'confirmed', 'manual');

-- ---------------------------------------------------------------------------
-- 1. Struttura e privilegi (CLAUDE.md – Sicurezza, regola 6)
-- ---------------------------------------------------------------------------
select has_function('public', 'availability_inputs',
  array['uuid', 'uuid', 'timestamp with time zone', 'timestamp with time zone'],
  'fetta 4: esiste public.availability_inputs(uuid, uuid, timestamptz, timestamptz)');
select is(pg_get_function_identity_arguments(pg_temp.fn('availability_inputs')),
  'p_service_id uuid, p_barber_id uuid, p_from timestamp with time zone, p_to timestamp with time zone',
  'fetta 4: nomi dei parametri (chiamata RPC con argomenti nominati)');
select is(pg_get_function_result(pg_temp.fn('availability_inputs')),
  'TABLE(kind text, barber_id uuid, starts_at timestamp with time zone, ends_at timestamp with time zone)',
  'SPEC §4 / CLAUDE.md regola 6: solo kind, barber_id, starts_at, ends_at (nessun dato di clienti o prenotazioni)');
select is((select prosecdef from pg_proc where oid = pg_temp.fn('availability_inputs')), true,
  'fetta 4: availability_inputs è security definer');
select is((select provolatile::text from pg_proc where oid = pg_temp.fn('availability_inputs')), 's',
  'fetta 4: availability_inputs è stable');
select is(
  (select coalesce(bool_or(c ~ '^search_path=("")?$'), false)
     from pg_proc p, unnest(p.proconfig) c where p.oid = pg_temp.fn('availability_inputs')),
  true, 'CLAUDE.md – Sicurezza: availability_inputs fissa search_path = ''''');
select is(
  (select bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE')
     from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = pg_temp.fn('availability_inputs')),
  false, 'CLAUDE.md – Sicurezza: availability_inputs non è eseguibile da PUBLIC');
select is(pg_temp.can_exec('anon',
  'public.availability_inputs(uuid, uuid, timestamptz, timestamptz)'), true,
  'SPEC §5: availability_inputs è eseguibile da anon (disponibilità senza login)');
select is(pg_temp.can_exec('authenticated',
  'public.availability_inputs(uuid, uuid, timestamptz, timestamptz)'), true,
  'availability_inputs è eseguibile da authenticated');

-- ---------------------------------------------------------------------------
-- 2. Contenuto per un barbiere (anon)
-- ---------------------------------------------------------------------------
select pg_temp.act_as_anon();

-- SPEC §4.1–3: fasce in istanti reali, assenza, chiusura, solo la confirmed con blocked_until
select results_eq(
  $q$ select kind, barber_id, starts_at, ends_at
        from pg_temp.ai('e5000000-0000-4000-8000-000000001701', 'eb000000-0000-4000-8000-000000001701',
                        pg_temp.loc(pg_temp.d(), '00:00'), pg_temp.loc(pg_temp.d() + 1, '00:00'))
       order by kind, starts_at $q$,
  $q$ values
        ('busy'::text, 'eb000000-0000-4000-8000-000000001701'::uuid, pg_temp.loc(pg_temp.d(), '09:00'), pg_temp.loc(pg_temp.d(), '09:40')),
        ('closure', null, pg_temp.loc(pg_temp.d(), '18:00'), pg_temp.loc(pg_temp.d(), '20:00')),
        ('time_off', 'eb000000-0000-4000-8000-000000001701', pg_temp.loc(pg_temp.d(), '10:00'), pg_temp.loc(pg_temp.d(), '11:00')),
        ('work', 'eb000000-0000-4000-8000-000000001701', pg_temp.loc(pg_temp.d(), '09:00'), pg_temp.loc(pg_temp.d(), '13:00')),
        ('work', 'eb000000-0000-4000-8000-000000001701', pg_temp.loc(pg_temp.d(), '15:00'), pg_temp.loc(pg_temp.d(), '19:00')) $q$,
  'SPEC §4.1–3: work, time_off, closure e busy del giorno; busy solo confirmed e fino a blocked_until');

-- Bordi: gli intervalli sono tagliati su [p_from, p_to), niente fuori periodo
select results_eq(
  $q$ select kind, barber_id, starts_at, ends_at
        from pg_temp.ai('e5000000-0000-4000-8000-000000001701', 'eb000000-0000-4000-8000-000000001701',
                        pg_temp.loc(pg_temp.d(), '09:15'), pg_temp.loc(pg_temp.d(), '12:00'))
       order by kind, starts_at $q$,
  $q$ values
        ('busy'::text, 'eb000000-0000-4000-8000-000000001701'::uuid, pg_temp.loc(pg_temp.d(), '09:15'), pg_temp.loc(pg_temp.d(), '09:40')),
        ('time_off', 'eb000000-0000-4000-8000-000000001701', pg_temp.loc(pg_temp.d(), '10:00'), pg_temp.loc(pg_temp.d(), '11:00')),
        ('work', 'eb000000-0000-4000-8000-000000001701', pg_temp.loc(pg_temp.d(), '09:15'), pg_temp.loc(pg_temp.d(), '12:00')) $q$,
  'fetta 4: intervalli tagliati sul periodo richiesto, nessuna riga fuori periodo');

select is_empty(
  $q$ select 1 from pg_temp.ai('e5000000-0000-4000-8000-000000001701', 'eb000000-0000-4000-8000-000000001701',
                               pg_temp.loc(pg_temp.d(), '12:00'), pg_temp.loc(pg_temp.d(), '12:00')) $q$,
  'fetta 4: p_from = p_to → nessuna riga');
select is_empty(
  $q$ select 1 from pg_temp.ai('e5000000-0000-4000-8000-000000001701', 'eb000000-0000-4000-8000-000000001701',
                               pg_temp.loc(pg_temp.d() + 1, '00:00'), pg_temp.loc(pg_temp.d(), '00:00')) $q$,
  'fetta 4: p_from > p_to → nessuna riga (nessun errore)');

-- ---------------------------------------------------------------------------
-- 3. Candidati: barbieri attivi abilitati a un servizio attivo (SPEC §3.7.3, §12)
-- ---------------------------------------------------------------------------
select results_eq(
  $q$ select distinct barber_id
        from pg_temp.ai('e5000000-0000-4000-8000-000000001701', null,
                        pg_temp.loc(pg_temp.d(), '00:00'), pg_temp.loc(pg_temp.d() + 1, '00:00'))
       where barber_id is not null order by 1 $q$,
  $q$ values ('eb000000-0000-4000-8000-000000001701'::uuid), ('eb000000-0000-4000-8000-000000001704') $q$,
  'SPEC §4: "qualsiasi" → solo i barbieri attivi abilitati al servizio');
select results_eq(
  $q$ select kind, starts_at, ends_at
        from pg_temp.ai('e5000000-0000-4000-8000-000000001701', null,
                        pg_temp.loc(pg_temp.d(), '00:00'), pg_temp.loc(pg_temp.d() + 1, '00:00'))
       where barber_id = 'eb000000-0000-4000-8000-000000001704' order by kind, starts_at $q$,
  $q$ values
        ('busy'::text, pg_temp.loc(pg_temp.d(), '15:00'), pg_temp.loc(pg_temp.d(), '15:30')),
        ('work', pg_temp.loc(pg_temp.d(), '09:00'), pg_temp.loc(pg_temp.d(), '13:00')),
        ('work', pg_temp.loc(pg_temp.d(), '15:00'), pg_temp.loc(pg_temp.d(), '19:00')) $q$,
  'SPEC §4: "qualsiasi" → dati di ogni candidato, senza l''assenza di un altro giorno');

select results_eq(
  $q$ select kind, barber_id, starts_at, ends_at
        from pg_temp.ai('e5000000-0000-4000-8000-000000001701', 'eb000000-0000-4000-8000-000000001702',
                        pg_temp.loc(pg_temp.d(), '00:00'), pg_temp.loc(pg_temp.d() + 1, '00:00')) $q$,
  $q$ values ('closure'::text, null::uuid, pg_temp.loc(pg_temp.d(), '18:00'), pg_temp.loc(pg_temp.d(), '20:00')) $q$,
  'SPEC §12: barbiere non abilitato al servizio → nessuna riga del barbiere (le chiusure restano)');
select is_empty(
  $q$ select 1 from pg_temp.ai('e5000000-0000-4000-8000-000000001701', 'eb000000-0000-4000-8000-000000001703',
                               pg_temp.loc(pg_temp.d(), '00:00'), pg_temp.loc(pg_temp.d() + 1, '00:00'))
       where kind <> 'closure' or barber_id is not null $q$,
  'SPEC §4: barbiere disattivato → nessuna riga del barbiere');
select is_empty(
  $q$ select 1 from pg_temp.ai('e5000000-0000-4000-8000-000000001702', 'eb000000-0000-4000-8000-000000001701',
                               pg_temp.loc(pg_temp.d(), '00:00'), pg_temp.loc(pg_temp.d() + 1, '00:00'))
       where kind <> 'closure' or barber_id is not null $q$,
  'SPEC §3.2: servizio disattivato → nessuna riga di barbiere');
select is_empty(
  $q$ select 1 from pg_temp.ai('e5000000-0000-4000-8000-0000000017ff', null,
                               pg_temp.loc(pg_temp.d(), '00:00'), pg_temp.loc(pg_temp.d() + 1, '00:00'))
       where kind <> 'closure' or barber_id is not null $q$,
  'fetta 4: servizio inesistente → nessuna riga di barbiere');
select is_empty(
  $q$ select 1 from pg_temp.ai('e5000000-0000-4000-8000-000000001702', null,
                               pg_temp.loc(pg_temp.d(), '00:00'), pg_temp.loc(pg_temp.d() + 1, '00:00'))
       where kind <> 'closure' or barber_id is not null $q$,
  'SPEC §3.2: servizio disattivato con "qualsiasi" → nessuna riga di barbiere');

-- ---------------------------------------------------------------------------
-- 4. Periodo limitato a [now(), fine di oggi + max_horizon_days) (decisione fetta 4)
-- ---------------------------------------------------------------------------
select is_empty(
  $q$ select 1 from pg_temp.ai('e5000000-0000-4000-8000-000000001701', 'eb000000-0000-4000-8000-000000001701',
                               now() - interval '30 days', now() - interval '1 hour') $q$,
  'fetta 4: nessun dato storico (periodo interamente passato → nessuna riga)');

select pg_temp.act_as_postgres();
update public.shop_settings set max_horizon_days = 5;
select pg_temp.act_as_anon();

select is(
  (select bool_and(starts_at >= now())
     from pg_temp.ai('e5000000-0000-4000-8000-000000001701', 'eb000000-0000-4000-8000-000000001701',
                     now() - interval '30 days', now() + interval '400 days')),
  true, 'fetta 4: nessun intervallo prima di now() (la prenotazione e l''assenza passate non escono)');
select is(
  (select bool_and(ends_at <= pg_temp.loc(pg_temp.today() + 6, '00:00'))
     from pg_temp.ai('e5000000-0000-4000-8000-000000001701', 'eb000000-0000-4000-8000-000000001701',
                     now() - interval '30 days', now() + interval '400 days')),
  true, 'fetta 4: nessun intervallo oltre la fine del giorno locale di oggi + max_horizon_days');
select is(
  (select bool_or(kind = 'work' and starts_at >= pg_temp.loc(pg_temp.today() + 5, '00:00'))
     from pg_temp.ai('e5000000-0000-4000-8000-000000001701', 'eb000000-0000-4000-8000-000000001701',
                     now() - interval '30 days', now() + interval '400 days')),
  true, 'fetta 4: l''ultimo giorno dell''orizzonte è incluso');

select pg_temp.act_as_postgres();
update public.shop_settings set max_horizon_days = 365;

-- ---------------------------------------------------------------------------
-- 5. Conversione delle fasce: local_band_to_interval con date fisse (SPEC §3.4, §4.1, §12)
-- ---------------------------------------------------------------------------
select has_function('public', 'local_band_to_interval',
  array['date', 'time without time zone', 'time without time zone', 'text'],
  'fetta 4: esiste public.local_band_to_interval(date, time, time, text)');
select ok(coalesce((select provolatile in ('i', 's') from pg_proc where oid = pg_temp.fn('local_band_to_interval')), false),
  'fetta 4: local_band_to_interval è immutable o stable');
select is(
  (select coalesce(bool_or(c ~ '^search_path=("")?$'), false)
     from pg_proc p, unnest(p.proconfig) c where p.oid = pg_temp.fn('local_band_to_interval')),
  true, 'CLAUDE.md – Sicurezza: local_band_to_interval fissa search_path = ''''');
select is(
  (select bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE')
     from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = pg_temp.fn('local_band_to_interval')),
  false, 'CLAUDE.md – Sicurezza: local_band_to_interval non è eseguibile da PUBLIC');
select is(pg_temp.can_exec('anon', 'public.local_band_to_interval(date, time, time, text)'), false,
  'fetta 4: local_band_to_interval non è eseguibile da anon');
select is(pg_temp.can_exec('authenticated', 'public.local_band_to_interval(date, time, time, text)'), false,
  'fetta 4: local_band_to_interval non è eseguibile da authenticated');

-- Ora solare: domenica 25/10/2026, giorno di 25 ore
select is(pg_temp.lbi('2026-10-25', '00:00', '05:00', 'Europe/Rome'),
  tstzrange('2026-10-24 22:00:00+00', '2026-10-25 04:00:00+00', '[)'),
  'SPEC §12: ora solare 25/10/2026 – 00:00–05:00 dura 6 ore');
select is(pg_temp.lbi('2026-10-25', '09:00', '13:00', 'Europe/Rome'),
  tstzrange('2026-10-25 08:00:00+00', '2026-10-25 12:00:00+00', '[)'),
  'SPEC §12: ora solare 25/10/2026 – 09:00–13:00 a +01:00');
select is(pg_temp.lbi('2026-10-25', '15:00', '19:00', 'Europe/Rome'),
  tstzrange('2026-10-25 14:00:00+00', '2026-10-25 18:00:00+00', '[)'),
  'SPEC §12: ora solare 25/10/2026 – 15:00–19:00 a +01:00');
-- Ora legale: domenica 28/03/2027, giorno di 23 ore
select is(pg_temp.lbi('2027-03-28', '00:00', '05:00', 'Europe/Rome'),
  tstzrange('2027-03-27 23:00:00+00', '2027-03-28 03:00:00+00', '[)'),
  'SPEC §12: ora legale 28/03/2027 – 00:00–05:00 dura 4 ore');
select is(pg_temp.lbi('2027-03-28', '09:00', '13:00', 'Europe/Rome'),
  tstzrange('2027-03-28 07:00:00+00', '2027-03-28 11:00:00+00', '[)'),
  'SPEC §12: ora legale 28/03/2027 – 09:00–13:00 a +02:00');
select is(pg_temp.lbi('2027-03-28', '15:00', '19:00', 'Europe/Rome'),
  tstzrange('2027-03-28 13:00:00+00', '2027-03-28 17:00:00+00', '[)'),
  'SPEC §12: ora legale 28/03/2027 – 15:00–19:00 a +02:00');
-- Giorno normale
select is(pg_temp.lbi('2027-01-12', '09:00', '13:00', 'Europe/Rome'),
  tstzrange('2027-01-12 08:00:00+00', '2027-01-12 12:00:00+00', '[)'),
  'SPEC §3.4: giorno normale – 09:00–13:00 a +01:00');

-- availability_inputs usa la stessa conversione per qualunque giorno (indipendente dal calendario)
select results_eq(
  $q$ select starts_at, ends_at
        from pg_temp.ai('e5000000-0000-4000-8000-000000001701', 'eb000000-0000-4000-8000-000000001701',
                        pg_temp.loc(pg_temp.today() + 3, '00:00'), pg_temp.loc(pg_temp.today() + 4, '00:00'))
       where kind = 'work' order by starts_at $q$,
  $q$ select lower(r), upper(r)
        from (select pg_temp.lbi(pg_temp.today() + 3, wh.start_time, wh.end_time, 'Europe/Rome') r
                from public.working_hours wh
               where wh.barber_id = 'eb000000-0000-4000-8000-000000001701'
                 and wh.weekday = extract(isodow from pg_temp.today() + 3)) x
       order by 1 $q$,
  'SPEC §4.1: righe work = local_band_to_interval delle fasce del giorno (oggi + 3)');
select results_eq(
  $q$ select starts_at, ends_at
        from pg_temp.ai('e5000000-0000-4000-8000-000000001701', 'eb000000-0000-4000-8000-000000001701',
                        pg_temp.loc(pg_temp.today(), '00:00'), pg_temp.loc(pg_temp.today() + 1, '00:00'))
       where kind = 'work' order by starts_at $q$,
  $q$ select greatest(lower(r), now()), upper(r)
        from (select pg_temp.lbi(pg_temp.today(), wh.start_time, wh.end_time, 'Europe/Rome') r
                from public.working_hours wh
               where wh.barber_id = 'eb000000-0000-4000-8000-000000001701'
                 and wh.weekday = extract(isodow from pg_temp.today())) x
       where upper(r) > now() or r is null  -- funzione mancante: righe null, il test fallisce
       order by 1 $q$,
  'SPEC §4.1: righe work di oggi = local_band_to_interval delle fasce, tagliate a now()');

select pg_temp.act_as_postgres();
select * from finish();
rollback;
