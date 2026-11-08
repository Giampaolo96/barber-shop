-- Test di accettazione – FETTA 8h "Sicurezza dati" (SPEC §11 riga 8h; audit 2026-10-30 punti 2 e 3;
-- decisioni approvate dall'utente il 2026-11-08).
-- 30 – Privilegi staff solo con sessione da password; availability_inputs_json.
--
-- Punto 2: is_admin(), is_staff() e current_barber_id() valgono solo se il token dice che l'accesso
-- è avvenuto con password: coalesce(auth.jwt() -> 'amr', '[]'::jsonb) @> '[{"method":"password"}]'.
-- Uno staff entrato con codice email (amr otp), dopo un recupero (amr recovery) o con un token senza
-- amr ha nel database gli stessi diritti di un cliente. Il cliente non è toccato.
-- Punto 3: public.availability_inputs_json(p_service_id uuid, p_barber_id uuid, p_from timestamptz,
-- p_to timestamptz) returns jsonb – array di {kind, barber_id, starts_at, ends_at} con le stesse righe
-- di availability_inputs (che resta); '[]' senza righe; security definer, search_path = '';
-- execute ad anon e authenticated, non a PUBLIC.
--
-- Le chiamate passano da helper che intercettano gli errori: se una funzione manca il test fallisce
-- mostrando il codice, senza interrompere il file. Dati creati dal test, annullati dal rollback.
-- Non modificare durante l'implementazione.
begin;
create extension if not exists pgtap with schema extensions;

select plan(47);

-- ---------------------------------------------------------------------------
-- Helper
-- ---------------------------------------------------------------------------
-- Utente autenticato con il claim amr dato (null = claim assente)
create function pg_temp.act_as(uid uuid, amr jsonb) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims',
    (jsonb_build_object('sub', uid, 'role', 'authenticated')
       || case when amr is null then '{}'::jsonb else jsonb_build_object('amr', amr) end)::text, true);
  set local role authenticated;
end $f$;

create function pg_temp.act_as_anon() returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;

create function pg_temp.act_as_postgres() returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $f$;

-- 'rows:N' se il comando riesce, altrimenti lo SQLSTATE. Il comando viene sempre annullato: i controlli di scrittura non cambiano i dati
-- usati dai controlli successivi
create function pg_temp.dry(q text) returns text language plpgsql as $f$
declare n bigint;
begin
  begin
    execute q;
    get diagnostics n = row_count;
    raise exception 'dry-run' using errcode = 'P0D01';
  exception when sqlstate 'P0D01' then
    return 'rows:' || n;
  end;
exception when others then
  return sqlstate;
end $f$;

-- Un solo valore come testo; in caso d'errore 'ERR <sqlstate>'
create function pg_temp.val(q text) returns text language plpgsql as $f$
declare r text;
begin
  execute q into r;
  return r;
exception when others then
  return 'ERR ' || sqlstate;
end $f$;

-- Esito degli helper delle policy per l'utente corrente
create function pg_temp.flags() returns text language plpgsql as $f$
begin
  return 'admin=' || coalesce(public.is_admin()::text, 'null')
      || ' staff=' || coalesce(public.is_staff()::text, 'null')
      || ' barber=' || coalesce(public.current_barber_id()::text, 'null');
exception when others then
  return 'ERR ' || sqlstate;
end $f$;

-- Righe di prova visibili all'utente corrente (RLS)
create function pg_temp.seen() returns text language plpgsql as $f$
declare b bigint; n bigint; c bigint; t bigint;
begin
  select count(*) into b from public.bookings
   where id in ('ed800000-0000-4000-8000-0000000030a1', 'ed800000-0000-4000-8000-0000000030a2');
  select count(*) into n from public.booking_staff_notes
   where booking_id in ('ed800000-0000-4000-8000-0000000030a1', 'ed800000-0000-4000-8000-0000000030a2');
  select count(*) into c from public.profiles
   where id in ('e8000000-0000-4000-8000-0000000030c1', 'e8000000-0000-4000-8000-0000000030c2');
  select count(*) into t from public.time_off
   where barber_id in ('eb800000-0000-4000-8000-0000000030b1', 'eb800000-0000-4000-8000-0000000030b2');
  return 'bookings=' || b || ' notes=' || n || ' customers=' || c || ' time_off=' || t;
exception when others then
  return 'ERR ' || sqlstate;
end $f$;

-- availability_inputs_json contro availability_inputs, stessi argomenti e stesso now() (transazione):
-- 'same rows:N' se le righe coincidono (come multiinsieme), altrimenti le differenze
create function pg_temp.json_vs_table(svc uuid, d_from timestamptz, d_to timestamptz) returns text
language plpgsql as $f$
declare only_json bigint; only_table bigint; n bigint;
begin
  execute $q$
    with j as (
      select x.kind, x.barber_id, x.starts_at, x.ends_at
        from jsonb_to_recordset(public.availability_inputs_json($1, null, $2, $3))
               as x(kind text, barber_id uuid, starts_at timestamptz, ends_at timestamptz)
    ),
    t as (
      select a.kind::text as kind, a.barber_id, a.starts_at, a.ends_at
        from public.availability_inputs($1, null, $2, $3) a
    )
    select (select count(*) from (select * from j except all select * from t) d1),
           (select count(*) from (select * from t except all select * from j) d2),
           (select count(*) from t)
  $q$ into only_json, only_table, n using svc, d_from, d_to;
  if only_json = 0 and only_table = 0 then return 'same rows:' || n; end if;
  return 'only_json=' || only_json || ' only_table=' || only_table || ' rows:' || n;
exception when others then
  return 'ERR ' || sqlstate;
end $f$;

create function pg_temp.mk_user(uid uuid, r text, nm text, ph text, mail text) returns void language plpgsql as $f$
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          mail, '{}'::jsonb, '{}'::jsonb, now(), now());
  update public.profiles
     set role = r::public.user_role, full_name = nm, phone = ph,
         privacy_policy_version = (select ss.privacy_policy_version from public.shop_settings ss),
         privacy_consent_at = now()
   where id = uid;
end $f$;

-- ---------------------------------------------------------------------------
-- Dati di prova
-- ---------------------------------------------------------------------------
select pg_temp.mk_user('e8000000-0000-4000-8000-0000000030a1', 'admin', 'Pw Admin', '+390800003001', 'pw-admin@qa.test');
select pg_temp.mk_user('e8000000-0000-4000-8000-0000000030b1', 'barber', 'Pw Barbiere', '+390800003002', 'pw-barber@qa.test');
select pg_temp.mk_user('e8000000-0000-4000-8000-0000000030c1', 'customer', 'Pw Cliente Uno', '+390800003003', 'pw-c1@qa.test');
select pg_temp.mk_user('e8000000-0000-4000-8000-0000000030c2', 'customer', 'Pw Cliente Due', '+390800003004', 'pw-c2@qa.test');

insert into public.services (id, name, duration_min, price_cents, is_active) values
  ('e5800000-0000-4000-8000-000000003001', 'Pw Taglio', 30, 2000, true);
insert into public.barbers (id, display_name, is_active, profile_id) values
  ('eb800000-0000-4000-8000-0000000030b1', 'Pw Barbiere Collegato', true, 'e8000000-0000-4000-8000-0000000030b1'),
  ('eb800000-0000-4000-8000-0000000030b2', 'Pw Altro Barbiere', true, null);
insert into public.barber_services (barber_id, service_id) values
  ('eb800000-0000-4000-8000-0000000030b1', 'e5800000-0000-4000-8000-000000003001'),
  ('eb800000-0000-4000-8000-0000000030b2', 'e5800000-0000-4000-8000-000000003001');
insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, source) values
  ('ed800000-0000-4000-8000-0000000030a1', 'e8000000-0000-4000-8000-0000000030c1',
   'eb800000-0000-4000-8000-0000000030b1', 'e5800000-0000-4000-8000-000000003001', '2041-03-05 10:00:00+01', 'online'),
  ('ed800000-0000-4000-8000-0000000030a2', 'e8000000-0000-4000-8000-0000000030c2',
   'eb800000-0000-4000-8000-0000000030b2', 'e5800000-0000-4000-8000-000000003001', '2041-03-05 10:00:00+01', 'online');
insert into public.booking_staff_notes (booking_id, note) values
  ('ed800000-0000-4000-8000-0000000030a1', 'Nota interna uno'),
  ('ed800000-0000-4000-8000-0000000030a2', 'Nota interna due');
insert into public.time_off (barber_id, starts_at, ends_at, reason) values
  ('eb800000-0000-4000-8000-0000000030b1', '2041-04-01 00:00:00+02', '2041-04-02 00:00:00+02', 'Ferie'),
  ('eb800000-0000-4000-8000-0000000030b2', '2041-04-01 00:00:00+02', '2041-04-02 00:00:00+02', 'Ferie');

-- ---------------------------------------------------------------------------
-- Punto 2 – sessione da password: privilegi come oggi
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e8000000-0000-4000-8000-0000000030a1', '[{"method":"password","timestamp":1794000000}]');
select is(pg_temp.flags(), 'admin=true staff=true barber=null',
  'admin con amr password: is_admin e is_staff veri');
select is(pg_temp.seen(), 'bookings=2 notes=2 customers=2 time_off=2',
  'admin con amr password: vede prenotazioni, note interne, clienti e assenze di tutti');
select is(pg_temp.val($q$ select count(*) from public.admin_customers(null, 100, 0)
                          where id in ('e8000000-0000-4000-8000-0000000030c1', 'e8000000-0000-4000-8000-0000000030c2') $q$),
  '2', 'admin con amr password: admin_customers elenca i clienti');
select is(pg_temp.val($q$ select (public.admin_booking_stats('2041-03-01', '2041-03-31') is not null)::text $q$),
  'true', 'admin con amr password: admin_booking_stats risponde');
select is(pg_temp.dry($q$ update public.shop_settings set max_horizon_days = max_horizon_days $q$),
  'rows:1', 'admin con amr password: modifica le impostazioni');

-- MFA futura: amr con password e un secondo fattore resta una sessione da password
select pg_temp.act_as('e8000000-0000-4000-8000-0000000030a1',
  '[{"method":"totp","timestamp":1794000100},{"method":"password","timestamp":1794000000}]');
select is(pg_temp.flags(), 'admin=true staff=true barber=null',
  'admin con amr [totp, password]: privilegi (il claim contiene password)');

select pg_temp.act_as('e8000000-0000-4000-8000-0000000030b1', '[{"method":"password","timestamp":1794000000}]');
select is(pg_temp.flags(), 'admin=false staff=true barber=eb800000-0000-4000-8000-0000000030b1',
  'barbiere con amr password: is_staff vero e current_barber_id la sua scheda');
select is(pg_temp.seen(), 'bookings=1 notes=1 customers=1 time_off=1',
  'barbiere con amr password: vede le proprie prenotazioni, note, clienti e assenze');
select is(pg_temp.dry($q$ update public.bookings set notes = notes
                              where id = 'ed800000-0000-4000-8000-0000000030a1' $q$),
  'rows:1', 'barbiere con amr password: aggiorna una propria prenotazione');

-- ---------------------------------------------------------------------------
-- Punto 2 – admin senza password: nessun privilegio (otp, recovery, senza amr, amr non array)
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e8000000-0000-4000-8000-0000000030a1', '[{"method":"otp","timestamp":1794000000}]');
select is(pg_temp.flags(), 'admin=false staff=false barber=null',
  'admin con amr otp (codice email): is_admin e is_staff falsi');
select is(pg_temp.seen(), 'bookings=0 notes=0 customers=0 time_off=0',
  'admin con amr otp: nessuna prenotazione, nota interna, cliente o assenza');
select is(pg_temp.val($q$ select count(*) from public.admin_customers(null, 100, 0) $q$),
  'ERR 42501', 'admin con amr otp: admin_customers rifiutata come per un cliente');
select is(pg_temp.val($q$ select public.admin_booking_stats('2041-03-01', '2041-03-31')::text $q$),
  'ERR 42501', 'admin con amr otp: admin_booking_stats rifiutata come per un cliente');
select is(pg_temp.dry($q$ update public.shop_settings set max_horizon_days = max_horizon_days $q$),
  'rows:0', 'admin con amr otp: non modifica le impostazioni');
select is(pg_temp.dry($q$ delete from public.bookings where id = 'ed800000-0000-4000-8000-0000000030a2' $q$),
  'rows:0', 'admin con amr otp: non elimina prenotazioni');
select is(pg_temp.dry($q$ update public.profiles set is_blocked = true
                              where id = 'e8000000-0000-4000-8000-0000000030c1' $q$),
  'rows:0', 'admin con amr otp: non blocca un cliente');

select pg_temp.act_as('e8000000-0000-4000-8000-0000000030a1', '[{"method":"recovery","timestamp":1794000000}]');
select is(pg_temp.flags(), 'admin=false staff=false barber=null',
  'admin con amr recovery (recupero password): nessun privilegio, si rientra con la password');
select is(pg_temp.seen(), 'bookings=0 notes=0 customers=0 time_off=0',
  'admin con amr recovery: nessun dato dello staff');
select is(pg_temp.val($q$ select count(*) from public.admin_customers(null, 100, 0) $q$),
  'ERR 42501', 'admin con amr recovery: admin_customers rifiutata');

select pg_temp.act_as('e8000000-0000-4000-8000-0000000030a1', '[{"method":"magiclink","timestamp":1794000000}]');
select is(pg_temp.flags(), 'admin=false staff=false barber=null',
  'admin con amr magiclink: nessun privilegio');

select pg_temp.act_as('e8000000-0000-4000-8000-0000000030a1', null);
select is(pg_temp.flags(), 'admin=false staff=false barber=null',
  'admin con token senza amr: nessun privilegio');
select is(pg_temp.seen(), 'bookings=0 notes=0 customers=0 time_off=0',
  'admin con token senza amr: nessun dato dello staff');

select pg_temp.act_as('e8000000-0000-4000-8000-0000000030a1', '{"method":"password"}');
select is(pg_temp.flags(), 'admin=false staff=false barber=null',
  'admin con amr non array ({"method":"password"}): nessun privilegio');

select pg_temp.act_as('e8000000-0000-4000-8000-0000000030a1', '"password"');
select is(pg_temp.flags(), 'admin=false staff=false barber=null',
  'admin con amr stringa ("password"): nessun privilegio');

select pg_temp.act_as('e8000000-0000-4000-8000-0000000030a1', '[{"method":"otp"},{"method":"oauth"}]');
select is(pg_temp.flags(), 'admin=false staff=false barber=null',
  'admin con più metodi ma nessuno password: nessun privilegio');

-- ---------------------------------------------------------------------------
-- Punto 2 – barbiere senza password: nessun privilegio
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e8000000-0000-4000-8000-0000000030b1', '[{"method":"otp","timestamp":1794000000}]');
select is(pg_temp.flags(), 'admin=false staff=false barber=null',
  'barbiere con amr otp: is_staff falso e current_barber_id null');
select is(pg_temp.seen(), 'bookings=0 notes=0 customers=0 time_off=0',
  'barbiere con amr otp: non vede le prenotazioni, le note, i clienti né le assenze della sua scheda');
select is(pg_temp.val($q$ select count(*) from public.blocked_customer_ids(array['e8000000-0000-4000-8000-0000000030c1']::uuid[]) $q$),
  'ERR 42501', 'barbiere con amr otp: blocked_customer_ids (solo staff) rifiutata');
select is(pg_temp.dry($q$ update public.bookings set notes = notes
                              where id = 'ed800000-0000-4000-8000-0000000030a1' $q$),
  'rows:0', 'barbiere con amr otp: non aggiorna le prenotazioni della sua scheda');
select is(pg_temp.dry($q$ insert into public.time_off (barber_id, starts_at, ends_at, reason)
                              values ('eb800000-0000-4000-8000-0000000030b1', '2041-05-01 00:00:00+02',
                                      '2041-05-02 00:00:00+02', 'Otp') $q$),
  '42501', 'barbiere con amr otp: non inserisce assenze per la sua scheda');

select pg_temp.act_as('e8000000-0000-4000-8000-0000000030b1', '[{"method":"recovery","timestamp":1794000000}]');
select is(pg_temp.flags(), 'admin=false staff=false barber=null',
  'barbiere con amr recovery: nessun privilegio');
select is(pg_temp.seen(), 'bookings=0 notes=0 customers=0 time_off=0',
  'barbiere con amr recovery: nessun dato dello staff');

select pg_temp.act_as('e8000000-0000-4000-8000-0000000030b1', null);
select is(pg_temp.flags(), 'admin=false staff=false barber=null',
  'barbiere con token senza amr: nessun privilegio');

-- ---------------------------------------------------------------------------
-- Punto 2 – il cliente non è toccato: con codice email o senza amr vede le sue prenotazioni
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e8000000-0000-4000-8000-0000000030c1', '[{"method":"otp","timestamp":1794000000}]');
select is(public.current_user_role()::text, 'customer', 'cliente con amr otp: current_user_role() = customer');
select is(pg_temp.seen(), 'bookings=1 notes=0 customers=1 time_off=0',
  'cliente con amr otp: vede la sua prenotazione e il suo profilo, nient''altro');
select is(pg_temp.flags(), 'admin=false staff=false barber=null', 'cliente con amr otp: nessun privilegio staff');

select pg_temp.act_as('e8000000-0000-4000-8000-0000000030c1', null);
select is(pg_temp.seen(), 'bookings=1 notes=0 customers=1 time_off=0',
  'cliente senza amr: vede la sua prenotazione come prima');

-- ---------------------------------------------------------------------------
-- Punto 3 – availability_inputs_json: struttura, grant, stessa uscita di availability_inputs
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

select ok(to_regprocedure('public.availability_inputs_json(uuid, uuid, timestamptz, timestamptz)') is not null,
  'esiste public.availability_inputs_json(uuid, uuid, timestamptz, timestamptz)');
select is(
  (select pg_get_function_result(p.oid) from pg_proc p
    where p.oid = to_regprocedure('public.availability_inputs_json(uuid, uuid, timestamptz, timestamptz)')),
  'jsonb', 'availability_inputs_json restituisce un solo jsonb (niente taglio a max_rows)');
select ok(coalesce((select p.prosecdef and 'search_path=""' = any(p.proconfig) from pg_proc p
                     where p.oid = to_regprocedure('public.availability_inputs_json(uuid, uuid, timestamptz, timestamptz)')), false),
  'availability_inputs_json: security definer con search_path vuoto');
select is(
  (select array[has_function_privilege('anon', p.oid, 'execute'),
                has_function_privilege('authenticated', p.oid, 'execute'),
                coalesce((select bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE')
                            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), false)]
     from pg_proc p
    where p.oid = to_regprocedure('public.availability_inputs_json(uuid, uuid, timestamptz, timestamptz)')),
  array[true, true, false],
  'availability_inputs_json: execute ad anon e authenticated, non a PUBLIC');
select ok(to_regprocedure('public.availability_inputs(uuid, uuid, timestamptz, timestamptz)') is not null,
  'availability_inputs resta (la usano i test e i dati esistenti)');

select pg_temp.act_as_anon();
-- Seed: Taglio, tutti i barbieri, le prossime due settimane (fasce, assenze, chiusure, prenotazioni)
select is(pg_temp.json_vs_table('50000000-0000-4000-8000-000000000001', now(), now() + interval '14 days'),
  'same rows:' || (select count(*) from public.availability_inputs('50000000-0000-4000-8000-000000000001', null,
                                                                   now(), now() + interval '14 days')),
  'anon: availability_inputs_json ha le stesse righe di availability_inputs (seed, Taglio, 14 giorni)');
select is(pg_temp.val($q$ select string_agg(distinct s.keys, ' | ')
                          from (select (select array_agg(k order by k) from jsonb_object_keys(e) k)::text as keys
                                  from jsonb_array_elements(public.availability_inputs_json(
                                         '50000000-0000-4000-8000-000000000001', null, now(), now() + interval '14 days')) e) s $q$),
  '{barber_id,ends_at,kind,starts_at}', 'ogni elemento ha solo kind, barber_id, starts_at, ends_at (CLAUDE.md regola 6)');
select is(pg_temp.val($q$ select public.availability_inputs_json('50000000-0000-4000-8000-000000000001', null,
                                                                 now() + interval '2 days', now() + interval '1 day')::text $q$),
  '[]', 'periodo vuoto: array vuoto [] (non null)');
select is(pg_temp.val($q$ select public.availability_inputs_json('e5800000-0000-4000-8000-0000000030ff', null,
                                                                 '2041-01-01', '2041-01-02')::text $q$),
  '[]', 'servizio inesistente e nessuna chiusura nel periodo: array vuoto []');

select pg_temp.act_as('e8000000-0000-4000-8000-0000000030c1', '[{"method":"otp","timestamp":1794000000}]');
select is(pg_temp.json_vs_table('50000000-0000-4000-8000-000000000001', now(), now() + interval '14 days'),
  'same rows:' || (select count(*) from public.availability_inputs('50000000-0000-4000-8000-000000000001', null,
                                                                   now(), now() + interval '14 days')),
  'cliente: availability_inputs_json ha le stesse righe di availability_inputs');

select pg_temp.act_as_postgres();
select * from finish();
rollback;
