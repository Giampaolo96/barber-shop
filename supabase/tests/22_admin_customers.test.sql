-- Test di accettazione – FETTA 6b (SPEC §11: "Admin: clienti – l'admin trova un cliente, ne vede lo
-- storico e lo blocca o sblocca").
-- 22 – Funzioni del database per la sezione Clienti: elenco con ricerca, dettaglio, azzeramento dei
-- no-show, etichetta "Bloccato" nella ricerca della prenotazione manuale.
-- SPEC §2 (clienti: solo admin), §3.1 (no_show_block_threshold, 0 = disattivato), §3.7.4, §5.3
-- (cliente bloccato manualmente o per no-show), §6.2, §6.7, §12 (cliente bloccato per no-show) +
-- decisioni approvate per la fetta 6b:
--   1. profiles.no_show_reset_at timestamptz null, profiles.no_show_reset_by uuid null
--      references profiles(id) on delete set null; nessun grant di update ad authenticated.
--      no_show_count = no-show dall'ultimo azzeramento: il trigger bookings_sync_no_show_count conta
--      una no_show solo se customer_id non è null e (no_show_reset_at è null oppure
--      bookings.starts_at >= no_show_reset_at). create_online_booking resta invariata.
--   2. public.reset_no_show_count(p_customer_id uuid) returns void – security definer, search_path
--      fissato, is_admin() all'interno (altrimenti 42501); target inesistente o non customer → P0002.
--      Imposta no_show_count = 0, no_show_reset_at = now(), no_show_reset_by = auth.uid().
--   4. public.admin_customers(q text default null, p_limit integer default 25, p_offset integer default 0)
--      returns table (id, full_name, phone, email, no_show_count, is_blocked, created_at, total_count bigint)
--      – solo customer; email da auth.users; q trim, < 2 caratteri nessun filtro, altrimenti ILIKE su
--      nome ed email con escape di % _ \ e cifre del telefono se q ha ≥ 3 cifre; ordine
--      full_name nulls last, id; p_limit in 1..100; total_count prima di limit/offset.
--   5. public.admin_customer(p_id uuid) returns table (id, full_name, phone, email, no_show_count,
--      is_blocked, no_show_reset_at, no_show_reset_by, created_at) – zero righe se non è un customer.
--   8. public.blocked_customer_ids(p_ids uuid[]) returns setof uuid – is_staff() (staff bloccato no);
--      id dell'input che sono customer bloccati per la prenotazione online.
--   Tutte: execute solo ad authenticated (non public, non anon).
--
-- Le chiamate alle funzioni nuove passano da EXECUTE dentro helper che intercettano gli errori:
-- se una funzione manca il test fallisce mostrando il codice, senza interrompere il file.
-- Esiti: 'ok' / 'rows:N' oppure SQLSTATE.
-- Dati creati dal test e annullati dal rollback; dal seed si usa solo la riga di shop_settings.
-- Non modificare durante l'implementazione.
begin;
create extension if not exists pgtap with schema extensions;

select plan(72);

-- ---------------------------------------------------------------------------
-- Helper
-- ---------------------------------------------------------------------------
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

-- Esegue un comando: 'rows:N' oppure SQLSTATE
create function pg_temp.outcome(q text) returns text language plpgsql as $f$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return 'rows:' || n;
exception when others then
  return sqlstate;
end $f$;

-- Esegue una query che restituisce un solo valore e lo rende come testo; in caso d'errore 'ERR <sqlstate>'
create function pg_temp.val(q text) returns text language plpgsql as $f$
declare r text;
begin
  execute q into r;
  return r;
exception when others then
  return 'ERR ' || sqlstate;
end $f$;

-- Esito di un comando seguito dal contatore no-show del cliente (letto con il ruolo corrente)
create function pg_temp.step(q text, customer uuid) returns text language plpgsql as $f$
declare res text; cnt text;
begin
  res := pg_temp.outcome(q);  -- prima il comando, poi la lettura del contatore
  select p.no_show_count::text into cnt from public.profiles p where p.id = customer;
  return res || ' / no_show_count=' || coalesce(cnt, 'null');
end $f$;

-- Esito di un comando seguito dai contatori no-show di due clienti (vecchio e nuovo intestatario)
create function pg_temp.step2(q text, a uuid, b uuid) returns text language plpgsql as $f$
declare res text; ca text; cb text;
begin
  res := pg_temp.outcome(q);
  select p.no_show_count::text into ca from public.profiles p where p.id = a;
  select p.no_show_count::text into cb from public.profiles p where p.id = b;
  return res || ' / a=' || coalesce(ca, 'null') || ' b=' || coalesce(cb, 'null');
end $f$;

create function pg_temp.fn_sig(sig text) returns oid language sql as $f$
  select to_regprocedure(sig)::oid
$f$;

-- security definer con search_path fissato
create function pg_temp.definer_fixed_path(sig text) returns boolean language sql as $f$
  select coalesce((select p.prosecdef
                      and exists (select 1 from unnest(p.proconfig) c where c ~ '^search_path=')
                     from pg_proc p where p.oid = pg_temp.fn_sig(sig)), false)
$f$;

-- execute: authenticated sì, anon no, PUBLIC no
create function pg_temp.grants_ok(sig text) returns boolean language plpgsql as $f$
declare f oid := pg_temp.fn_sig(sig);
begin
  if f is null then return false; end if;
  return has_function_privilege('authenticated', f, 'execute')
     and not has_function_privilege('anon', f, 'execute')
     and not coalesce((select bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE')
                         from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        where p.oid = f), false);
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
       max_horizon_days = 30, cancel_limit_min = 120, buffer_min = 0, no_show_block_threshold = 3;
delete from public.shop_closures;

-- Staff
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002201', 'admin', 'F6B Zebedeo Admin', '+393470000201', 'f6b-admin@qa.test');          -- ua
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002202', 'admin', 'F6B Admin Bloccato', '+393470000202', 'f6b-admin-off@qa.test');   -- uab
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002203', 'barber', 'F6B Zebedeo Barbiere', '+393470000203', 'f6b-barber@qa.test');  -- ub
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002204', 'barber', 'F6B Barbiere Bloccato', '+393470000204', 'f6b-barber-off@qa.test'); -- ubb
update public.profiles set is_blocked = true
 where id in ('a6b00000-0000-4000-8000-000000002202', 'a6b00000-0000-4000-8000-000000002204');

-- Clienti per la ricerca
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002211', 'customer', 'F6B Zebedeo Cliente', '+393471110001', 'f6b-c1@qa.test');          -- c1
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002212', 'customer', 'F6B Secondo', '+393471110002', 'qzunicomail.f6b@qa.test');         -- c2
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002213', 'customer', 'F6B Terzo', '+393479876543', 'f6b-c3@qa.test');                    -- c3
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002214', 'customer', 'F6B 100% Rossi', '+393472220004', 'f6b-c4@qa.test');               -- c4
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002215', 'customer', 'F6B 1000 Rossi', '+393472220005', 'f6b-c5@qa.test');               -- c5
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002216', 'customer', 'F6B a_b Verdi', '+393472220006', 'f6b-c6@qa.test');                -- c6
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002217', 'customer', 'F6B axb Verdi', '+393472220007', 'f6b-c7@qa.test');                -- c7
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002218', 'customer', 'F6B back\slash', '+393472220008', 'f6b-c8@qa.test');               -- c8
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002219', 'customer', 'F6B backslash', '+393472220009', 'f6b-c9@qa.test');                -- c9
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002220', 'customer', null, null, 'f6b-senza-nome@qa.test');                              -- c10

-- 105 clienti per la paginazione: "F6B Massa 001" … "F6B Massa 105"
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a6b00000-0000-4000-8000-000000300' || lpad(i::text, 3, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'f6b-massa-' || i || '@qa.test', '{}'::jsonb, '{}'::jsonb, now(), now()
  from generate_series(1, 105) i;
update public.profiles
   set full_name = 'F6B Massa ' || lpad(right(id::text, 3), 3, '0')
 where id::text like 'a6b00000-0000-4000-8000-000000300%';

-- Cliente con no-show (azzeramento e semantica del contatore)
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002221', 'customer', 'F6B Recidivo', '+393472220021', 'f6b-recidivo@qa.test'); -- cr

-- Clienti per blocked_customer_ids
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002231', 'customer', 'F6B Bloccato Admin', '+393472220031', 'f6b-cm@qa.test');  -- cm
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002232', 'customer', 'F6B Soglia', '+393472220032', 'f6b-ct@qa.test');          -- ct
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002233', 'customer', 'F6B Sotto Soglia', '+393472220033', 'f6b-cb@qa.test');    -- cb2
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002234', 'customer', 'F6B Pulito', '+393472220034', 'f6b-cc@qa.test');          -- cc
update public.profiles set is_blocked = true where id = 'a6b00000-0000-4000-8000-000000002231';
update public.profiles set no_show_count = 3 where id = 'a6b00000-0000-4000-8000-000000002232';
update public.profiles set no_show_count = 2 where id = 'a6b00000-0000-4000-8000-000000002233';

-- Catalogo e orari (barbiere O per l'online, barbiere N per le no-show)
insert into public.services (id, name, duration_min, price_cents, is_active) values
  ('e6b00000-0000-4000-8000-000000002201', 'F6B Taglio', 30, 2000, true);
insert into public.barbers (id, display_name, is_active) values
  ('eb6b0000-0000-4000-8000-000000002201', 'F6B O', true),
  ('eb6b0000-0000-4000-8000-000000002202', 'F6B N', true);
insert into public.barber_services (barber_id, service_id) values
  ('eb6b0000-0000-4000-8000-000000002201', 'e6b00000-0000-4000-8000-000000002201'),
  ('eb6b0000-0000-4000-8000-000000002202', 'e6b00000-0000-4000-8000-000000002201');
insert into public.working_hours (barber_id, weekday, start_time, end_time)
select 'eb6b0000-0000-4000-8000-000000002201'::uuid, wd, f.s, f.e
  from generate_series(1, 6) wd
 cross join (values ('09:00'::time, '13:00'::time), ('15:00', '19:00')) f (s, e);

-- Tre no-show passate (O1, O2, O3) e una confermata passata (P) del cliente cr
insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, status, source) values
  ('bd6b0000-0000-4000-8000-000000002201', 'a6b00000-0000-4000-8000-000000002221', 'eb6b0000-0000-4000-8000-000000002202',
   'e6b00000-0000-4000-8000-000000002201', '2024-01-10 10:00+01', 'no_show', 'manual'),
  ('bd6b0000-0000-4000-8000-000000002202', 'a6b00000-0000-4000-8000-000000002221', 'eb6b0000-0000-4000-8000-000000002202',
   'e6b00000-0000-4000-8000-000000002201', '2024-01-11 10:00+01', 'no_show', 'manual'),
  ('bd6b0000-0000-4000-8000-000000002203', 'a6b00000-0000-4000-8000-000000002221', 'eb6b0000-0000-4000-8000-000000002202',
   'e6b00000-0000-4000-8000-000000002201', '2024-01-12 10:00+01', 'no_show', 'manual'),
  ('bd6b0000-0000-4000-8000-000000002204', 'a6b00000-0000-4000-8000-000000002221', 'eb6b0000-0000-4000-8000-000000002202',
   'e6b00000-0000-4000-8000-000000002201', '2024-01-13 10:00+01', 'confirmed', 'manual');

-- Clienti per i casi aggiunti dopo l'approvazione (punti 2 e 3): cs (spostamento di orario),
-- cn1 (vecchio intestatario, mai azzerato), cn2 (nuovo intestatario, azzerato nel test)
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002241', 'customer', 'F6B Spostato', '+393472220041', 'f6b-cs@qa.test');   -- cs
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002242', 'customer', 'F6B Vecchio', '+393472220042', 'f6b-cn1@qa.test');   -- cn1
select pg_temp.mk_user('a6b00000-0000-4000-8000-000000002243', 'customer', 'F6B Nuovo', '+393472220043', 'f6b-cn2@qa.test');     -- cn2
-- S1: no-show passata di cs; T1 (passata) e T2 (all'istante now()) no-show di cn1
insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, status, source) values
  ('bd6b0000-0000-4000-8000-000000002241', 'a6b00000-0000-4000-8000-000000002241', 'eb6b0000-0000-4000-8000-000000002202',
   'e6b00000-0000-4000-8000-000000002201', '2024-02-01 10:00+01', 'no_show', 'manual'),
  ('bd6b0000-0000-4000-8000-000000002242', 'a6b00000-0000-4000-8000-000000002242', 'eb6b0000-0000-4000-8000-000000002202',
   'e6b00000-0000-4000-8000-000000002201', '2024-02-02 10:00+01', 'no_show', 'manual'),
  ('bd6b0000-0000-4000-8000-000000002243', 'a6b00000-0000-4000-8000-000000002242', 'eb6b0000-0000-4000-8000-000000002202',
   'e6b00000-0000-4000-8000-000000002201', now(), 'no_show', 'manual'),
  -- S2: seconda no-show passata di cs; U1: no-show passata di cn2 (azzerata nel test). Senza
  -- l'implementazione i contatori partono più alti e nessun passo coincide per caso con l'atteso.
  ('bd6b0000-0000-4000-8000-000000002244', 'a6b00000-0000-4000-8000-000000002241', 'eb6b0000-0000-4000-8000-000000002202',
   'e6b00000-0000-4000-8000-000000002201', '2024-02-03 10:00+01', 'no_show', 'manual'),
  ('bd6b0000-0000-4000-8000-000000002245', 'a6b00000-0000-4000-8000-000000002243', 'eb6b0000-0000-4000-8000-000000002202',
   'e6b00000-0000-4000-8000-000000002201', '2024-02-05 10:00+01', 'no_show', 'manual');

-- Totale dei clienti (nessun filtro)
select set_config('f6b.total', (select count(*)::text from public.profiles where role = 'customer'), true);

-- ===========================================================================
-- 1. Struttura (decisioni 1, 2, 4, 5, 8)
-- ===========================================================================
select ok(
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'profiles' and column_name = 'no_show_reset_at'
             and data_type = 'timestamp with time zone' and is_nullable = 'YES'),
  'decisione 1: profiles.no_show_reset_at timestamptz null');
select ok(
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'profiles' and column_name = 'no_show_reset_by'
             and data_type = 'uuid' and is_nullable = 'YES'),
  'decisione 1: profiles.no_show_reset_by uuid null');
select ok(
  exists (select 1 from pg_constraint c
           where c.conrelid = 'public.profiles'::regclass and c.contype = 'f'
             and c.confrelid = 'public.profiles'::regclass and c.confdeltype = 'n'
             and c.conkey = array[(select attnum from pg_attribute
                                    where attrelid = 'public.profiles'::regclass and attname = 'no_show_reset_by')]::int2[]),
  'decisione 1: no_show_reset_by references profiles(id) on delete set null');

select is(pg_get_function_result(pg_temp.fn_sig('public.reset_no_show_count(uuid)')), 'void',
  'decisione 2: reset_no_show_count(p_customer_id uuid) returns void');
select is(
  pg_get_function_arguments(pg_temp.fn_sig('public.admin_customers(text,integer,integer)')) || ' -> ' ||
  pg_get_function_result(pg_temp.fn_sig('public.admin_customers(text,integer,integer)')),
  'q text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0 -> '
  || 'TABLE(id uuid, full_name text, phone text, email text, no_show_count integer, is_blocked boolean, '
  || 'created_at timestamp with time zone, total_count bigint)',
  'decisione 4: firma e colonne di admin_customers');
select is(
  pg_get_function_result(pg_temp.fn_sig('public.admin_customer(uuid)')),
  'TABLE(id uuid, full_name text, phone text, email text, no_show_count integer, is_blocked boolean, '
  || 'no_show_reset_at timestamp with time zone, no_show_reset_by uuid, created_at timestamp with time zone)',
  'decisione 5: firma e colonne di admin_customer');
select is(pg_get_function_result(pg_temp.fn_sig('public.blocked_customer_ids(uuid[])')), 'SETOF uuid',
  'decisione 8: blocked_customer_ids(p_ids uuid[]) returns setof uuid');

select ok(pg_temp.definer_fixed_path('public.reset_no_show_count(uuid)'),
  'decisione 2: reset_no_show_count security definer con search_path fissato');
select ok(pg_temp.definer_fixed_path('public.admin_customers(text,integer,integer)'),
  'decisione 4: admin_customers security definer con search_path fissato');
select ok(pg_temp.definer_fixed_path('public.admin_customer(uuid)'),
  'decisione 5: admin_customer security definer con search_path fissato');
select ok(pg_temp.definer_fixed_path('public.blocked_customer_ids(uuid[])'),
  'decisione 8: blocked_customer_ids security definer con search_path fissato');

select ok(pg_temp.grants_ok('public.reset_no_show_count(uuid)'),
  'decisione 2 / CLAUDE.md: reset_no_show_count eseguibile da authenticated, non da anon né public');
select ok(pg_temp.grants_ok('public.admin_customers(text,integer,integer)'),
  'decisione 4 / CLAUDE.md: admin_customers eseguibile da authenticated, non da anon né public');
select ok(pg_temp.grants_ok('public.admin_customer(uuid)'),
  'decisione 5 / CLAUDE.md: admin_customer eseguibile da authenticated, non da anon né public');
select ok(pg_temp.grants_ok('public.blocked_customer_ids(uuid[])'),
  'decisione 8 / CLAUDE.md: blocked_customer_ids eseguibile da authenticated, non da anon né public');

-- ===========================================================================
-- 2. Accessi per ruolo (SPEC §2: clienti solo admin; decisione 8: etichetta per lo staff)
-- ===========================================================================
-- reset_no_show_count: nessuno tranne l'admin attivo (il cliente cr ha 3 no-show)
select pg_temp.act_as('a6b00000-0000-4000-8000-000000002203');
select is(pg_temp.outcome($q$ select public.reset_no_show_count('a6b00000-0000-4000-8000-000000002221') $q$),
  '42501', 'SPEC §2: il barbiere non azzera i no-show');
select pg_temp.act_as('a6b00000-0000-4000-8000-000000002221');
select is(pg_temp.outcome($q$ select public.reset_no_show_count('a6b00000-0000-4000-8000-000000002221') $q$),
  '42501', 'SPEC §2: il cliente non azzera i propri no-show');
select pg_temp.act_as('a6b00000-0000-4000-8000-000000002202');
select is(pg_temp.outcome($q$ select public.reset_no_show_count('a6b00000-0000-4000-8000-000000002221') $q$),
  '42501', 'decisione 2: l''admin bloccato non azzera i no-show');
select pg_temp.act_as_anon();
select is(pg_temp.outcome($q$ select public.reset_no_show_count('a6b00000-0000-4000-8000-000000002221') $q$),
  '42501', 'decisione 2: anon non esegue reset_no_show_count');
select pg_temp.act_as_postgres();
select is(pg_temp.val($q$ select row(no_show_count, no_show_reset_at, no_show_reset_by)::text
                           from public.profiles where id = 'a6b00000-0000-4000-8000-000000002221' $q$),
  row(3, null::timestamptz, null::uuid)::text,
  'decisione 2: dopo i tentativi rifiutati contatore e azzeramento invariati');

-- admin_customers
select pg_temp.act_as('a6b00000-0000-4000-8000-000000002203');
select is(pg_temp.outcome($q$ select * from public.admin_customers('F6B') $q$), '42501',
  'SPEC §2 / §3.7.4: il barbiere non elenca i clienti');
select pg_temp.act_as('a6b00000-0000-4000-8000-000000002221');
select is(pg_temp.outcome($q$ select * from public.admin_customers('F6B') $q$), '42501',
  'SPEC §3.7.4: il cliente non elenca gli altri clienti');
select pg_temp.act_as('a6b00000-0000-4000-8000-000000002202');
select is(pg_temp.outcome($q$ select * from public.admin_customers('F6B') $q$), '42501',
  'decisione 4: l''admin bloccato non elenca i clienti');
select pg_temp.act_as_anon();
select is(pg_temp.outcome($q$ select * from public.admin_customers('F6B') $q$), '42501',
  'decisione 4: anon non esegue admin_customers');

-- admin_customer
select pg_temp.act_as('a6b00000-0000-4000-8000-000000002203');
select is(pg_temp.outcome($q$ select * from public.admin_customer('a6b00000-0000-4000-8000-000000002212') $q$), '42501',
  'SPEC §2: il barbiere non apre la scheda di un cliente');
select pg_temp.act_as('a6b00000-0000-4000-8000-000000002221');
select is(pg_temp.outcome($q$ select * from public.admin_customer('a6b00000-0000-4000-8000-000000002212') $q$), '42501',
  'SPEC §3.7.4: il cliente non apre la scheda di un altro cliente');
select pg_temp.act_as('a6b00000-0000-4000-8000-000000002202');
select is(pg_temp.outcome($q$ select * from public.admin_customer('a6b00000-0000-4000-8000-000000002212') $q$), '42501',
  'decisione 5: l''admin bloccato non apre la scheda di un cliente');
select pg_temp.act_as_anon();
select is(pg_temp.outcome($q$ select * from public.admin_customer('a6b00000-0000-4000-8000-000000002212') $q$), '42501',
  'decisione 5: anon non esegue admin_customer');

-- blocked_customer_ids: solo staff attivo
select pg_temp.act_as('a6b00000-0000-4000-8000-000000002221');
select is(pg_temp.outcome($q$ select * from public.blocked_customer_ids(array['a6b00000-0000-4000-8000-000000002231']::uuid[]) $q$),
  '42501', 'decisione 8 / SPEC §3.7.4: il cliente non sa quali clienti sono bloccati');
select pg_temp.act_as('a6b00000-0000-4000-8000-000000002204');
select is(pg_temp.outcome($q$ select * from public.blocked_customer_ids(array['a6b00000-0000-4000-8000-000000002231']::uuid[]) $q$),
  '42501', 'decisione 8: il barbiere bloccato non esegue blocked_customer_ids');
select pg_temp.act_as_anon();
select is(pg_temp.outcome($q$ select * from public.blocked_customer_ids(array['a6b00000-0000-4000-8000-000000002231']::uuid[]) $q$),
  '42501', 'decisione 8: anon non esegue blocked_customer_ids');

-- ===========================================================================
-- 3. Ricerca ed elenco (SPEC §6.7, decisione 4) – come admin
-- ===========================================================================
select pg_temp.act_as('a6b00000-0000-4000-8000-000000002201');

select is(pg_temp.val($q$ select string_agg(id::text, ',') from public.admin_customers('  zebedeo ') $q$),
  'a6b00000-0000-4000-8000-000000002211',
  'SPEC §6.7: ricerca per nome (trim, senza distinzione di maiuscole); solo customer, mai barbieri o admin');
select is(pg_temp.val($q$ select string_agg(id::text || ' ' || email, ',') from public.admin_customers('QZUNICOMAIL') $q$),
  'a6b00000-0000-4000-8000-000000002212 qzunicomail.f6b@qa.test',
  'decisione 4: ricerca per email (da auth.users), email restituita');
select ok(pg_temp.val($q$ select bool_or(id = 'a6b00000-0000-4000-8000-000000002213')::text
                           from public.admin_customers('347 987 6543') $q$) = 'true',
  'decisione 4: ricerca per telefono sulle sole cifre');
select is(pg_temp.val($q$ select (bool_or(id = 'a6b00000-0000-4000-8000-000000002214')
                                  and not bool_or(id = 'a6b00000-0000-4000-8000-000000002215'))::text
                           from public.admin_customers('100%') $q$),
  'true', 'decisione 4: % nella ricerca è un carattere, non un jolly');
select is(pg_temp.val($q$ select (bool_or(id = 'a6b00000-0000-4000-8000-000000002216')
                                  and not bool_or(id = 'a6b00000-0000-4000-8000-000000002217'))::text
                           from public.admin_customers('a_b') $q$),
  'true', 'decisione 4: _ nella ricerca è un carattere, non un jolly');
select is(pg_temp.val($q$ select (bool_or(id = 'a6b00000-0000-4000-8000-000000002218')
                                  and not bool_or(id = 'a6b00000-0000-4000-8000-000000002219'))::text
                           from public.admin_customers('k\s') $q$),
  'true', 'decisione 4: \ nella ricerca è un carattere, non un escape');
select is(pg_temp.val($q$ select (select min(total_count) from public.admin_customers(' a '))::text || '/'
                              || (select min(total_count) from public.admin_customers(null))::text $q$),
  current_setting('f6b.total') || '/' || current_setting('f6b.total'),
  'decisione 4: q più corto di 2 caratteri (dopo il trim) o null → nessun filtro, tutti i clienti');
select is(pg_temp.val($q$ select string_agg(full_name, '|' order by n) || ' #' || min(total_count) || '-' || max(total_count)
                           from public.admin_customers('F6B Massa', 2, 2)
                                with ordinality as t(id, full_name, phone, email, nsc, ib, ca, total_count, n) $q$),
  'F6B Massa 003|F6B Massa 004 #105-105',
  'decisione 4: paginazione per nome; total_count = totale filtrato prima di limit/offset');
select is(pg_temp.val($q$ select count(*)::text from public.admin_customers('F6B Massa', 0, 0) $q$), '1',
  'decisione 4: p_limit sotto 1 → 1');
select is(pg_temp.val($q$ select count(*)::text from public.admin_customers('F6B Massa', 1000, 0) $q$), '100',
  'decisione 4: p_limit sopra 100 → 100');
select is(pg_temp.val($q$ select (full_name is null)::text
                           from public.admin_customers(null, 1, current_setting('f6b.total')::int - 1) $q$),
  'true', 'decisione 4: i clienti senza nome sono in fondo (full_name nulls last)');

-- ===========================================================================
-- 4. Dettaglio (SPEC §6.7, decisione 5)
-- ===========================================================================
select is(pg_temp.val($q$ select row(id, full_name, phone, email, no_show_count, is_blocked, no_show_reset_at, no_show_reset_by)::text
                           from public.admin_customer('a6b00000-0000-4000-8000-000000002212') $q$),
  row('a6b00000-0000-4000-8000-000000002212'::uuid, 'F6B Secondo', '+393471110002', 'qzunicomail.f6b@qa.test',
      0, false, null::timestamptz, null::uuid)::text,
  'decisione 5: scheda del cliente con email, contatore, blocco e azzeramento');
select is(pg_temp.val($q$ select count(*)::text from public.admin_customer('a6b00000-0000-4000-8000-000000002203') $q$), '0',
  'decisione 5: la scheda di un barbiere non si apre (zero righe)');
select is(pg_temp.val($q$ select count(*)::text from public.admin_customer('a6b00000-0000-4000-8000-0000000022ff') $q$), '0',
  'decisione 5: profilo inesistente → zero righe');

-- ===========================================================================
-- 5. Azzeramento e semantica del contatore (SPEC §6.7, §12, decisioni 1 e 2)
-- ===========================================================================
select pg_temp.act_as('a6b00000-0000-4000-8000-000000002221');
select throws_ok($q$ select public.create_online_booking('e6b00000-0000-4000-8000-000000002201',
  'eb6b0000-0000-4000-8000-000000002201', pg_temp.loc(pg_temp.d(), '10:00'), null) $q$,
  'P0001', 'blocked', 'SPEC §12: con 3 no-show su 3 il cliente è bloccato (precondizione)');

select pg_temp.act_as('a6b00000-0000-4000-8000-000000002201');
select is(pg_temp.outcome($q$ select public.reset_no_show_count('a6b00000-0000-4000-8000-0000000022ff') $q$),
  'P0002', 'decisione 2: azzeramento di un profilo inesistente → P0002');
select is(pg_temp.outcome($q$ select public.reset_no_show_count('a6b00000-0000-4000-8000-000000002203') $q$),
  'P0002', 'decisione 2: azzeramento di un profilo non customer (barbiere) → P0002');
select is(pg_temp.outcome($q$ select public.reset_no_show_count('a6b00000-0000-4000-8000-000000002221') $q$),
  'rows:1', 'SPEC §6.7: l''admin azzera i no-show del cliente');

select pg_temp.act_as_postgres();
select is(pg_temp.val($q$ select row(no_show_count, no_show_reset_at, no_show_reset_by)::text
                           from public.profiles where id = 'a6b00000-0000-4000-8000-000000002221' $q$),
  row(0, now(), 'a6b00000-0000-4000-8000-000000002201'::uuid)::text,
  'decisione 2: contatore a 0, azzeramento a now() e autore l''admin');

select pg_temp.act_as('a6b00000-0000-4000-8000-000000002221');
select lives_ok($q$ select public.create_online_booking('e6b00000-0000-4000-8000-000000002201',
  'eb6b0000-0000-4000-8000-000000002201', pg_temp.loc(pg_temp.d(), '10:00'), null) $q$,
  'decisione 1 / SPEC §12: dopo l''azzeramento il cliente non è più bloccato e prenota online');

select pg_temp.act_as('a6b00000-0000-4000-8000-000000002201');
-- Prenotazione che inizia esattamente all'istante dell'azzeramento (now() è fisso nella transazione)
select is(pg_temp.outcome($q$ insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, source)
  values ('bd6b0000-0000-4000-8000-000000002205', 'a6b00000-0000-4000-8000-000000002221',
          'eb6b0000-0000-4000-8000-000000002202', 'e6b00000-0000-4000-8000-000000002201', now(), 'manual') $q$),
  'rows:1', 'decisione 1: l''admin crea una prenotazione che inizia all''istante dell''azzeramento (preparazione)');
select is(pg_temp.step($q$ update public.bookings set status = 'no_show'
                            where id = 'bd6b0000-0000-4000-8000-000000002205' $q$, 'a6b00000-0000-4000-8000-000000002221'),
  'rows:1 / no_show_count=1',
  'decisione 1: una no-show con inizio >= azzeramento (bordo incluso) conta');
select is(pg_temp.step($q$ update public.bookings set status = 'completed'
                            where id = 'bd6b0000-0000-4000-8000-000000002201' $q$, 'a6b00000-0000-4000-8000-000000002221'),
  'rows:1 / no_show_count=1',
  'decisione 1: riportare a completed una no-show precedente all''azzeramento non decrementa');
select is(pg_temp.step($q$ update public.bookings set status = 'no_show'
                            where id = 'bd6b0000-0000-4000-8000-000000002204' $q$, 'a6b00000-0000-4000-8000-000000002221'),
  'rows:1 / no_show_count=1',
  'decisione 1: no-show segnata dopo l''azzeramento su una prenotazione precedente non conta');
select is(pg_temp.step($q$ delete from public.bookings
                            where id = 'bd6b0000-0000-4000-8000-000000002202' $q$, 'a6b00000-0000-4000-8000-000000002221'),
  'rows:1 / no_show_count=1',
  'decisione 1: eliminare una no-show precedente all''azzeramento non decrementa');
select is(pg_temp.step($q$ update public.bookings set status = 'completed'
                            where id = 'bd6b0000-0000-4000-8000-000000002205' $q$, 'a6b00000-0000-4000-8000-000000002221'),
  'rows:1 / no_show_count=0',
  'decisione 1: riportare a completed una no-show successiva all''azzeramento decrementa');
select is(pg_temp.step($q$ update public.bookings set status = 'completed'
                            where id = 'bd6b0000-0000-4000-8000-000000002203' $q$, 'a6b00000-0000-4000-8000-000000002221'),
  'rows:1 / no_show_count=0',
  'decisione 1: con il contatore a 0, correggere una no-show precedente non porta sotto zero né dà errore');

select is(pg_temp.val($q$ select row(no_show_count, no_show_reset_at, no_show_reset_by)::text
                           from public.admin_customer('a6b00000-0000-4000-8000-000000002221') $q$),
  row(0, now(), 'a6b00000-0000-4000-8000-000000002201'::uuid)::text,
  'decisione 5: la scheda mostra azzeramento e autore');

-- Colonne dell'azzeramento non modificabili direttamente (decisione 1)
select is(pg_temp.outcome($q$ update public.profiles set no_show_reset_at = null
                               where id = 'a6b00000-0000-4000-8000-000000002221' $q$),
  '42501', 'decisione 1: l''admin non modifica direttamente no_show_reset_at');
select is(pg_temp.outcome($q$ update public.profiles set no_show_reset_by = null
                               where id = 'a6b00000-0000-4000-8000-000000002221' $q$),
  '42501', 'decisione 1: l''admin non modifica direttamente no_show_reset_by');
select pg_temp.act_as('a6b00000-0000-4000-8000-000000002221');
select is(pg_temp.outcome($q$ update public.profiles set no_show_reset_at = now() + interval '1 day'
                               where id = 'a6b00000-0000-4000-8000-000000002221' $q$),
  '42501', 'decisione 1: il cliente non sposta il proprio azzeramento');

-- ===========================================================================
-- 5b. Contatore su spostamenti di orario e di cliente (punti 2 e 3 approvati dopo la prima consegna)
-- ===========================================================================
-- Punto 2: il trigger scatta anche sulla modifica di starts_at
select pg_temp.act_as('a6b00000-0000-4000-8000-000000002201');
select is(pg_temp.step($q$ select public.reset_no_show_count('a6b00000-0000-4000-8000-000000002241') $q$,
                       'a6b00000-0000-4000-8000-000000002241'),
  'rows:1 / no_show_count=0', 'punto 2: azzeramento del cliente cs (2 no-show passate) → 0');
select is(pg_temp.step($q$ update public.bookings set starts_at = now()
                            where id = 'bd6b0000-0000-4000-8000-000000002241' $q$, 'a6b00000-0000-4000-8000-000000002241'),
  'rows:1 / no_show_count=1',
  'punto 2: spostare una no-show da prima a dopo (bordo incluso) l''azzeramento la fa contare (+1)');
select is(pg_temp.step($q$ update public.bookings set starts_at = '2024-02-01 10:00+01'
                            where id = 'bd6b0000-0000-4000-8000-000000002241' $q$, 'a6b00000-0000-4000-8000-000000002241'),
  'rows:1 / no_show_count=0',
  'punto 2: spostarla di nuovo prima dell''azzeramento la toglie (-1, non sotto zero)');

-- Punto 3: cambio di customer_id (a = cn1 vecchio intestatario senza azzeramento, b = cn2 azzerato ora)
select is(pg_temp.step2($q$ select public.reset_no_show_count('a6b00000-0000-4000-8000-000000002243') $q$,
                        'a6b00000-0000-4000-8000-000000002242', 'a6b00000-0000-4000-8000-000000002243'),
  'rows:1 / a=2 b=0', 'punto 3: cn1 ha 2 no-show, cn2 (1 no-show passata) viene azzerato');
select is(pg_temp.step2($q$ update public.bookings set customer_id = 'a6b00000-0000-4000-8000-000000002243'
                             where id = 'bd6b0000-0000-4000-8000-000000002242' $q$,
                        'a6b00000-0000-4000-8000-000000002242', 'a6b00000-0000-4000-8000-000000002243'),
  'rows:1 / a=1 b=0',
  'punto 3: no-show precedente all''azzeramento del NUOVO cliente → per lui non conta; il vecchio (per cui contava) scende');
select is(pg_temp.step2($q$ update public.bookings set customer_id = 'a6b00000-0000-4000-8000-000000002243'
                             where id = 'bd6b0000-0000-4000-8000-000000002243' $q$,
                        'a6b00000-0000-4000-8000-000000002242', 'a6b00000-0000-4000-8000-000000002243'),
  'rows:1 / a=0 b=1',
  'punto 3: no-show con inizio >= azzeramento del nuovo cliente → conta per lui; il vecchio scende');
select is(pg_temp.step2($q$ update public.bookings set customer_id = 'a6b00000-0000-4000-8000-000000002242'
                             where id = 'bd6b0000-0000-4000-8000-000000002242' $q$,
                        'a6b00000-0000-4000-8000-000000002242', 'a6b00000-0000-4000-8000-000000002243'),
  'rows:1 / a=1 b=1',
  'punto 3: riportata al vecchio cliente conta per lui; cn2 non scende perché per lui non contava');

-- ===========================================================================
-- 6. blocked_customer_ids (decisione 8, SPEC §3.1, §5.3)
-- ===========================================================================
-- Input: cm (blocco manuale), ct (3 no-show), cb2 (2 no-show), cc (pulito), ubb (barbiere bloccato),
-- un id inesistente. Soglia 3.
select pg_temp.act_as('a6b00000-0000-4000-8000-000000002203');
select is(pg_temp.val($q$ select string_agg(x::text, ',' order by x::text) from public.blocked_customer_ids(array[
    'a6b00000-0000-4000-8000-000000002231', 'a6b00000-0000-4000-8000-000000002232', 'a6b00000-0000-4000-8000-000000002233',
    'a6b00000-0000-4000-8000-000000002234', 'a6b00000-0000-4000-8000-000000002204', 'a6b00000-0000-4000-8000-0000000022ff'
  ]::uuid[]) x $q$),
  'a6b00000-0000-4000-8000-000000002231,a6b00000-0000-4000-8000-000000002232',
  'decisione 8: il barbiere riceve i clienti bloccati a mano o per no-show (soglia inclusa), mai lo staff');
select pg_temp.act_as('a6b00000-0000-4000-8000-000000002201');
select is(pg_temp.val($q$ select string_agg(x::text, ',' order by x::text) from public.blocked_customer_ids(array[
    'a6b00000-0000-4000-8000-000000002231', 'a6b00000-0000-4000-8000-000000002232', 'a6b00000-0000-4000-8000-000000002234'
  ]::uuid[]) x $q$),
  'a6b00000-0000-4000-8000-000000002231,a6b00000-0000-4000-8000-000000002232',
  'decisione 8: anche l''admin esegue blocked_customer_ids');
select pg_temp.act_as_postgres();
update public.shop_settings set no_show_block_threshold = 0;
select pg_temp.act_as('a6b00000-0000-4000-8000-000000002203');
select is(pg_temp.val($q$ select string_agg(x::text, ',' order by x::text) from public.blocked_customer_ids(array[
    'a6b00000-0000-4000-8000-000000002231', 'a6b00000-0000-4000-8000-000000002232', 'a6b00000-0000-4000-8000-000000002233'
  ]::uuid[]) x $q$),
  'a6b00000-0000-4000-8000-000000002231',
  'SPEC §3.1: soglia 0 = blocco per no-show disattivato, resta solo il blocco manuale');

select pg_temp.act_as_postgres();
select * from finish();
rollback;
