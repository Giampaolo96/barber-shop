-- Test di accettazione – FETTA 9b "Privacy e account del cliente" (SPEC §11 riga 9b, §3.1, §5.4, §8;
-- decisioni approvate dall'utente per la fetta 9b, punti A e D).
-- 31 – Nuovo consenso quando cambia la versione dell'informativa, storico dei consensi, eliminazione
-- dell'account del cliente con anonimizzazione delle prenotazioni.
--
-- Interfaccia attesa:
--   public.privacy_consent_outdated(public.profiles) returns boolean
--     campo calcolato PostgREST: true se privacy_consent_at non è null e privacy_policy_version è
--     distinta da shop_settings.privacy_policy_version. Execute ad authenticated; non a PUBLIC né anon.
--   profiles_guard_consents (trigger esistente): il cliente può scrivere privacy_policy_version =
--     versione corrente SOLO se la sua versione è diversa dalla corrente (consenso scaduto);
--     privacy_consent_at lo rimette il database a now(). Ogni altro cambio resta vietato.
--   public.consent_kind enum ('privacy', 'marketing_on', 'marketing_off').
--   public.consent_events (id, profile_id → profiles on delete cascade, kind consent_kind,
--     policy_version text null (valorizzata per privacy), created_at timestamptz default now()).
--     Scritta solo dal trigger dei consensi; RLS: il cliente legge solo le proprie righe, nessun altro
--     (nemmeno l'admin); nessun grant di insert/update/delete ad authenticated.
--   public.anonymize_customer_bookings(p_customer uuid) – security definer, nessun grant a nessuno:
--     future confirmed → cancelled_by_customer; via le booking_staff_notes di tutte le prenotazioni del
--     cliente; notes, guest_name, guest_phone azzerati; via la riga di login_code_attempts con l'hash
--     dell'email. La prenotazione già iniziata e ancora confirmed resta confirmed (anonimizzata).
--   public.delete_own_account() – security definer, solo su auth.uid(); anon → errore; staff → 42501;
--     execute solo ad authenticated. L'utente auth lo elimina poi l'app (auth.admin.deleteUser): qui
--     si simula con delete from auth.users.
--   Il trigger before delete su profiles applica la stessa anonimizzazione a qualunque eliminazione.
--
-- Le chiamate passano da helper che intercettano gli errori: se una funzione o una tabella manca
-- fallisce la singola asserzione, non il file. Dati creati dal test, annullati dal rollback.
-- Non modificare durante l'implementazione.
begin;
create extension if not exists pgtap with schema extensions;

select plan(81);

-- ---------------------------------------------------------------------------
-- Helper
-- ---------------------------------------------------------------------------
-- Lo staff accede con password (ADR 015): il suo token ha amr password.
create function pg_temp.act_as(uid uuid) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims',
    (json_build_object('sub', uid, 'role', 'authenticated')::jsonb
       || case when exists (select 1 from public.profiles p where p.id = uid and p.role in ('barber', 'admin'))
               then jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method', 'password')))
               else '{}'::jsonb end)::text, true);
  set local role authenticated;
end $f$;

create function pg_temp.act_as_anon() returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;

-- authenticated senza utente (token senza sub): auth.uid() è null
create function pg_temp.act_as_nouser() returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  set local role authenticated;
end $f$;

create function pg_temp.act_as_postgres() returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $f$;

-- Ruolo proprietario con auth.uid() = uid: come un'eliminazione chiesta da quell'utente.
create function pg_temp.postgres_on_behalf_of(uid uuid) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $f$;

-- 'rows:N' se il comando riesce, altrimenti lo SQLSTATE
create function pg_temp.outcome(q text) returns text language plpgsql as $f$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return 'rows:' || n;
exception when others then
  return sqlstate;
end $f$;

-- Primo valore come testo, oppure 'ERR:<sqlstate>'
create function pg_temp.val(q text) returns text language plpgsql as $f$
declare r text;
begin
  execute q into r;
  return r;
exception when others then
  return 'ERR:' || sqlstate;
end $f$;

-- Esegue un comando ignorandone l'esito
create function pg_temp.attempt(q text) returns void language plpgsql as $f$
begin
  execute q;
exception when others then
  null;
end $f$;

-- Funzione per firma; null se manca
create function pg_temp.proc(sig text) returns oid language sql as $f$
  select to_regprocedure(sig)::oid
$f$;

create function pg_temp.can_exec(r text, sig text) returns boolean language plpgsql as $f$
begin
  return has_function_privilege(r, sig, 'execute');
exception when others then
  return null;
end $f$;

-- EXECUTE concesso a PUBLIC (grantee 0)? null se la funzione manca
create function pg_temp.public_exec(sig text) returns boolean language sql as $f$
  select (select coalesce(bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE'), false)
            from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           where p.oid = pg_temp.proc(sig))
   where pg_temp.proc(sig) is not null
$f$;

-- security definer con search_path fissato a ''
create function pg_temp.definer_fixed_path(sig text) returns boolean language sql as $f$
  select coalesce((select p.prosecdef
                      and exists (select 1 from unnest(p.proconfig) c where c ~ '^search_path=("")?$')
                     from pg_proc p where p.oid = pg_temp.proc(sig)), false)
$f$;

-- Porta al 2020 un timestamp di consenso a trigger utente disattivati (now() è costante nella
-- transazione: serve a distinguere "aggiornato a now()" da "non toccato").
create function pg_temp.backdate(uid uuid, col text) returns text language plpgsql as $f$
begin
  alter table public.profiles disable trigger user;
  execute format('update public.profiles set %I = %L where id = %L', col, '2020-01-01 00:00:00+00', uid);
  alter table public.profiles enable trigger user;
  return 'ok';
exception when others then
  return sqlstate;
end $f$;

-- privacy_consent_outdated del profilo, con il ruolo corrente
create function pg_temp.outdated(uid uuid) returns text language plpgsql as $f$
declare r text;
begin
  execute 'select public.privacy_consent_outdated(p)::text from public.profiles p where p.id = $1' into r using uid;
  return coalesce(r, 'no row');
exception when others then
  return 'ERR:' || sqlstate;
end $f$;

-- Storico dei consensi di un profilo (con il ruolo corrente): "kind/versione" ordinati
create function pg_temp.events(uid uuid) returns text language plpgsql as $f$
declare r text;
begin
  execute $q$ select coalesce(string_agg(e.kind::text || '/' || coalesce(e.policy_version, '-'), ' '
                                          order by e.kind, e.policy_version), '')
                from public.consent_events e where e.profile_id = $1 $q$ into r using uid;
  return r;
exception when others then
  return 'ERR:' || sqlstate;
end $f$;

-- create_online_booking con il ruolo corrente: 'ok' oppure "<sqlstate> <messaggio>". Il profilo si
-- controlla prima dello slot, quindi l'orario non conta.
create function pg_temp.book_error() returns text language plpgsql as $f$
begin
  perform public.create_online_booking('f3150000-0000-4000-8000-000000000001',
    'f31b0000-0000-4000-8000-000000000001', now() + interval '2 days', null);
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $f$;

-- ---------------------------------------------------------------------------
-- Dati
-- ---------------------------------------------------------------------------
-- A: cliente che si elimina; B: altro cliente; C: consensi; D: profilo senza consenso;
-- F: eliminato direttamente (trigger); G: bloccato per no-show che si elimina.
insert into auth.users (id, email) values
  ('f3100000-0000-4000-8000-000000000001', 'qa31-a@qa.test'),
  ('f3100000-0000-4000-8000-000000000002', 'qa31-b@qa.test'),
  ('f3100000-0000-4000-8000-000000000003', 'qa31-barber@qa.test'),
  ('f3100000-0000-4000-8000-000000000004', 'qa31-admin@qa.test'),
  ('f3100000-0000-4000-8000-000000000005', 'qa31-c@qa.test'),
  ('f3100000-0000-4000-8000-000000000006', 'qa31-d@qa.test'),
  ('f3100000-0000-4000-8000-000000000007', 'qa31-f@qa.test'),
  ('f3100000-0000-4000-8000-000000000008', 'qa31-g@qa.test');
update public.profiles set role = 'barber', full_name = 'QA31 Barbiere'
 where id = 'f3100000-0000-4000-8000-000000000003';
update public.profiles set role = 'admin', full_name = 'QA31 Admin'
 where id = 'f3100000-0000-4000-8000-000000000004';

update public.shop_settings set privacy_policy_version = 'qa31-v1';

-- Profili completi impostati dal proprietario (consenso alla versione corrente)
update public.profiles
   set full_name = 'QA31 ' || right(id::text, 1), phone = '+3933300031' || right(id::text, 2),
       privacy_policy_version = 'qa31-v1', privacy_consent_at = '2024-01-01 00:00:00+00'
 where id in ('f3100000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-000000000002',
              'f3100000-0000-4000-8000-000000000007', 'f3100000-0000-4000-8000-000000000008');
update public.profiles set is_blocked = true where id = 'f3100000-0000-4000-8000-000000000008';

insert into public.services (id, name, duration_min, price_cents, is_active) values
  ('f3150000-0000-4000-8000-000000000001', 'QA31 Taglio', 30, 2000, true);
insert into public.barbers (id, display_name, is_active, profile_id) values
  ('f31b0000-0000-4000-8000-000000000001', 'QA31 Barber', true, 'f3100000-0000-4000-8000-000000000003');
insert into public.barber_services (barber_id, service_id) values
  ('f31b0000-0000-4000-8000-000000000001', 'f3150000-0000-4000-8000-000000000001');

-- Prenotazioni. 01 passata completed (con dati ospite, nota), 02 passata confirmed, 03 futura,
-- 04 già iniziata e confirmed: del cliente A. 11 futura e 12 passata: del cliente B.
-- 21 futura del cliente F, 31 futura del cliente G.
insert into public.bookings (id, customer_id, guest_name, guest_phone, barber_id, service_id, starts_at, status, source, notes) values
  ('f31d0000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-000000000001', 'QA31 Accompagnatore', '+393330003199',
   'f31b0000-0000-4000-8000-000000000001', 'f3150000-0000-4000-8000-000000000001', '2025-01-15 10:00+01', 'completed', 'manual', 'nota A passata'),
  ('f31d0000-0000-4000-8000-000000000002', 'f3100000-0000-4000-8000-000000000001', null, null,
   'f31b0000-0000-4000-8000-000000000001', 'f3150000-0000-4000-8000-000000000001', '2025-01-15 11:00+01', 'confirmed', 'online', 'nota A da aggiornare'),
  ('f31d0000-0000-4000-8000-000000000003', 'f3100000-0000-4000-8000-000000000001', null, null,
   'f31b0000-0000-4000-8000-000000000001', 'f3150000-0000-4000-8000-000000000001',
   date_trunc('hour', now()) + interval '3 days', 'confirmed', 'online', 'nota A futura'),
  ('f31d0000-0000-4000-8000-000000000004', 'f3100000-0000-4000-8000-000000000001', null, null,
   'f31b0000-0000-4000-8000-000000000001', 'f3150000-0000-4000-8000-000000000001',
   date_trunc('minute', now()) - interval '10 minutes', 'confirmed', 'online', 'nota A in corso'),
  ('f31d0000-0000-4000-8000-000000000011', 'f3100000-0000-4000-8000-000000000002', null, null,
   'f31b0000-0000-4000-8000-000000000001', 'f3150000-0000-4000-8000-000000000001',
   date_trunc('hour', now()) + interval '3 days 2 hours', 'confirmed', 'online', 'nota B futura'),
  ('f31d0000-0000-4000-8000-000000000012', 'f3100000-0000-4000-8000-000000000002', null, null,
   'f31b0000-0000-4000-8000-000000000001', 'f3150000-0000-4000-8000-000000000001', '2025-01-15 12:00+01', 'completed', 'online', 'nota B passata'),
  ('f31d0000-0000-4000-8000-000000000021', 'f3100000-0000-4000-8000-000000000007', null, null,
   'f31b0000-0000-4000-8000-000000000001', 'f3150000-0000-4000-8000-000000000001',
   date_trunc('hour', now()) + interval '4 days', 'confirmed', 'online', 'nota F futura'),
  ('f31d0000-0000-4000-8000-000000000031', 'f3100000-0000-4000-8000-000000000008', null, null,
   'f31b0000-0000-4000-8000-000000000001', 'f3150000-0000-4000-8000-000000000001',
   date_trunc('hour', now()) + interval '5 days', 'confirmed', 'online', 'nota G futura');

insert into public.booking_staff_notes (booking_id, note) values
  ('f31d0000-0000-4000-8000-000000000001', 'staff A passata'),
  ('f31d0000-0000-4000-8000-000000000003', 'staff A futura'),
  ('f31d0000-0000-4000-8000-000000000011', 'staff B futura'),
  ('f31d0000-0000-4000-8000-000000000021', 'staff F futura');

insert into public.login_code_attempts (email_hash, code_failures) values
  (public.login_code_hash('qa31-a@qa.test'), 1),
  (public.login_code_hash('qa31-b@qa.test'), 1);

-- ---------------------------------------------------------------------------
-- 1. Struttura e grant delle funzioni nuove (CLAUDE.md – Sicurezza)
-- ---------------------------------------------------------------------------
select ok(pg_temp.proc('public.delete_own_account()') is not null,
  'SPEC §8: esiste public.delete_own_account()');
select ok(pg_temp.definer_fixed_path('public.delete_own_account()'),
  'delete_own_account: security definer con search_path vuoto');
select is(
  array[pg_temp.can_exec('authenticated', 'public.delete_own_account()'),
        pg_temp.can_exec('anon', 'public.delete_own_account()'),
        pg_temp.public_exec('public.delete_own_account()')],
  array[true, false, false],
  'delete_own_account: execute ad authenticated, non ad anon né a PUBLIC');

select ok(pg_temp.proc('public.anonymize_customer_bookings(uuid)') is not null,
  'SPEC §8: esiste public.anonymize_customer_bookings(uuid)');
select ok(pg_temp.definer_fixed_path('public.anonymize_customer_bookings(uuid)'),
  'anonymize_customer_bookings: security definer con search_path vuoto');
select is(
  array[pg_temp.can_exec('authenticated', 'public.anonymize_customer_bookings(uuid)'),
        pg_temp.can_exec('anon', 'public.anonymize_customer_bookings(uuid)'),
        pg_temp.can_exec('service_role', 'public.anonymize_customer_bookings(uuid)'),
        pg_temp.public_exec('public.anonymize_customer_bookings(uuid)')],
  array[false, false, false, false],
  'anonymize_customer_bookings: funzione interna, nessun grant (authenticated, anon, service_role, PUBLIC)');

select ok(pg_temp.proc('public.privacy_consent_outdated(public.profiles)') is not null,
  'SPEC §8: esiste il campo calcolato public.privacy_consent_outdated(public.profiles)');
select is(
  (select pg_get_function_result(p.oid) from pg_proc p
    where p.oid = pg_temp.proc('public.privacy_consent_outdated(public.profiles)')),
  'boolean', 'privacy_consent_outdated restituisce boolean');
select is(
  array[pg_temp.can_exec('authenticated', 'public.privacy_consent_outdated(public.profiles)'),
        pg_temp.can_exec('anon', 'public.privacy_consent_outdated(public.profiles)'),
        pg_temp.public_exec('public.privacy_consent_outdated(public.profiles)')],
  array[true, false, false],
  'privacy_consent_outdated: execute ad authenticated, non ad anon né a PUBLIC');

-- ---------------------------------------------------------------------------
-- 2. Storico dei consensi: tabella, enum, RLS e grant
-- ---------------------------------------------------------------------------
select is(
  pg_temp.val($q$ select array_agg(e.enumlabel order by e.enumsortorder)::text
                    from pg_enum e where e.enumtypid = 'public.consent_kind'::regtype $q$),
  '{privacy,marketing_on,marketing_off}', 'SPEC §8: enum consent_kind (privacy, marketing_on, marketing_off)');
select has_table('public', 'consent_events', 'SPEC §8: esiste public.consent_events');
select is(
  pg_temp.val($q$ select string_agg(column_name || ':' || data_type || ':' || is_nullable, ' ' order by column_name)
                    from information_schema.columns
                   where table_schema = 'public' and table_name = 'consent_events' $q$),
  'created_at:timestamp with time zone:NO id:uuid:NO kind:USER-DEFINED:NO policy_version:text:YES profile_id:uuid:NO',
  'consent_events: colonne id, profile_id, kind, policy_version (nullable), created_at');
select is(
  pg_temp.val($q$ select column_default from information_schema.columns
                   where table_schema = 'public' and table_name = 'consent_events' and column_name = 'created_at' $q$),
  'now()', 'consent_events.created_at default now()');
select is(
  pg_temp.val($q$ select c.confdeltype::text from pg_constraint c
                   where c.conrelid = 'public.consent_events'::regclass and c.contype = 'f'
                     and c.confrelid = 'public.profiles'::regclass $q$),
  'c', 'consent_events.profile_id → profiles on delete cascade (lo storico va via con l''account)');
select is(
  pg_temp.val($q$ select relrowsecurity::text from pg_class where oid = 'public.consent_events'::regclass $q$),
  'true', 'CLAUDE.md: RLS attiva su consent_events');
select is(
  pg_temp.val($q$ select array[has_table_privilege('authenticated', 'public.consent_events', 'select'),
                               has_table_privilege('authenticated', 'public.consent_events', 'insert'),
                               has_table_privilege('authenticated', 'public.consent_events', 'update'),
                               has_table_privilege('authenticated', 'public.consent_events', 'delete'),
                               has_table_privilege('authenticated', 'public.consent_events', 'truncate')]::text $q$),
  '{t,f,f,f,f}', 'consent_events: authenticated solo select (lo scrive solo il trigger dei consensi)');
select is(
  pg_temp.val($q$ select has_table_privilege('anon', 'public.consent_events', 'select, insert, update, delete')::text $q$),
  'false', 'consent_events: nessun privilegio ad anon');
select is(
  pg_temp.val($q$ select count(*)::text from public.consent_events e
                    join auth.users u on u.id = e.profile_id
                    join public.profiles p on p.id = e.profile_id
                   where u.email = 'cliente@demo.local' and e.kind = 'privacy'
                     and e.policy_version = p.privacy_policy_version $q$),
  '1', 'backfill/seed – SPEC §8: il consenso privacy del cliente demo è nello storico, con la sua versione');

-- ---------------------------------------------------------------------------
-- 3. privacy_consent_outdated e nuovo consenso (decisione A)
-- ---------------------------------------------------------------------------
-- C completa il profilo con il consenso alla versione corrente e il marketing
select pg_temp.act_as('f3100000-0000-4000-8000-000000000005');
select is(
  pg_temp.outcome($q$ update public.profiles
                         set full_name = 'QA31 C', phone = '+393330003105',
                             privacy_policy_version = 'qa31-v1', marketing_consent = true
                       where id = 'f3100000-0000-4000-8000-000000000005' $q$),
  'rows:1', 'SPEC §5.5: C completa il profilo con privacy (versione corrente) e marketing');
select is(pg_temp.outdated('f3100000-0000-4000-8000-000000000005'), 'false',
  'SPEC §8: consenso alla versione corrente → privacy_consent_outdated false');
select is(pg_temp.events('f3100000-0000-4000-8000-000000000005'), 'privacy/qa31-v1 marketing_on/-',
  'SPEC §8: il primo consenso privacy e l''attivazione del marketing finiscono nello storico');

-- Il titolare pubblica una nuova versione
select pg_temp.act_as_postgres();
update public.shop_settings set privacy_policy_version = 'qa31-v2';
select is(pg_temp.backdate('f3100000-0000-4000-8000-000000000005', 'privacy_consent_at'), 'ok',
  'preparazione: privacy_consent_at di C portato al 2020');
select is(pg_temp.backdate('f3100000-0000-4000-8000-000000000005', 'marketing_consent_at'), 'ok',
  'preparazione: marketing_consent_at di C portato al 2020');

-- D non ha mai dato il consenso: non è "scaduto" (è un profilo incompleto)
select pg_temp.act_as('f3100000-0000-4000-8000-000000000006');
select is(pg_temp.outdated('f3100000-0000-4000-8000-000000000006'), 'false',
  'privacy_consent_outdated è false senza consenso (privacy_consent_at null), anche dopo un cambio di versione');

select pg_temp.act_as('f3100000-0000-4000-8000-000000000005');
select is(pg_temp.outdated('f3100000-0000-4000-8000-000000000005'), 'true',
  'SPEC §3.1: nuova versione dell''informativa → il consenso di C è scaduto (privacy_consent_outdated true)');
select is(pg_temp.book_error(), 'P0001 profile_incomplete',
  'SPEC §11 9b: con il consenso a una versione vecchia create_online_booking rifiuta (profile_incomplete)');

-- Nuovo consenso solo verso la versione corrente
select matches(
  pg_temp.outcome($q$ update public.profiles set privacy_policy_version = 'qa31-v3'
                       where id = 'f3100000-0000-4000-8000-000000000005' $q$),
  '^[0-9A-Z]{5}$', 'SPEC §8: consenso scaduto, ma una versione diversa da quella corrente è rifiutata');
select pg_temp.attempt($q$ update public.profiles set privacy_policy_version = null
                            where id = 'f3100000-0000-4000-8000-000000000005' $q$);
select pg_temp.attempt($q$ update public.profiles set privacy_consent_at = null
                            where id = 'f3100000-0000-4000-8000-000000000005' $q$);
select is(
  pg_temp.val($q$ select row(privacy_policy_version, privacy_consent_at = '2020-01-01 00:00:00+00')::text
                    from public.profiles where id = 'f3100000-0000-4000-8000-000000000005' $q$),
  '(qa31-v1,t)', 'SPEC §8: il consenso scaduto non si azzera (né versione né data)');

-- Un altro utente non dà il nuovo consenso per C, nemmeno l'admin
select pg_temp.act_as('f3100000-0000-4000-8000-000000000004');
select matches(
  pg_temp.outcome($q$ update public.profiles set privacy_policy_version = 'qa31-v2'
                       where id = 'f3100000-0000-4000-8000-000000000005' $q$),
  '^(rows:0|42501)$', 'SPEC §8: l''admin non rinnova il consenso di un cliente');
select pg_temp.act_as('f3100000-0000-4000-8000-000000000002');
select pg_temp.attempt($q$ update public.profiles set privacy_policy_version = 'qa31-v2'
                            where id = 'f3100000-0000-4000-8000-000000000005' $q$);
select pg_temp.act_as_postgres();
select is(
  pg_temp.val($q$ select privacy_policy_version from public.profiles where id = 'f3100000-0000-4000-8000-000000000005' $q$),
  'qa31-v1', 'SPEC §8: dopo i tentativi di altri utenti il consenso di C è ancora quello vecchio');

-- C dà il nuovo consenso: la data la mette il database, il marketing non cambia
select pg_temp.act_as('f3100000-0000-4000-8000-000000000005');
select is(
  pg_temp.outcome($q$ update public.profiles set privacy_policy_version = 'qa31-v2', privacy_consent_at = '2001-01-01 00:00:00+00'
                       where id = 'f3100000-0000-4000-8000-000000000005' $q$),
  'rows:1', 'SPEC §8: con il consenso scaduto il cliente accetta la versione corrente');
select is(
  pg_temp.val($q$ select row(privacy_policy_version, privacy_consent_at = now())::text
                    from public.profiles where id = 'f3100000-0000-4000-8000-000000000005' $q$),
  '(qa31-v2,t)', 'SPEC §8: nuova versione salvata, privacy_consent_at = now() del database (non quello del client)');
select is(
  pg_temp.val($q$ select row(marketing_consent, marketing_consent_at = '2020-01-01 00:00:00+00')::text
                    from public.profiles where id = 'f3100000-0000-4000-8000-000000000005' $q$),
  '(t,t)', 'decisione A: il nuovo consenso privacy non tocca il consenso marketing né la sua data');
select is(pg_temp.outdated('f3100000-0000-4000-8000-000000000005'), 'false',
  'dopo il nuovo consenso privacy_consent_outdated torna false');
select is(pg_temp.events('f3100000-0000-4000-8000-000000000005'), 'privacy/qa31-v1 privacy/qa31-v2 marketing_on/-',
  'SPEC §8: il nuovo consenso aggiunge una riga privacy con la nuova versione, le vecchie restano');

-- Consenso di nuovo valido: non si torna indietro
select matches(
  pg_temp.outcome($q$ update public.profiles set privacy_policy_version = 'qa31-v1'
                       where id = 'f3100000-0000-4000-8000-000000000005' $q$),
  '^[0-9A-Z]{5}$', 'SPEC §8: con il consenso valido non si torna a una versione vecchia');

-- ---------------------------------------------------------------------------
-- 4. Storico: marketing, visibilità, nessuna scrittura diretta
-- ---------------------------------------------------------------------------
select is(
  pg_temp.outcome($q$ update public.profiles set marketing_consent = false
                       where id = 'f3100000-0000-4000-8000-000000000005' $q$),
  'rows:1', 'SPEC §8: C revoca il marketing');
select is(
  pg_temp.outcome($q$ update public.profiles set marketing_consent = true
                       where id = 'f3100000-0000-4000-8000-000000000005' $q$),
  'rows:1', 'SPEC §8: C riattiva il marketing');
select is(
  pg_temp.outcome($q$ update public.profiles set full_name = 'QA31 C Rinominata', phone = '+393330003115'
                       where id = 'f3100000-0000-4000-8000-000000000005' $q$),
  'rows:1', 'SPEC §5.4: C cambia nome e telefono');
select is(pg_temp.events('f3100000-0000-4000-8000-000000000005'),
  'privacy/qa31-v1 privacy/qa31-v2 marketing_on/- marketing_on/- marketing_off/-',
  'SPEC §8: una riga a ogni cambio di marketing; nome e telefono non entrano nello storico');
select is(
  pg_temp.val($q$ select bool_and(policy_version is null)::text from public.consent_events
                   where profile_id = 'f3100000-0000-4000-8000-000000000005' and kind <> 'privacy' $q$),
  'true', 'consent_events: policy_version è valorizzata solo per le righe privacy');

select is(
  pg_temp.outcome($q$ insert into public.consent_events (profile_id, kind, policy_version)
                      values ('f3100000-0000-4000-8000-000000000005', 'privacy', 'qa31-v9') $q$),
  '42501', 'SPEC §8: il cliente non scrive direttamente nello storico (insert)');
select is(
  pg_temp.outcome($q$ update public.consent_events set policy_version = 'qa31-v9'
                       where profile_id = 'f3100000-0000-4000-8000-000000000005' $q$),
  '42501', 'SPEC §8: il cliente non modifica lo storico (update)');
select is(
  pg_temp.outcome($q$ delete from public.consent_events where profile_id = 'f3100000-0000-4000-8000-000000000005' $q$),
  '42501', 'SPEC §8: il cliente non cancella lo storico (delete)');

-- Solo l'interessato legge le proprie righe
select pg_temp.act_as('f3100000-0000-4000-8000-000000000002');
select is(pg_temp.events('f3100000-0000-4000-8000-000000000005'), '',
  'decisione A: un altro cliente non vede lo storico di C');
select is(
  pg_temp.val($q$ select count(*)::text from public.consent_events
                   where profile_id <> 'f3100000-0000-4000-8000-000000000002' $q$),
  '0', 'decisione A: il cliente vede solo le proprie righe');
select pg_temp.act_as('f3100000-0000-4000-8000-000000000004');
select is(pg_temp.events('f3100000-0000-4000-8000-000000000005'), '',
  'decisione A: nemmeno l''admin legge lo storico dei consensi di un cliente');
select pg_temp.act_as('f3100000-0000-4000-8000-000000000003');
select is(pg_temp.events('f3100000-0000-4000-8000-000000000005'), '',
  'decisione A: il barbiere non legge lo storico dei consensi');
select pg_temp.act_as_anon();
select is(pg_temp.val($q$ select count(*)::text from public.consent_events $q$), 'ERR:42501',
  'anon: nessun accesso allo storico dei consensi');

-- ---------------------------------------------------------------------------
-- 5. delete_own_account: chi non può
-- ---------------------------------------------------------------------------
-- Statistiche del giorno passato prima dell'eliminazione (come le vede l'admin)
select pg_temp.act_as('f3100000-0000-4000-8000-000000000004');
select set_config('qa31.stats_before',
  pg_temp.val($q$ select public.admin_booking_stats('2025-01-15', '2025-01-15')::text $q$), true);
select ok(current_setting('qa31.stats_before') not like 'ERR:%' and current_setting('qa31.stats_before') <> '[]',
  'preparazione: statistiche del 15/01/2025 lette dall''admin');

select pg_temp.act_as_anon();
select is(pg_temp.outcome($q$ select public.delete_own_account() $q$), '42501',
  'SPEC §8: anon non può chiamare delete_own_account');
select pg_temp.act_as_nouser();
select matches(pg_temp.outcome($q$ select public.delete_own_account() $q$), '^[0-9A-Z]{5}$',
  'delete_own_account senza utente (auth.uid() null) è un errore');
select pg_temp.act_as('f3100000-0000-4000-8000-000000000003');
select is(pg_temp.outcome($q$ select public.delete_own_account() $q$), '42501',
  'decisione D: il barbiere non usa delete_own_account (lo staff passa alla fetta 9c)');
select pg_temp.act_as('f3100000-0000-4000-8000-000000000004');
select is(pg_temp.outcome($q$ select public.delete_own_account() $q$), '42501',
  'decisione D: l''admin non usa delete_own_account');

select pg_temp.act_as_postgres();
select is(
  (select count(*) from public.profiles where id in ('f3100000-0000-4000-8000-000000000003',
                                                    'f3100000-0000-4000-8000-000000000004')),
  2::bigint, 'dopo i rifiuti barbiere e admin esistono ancora');
select is(
  (select string_agg(coalesce(notes, '-'), ', ' order by id) from public.bookings
    where customer_id = 'f3100000-0000-4000-8000-000000000001'),
  'nota A passata, nota A da aggiornare, nota A futura, nota A in corso',
  'dopo i rifiuti nessuna prenotazione di A è stata toccata');

-- ---------------------------------------------------------------------------
-- 6. delete_own_account: il cliente A si elimina
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f3100000-0000-4000-8000-000000000001');
select is(pg_temp.outcome($q$ select public.delete_own_account() $q$), 'rows:1',
  'SPEC §8: il cliente chiama delete_own_account');

select pg_temp.act_as_postgres();
select is(
  (select status::text from public.bookings where id = 'f31d0000-0000-4000-8000-000000000003'),
  'cancelled_by_customer', 'SPEC §8: la prenotazione futura confirmed è cancellata (cancelled_by_customer)');
select is(
  (select status::text from public.bookings where id = 'f31d0000-0000-4000-8000-000000000001'),
  'completed', 'SPEC §8: la passata completed resta completed (statistiche)');
select is(
  (select status::text from public.bookings where id = 'f31d0000-0000-4000-8000-000000000002'),
  'confirmed', 'la passata ancora confirmed resta confirmed (la chiude lo staff)');
select is(
  (select status::text from public.bookings where id = 'f31d0000-0000-4000-8000-000000000004'),
  'confirmed', 'decisione D: la prenotazione già iniziata resta confirmed');
select is(
  (select count(*) from public.bookings
    where id in ('f31d0000-0000-4000-8000-000000000001', 'f31d0000-0000-4000-8000-000000000002',
                 'f31d0000-0000-4000-8000-000000000003', 'f31d0000-0000-4000-8000-000000000004')
      and (notes is not null or guest_name is not null or guest_phone is not null)),
  0::bigint, 'SPEC §8: tutte le prenotazioni di A senza note né dati ospite (anche passate e in corso)');
select is(
  (select count(*) from public.booking_staff_notes
    where booking_id in ('f31d0000-0000-4000-8000-000000000001', 'f31d0000-0000-4000-8000-000000000003')),
  0::bigint, 'decisione D: eliminate le note dello staff su tutte le prenotazioni di A');
select is(
  (select count(*) from public.login_code_attempts where email_hash = public.login_code_hash('qa31-a@qa.test')),
  0::bigint, 'decisione D: eliminata la riga dei tentativi di login con l''hash dell''email di A');

-- Gli altri non sono toccati
select is(
  (select row(status, notes, customer_id)::text from public.bookings where id = 'f31d0000-0000-4000-8000-000000000011'),
  row('confirmed'::public.booking_status, 'nota B futura'::text, 'f3100000-0000-4000-8000-000000000002'::uuid)::text,
  'SPEC §8: la prenotazione futura di B resta confermata, con nota e cliente');
select is(
  (select notes from public.bookings where id = 'f31d0000-0000-4000-8000-000000000012'),
  'nota B passata', 'SPEC §8: la passata di B resta con la nota');
select is(
  (select note from public.booking_staff_notes where booking_id = 'f31d0000-0000-4000-8000-000000000011'),
  'staff B futura', 'SPEC §8: la nota dello staff sulla prenotazione di B resta');
select is(
  (select count(*) from public.login_code_attempts where email_hash = public.login_code_hash('qa31-b@qa.test')),
  1::bigint, 'la riga dei tentativi di login di B resta');
select is(
  (select notes from public.bookings where id = 'f31d0000-0000-4000-8000-000000000021'),
  'nota F futura', 'le prenotazioni di F non sono toccate dall''eliminazione di A');

-- L'orario della futura cancellata torna libero (SPEC §3.7.1)
select lives_ok(
  $q$ insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, source)
      values ('QA31 Ospite', '+393330003198', 'f31b0000-0000-4000-8000-000000000001',
              'f3150000-0000-4000-8000-000000000001', date_trunc('hour', now()) + interval '3 days', 'manual') $q$,
  'SPEC §3.7.1: l''orario della prenotazione cancellata si può prenotare di nuovo');

-- L'app elimina l'utente auth (auth.admin.deleteUser): simulato qui
select lives_ok(
  $q$ delete from auth.users where id = 'f3100000-0000-4000-8000-000000000001' $q$,
  'eliminazione dell''utente auth di A');
select is(
  (select count(*) from public.profiles where id = 'f3100000-0000-4000-8000-000000000001'),
  0::bigint, 'SPEC §8: il profilo di A non esiste più');
select is(
  (select count(*) from public.bookings
    where id in ('f31d0000-0000-4000-8000-000000000001', 'f31d0000-0000-4000-8000-000000000002',
                 'f31d0000-0000-4000-8000-000000000003', 'f31d0000-0000-4000-8000-000000000004')),
  4::bigint, 'SPEC §8: le prenotazioni di A restano (per le statistiche)');
select is(
  (select count(*) from public.bookings
    where id in ('f31d0000-0000-4000-8000-000000000001', 'f31d0000-0000-4000-8000-000000000002',
                 'f31d0000-0000-4000-8000-000000000003', 'f31d0000-0000-4000-8000-000000000004')
      and customer_id is null and guest_name is null and guest_phone is null and notes is null
      and status_changed_by is null),
  4::bigint, 'SPEC §8: prenotazioni anonime (nessun cliente, ospite, nota né autore del cambio di stato)');
-- C (5 righe di storico, sezioni 3–4) elimina l'account: lo storico va via con il profilo
select pg_temp.act_as('f3100000-0000-4000-8000-000000000005');
select pg_temp.attempt($q$ select public.delete_own_account() $q$);
select pg_temp.act_as_postgres();
select pg_temp.attempt($q$ delete from auth.users where id = 'f3100000-0000-4000-8000-000000000005' $q$);
select is(
  pg_temp.val($q$ select count(*)::text from public.consent_events
                   where profile_id in ('f3100000-0000-4000-8000-000000000001', 'f3100000-0000-4000-8000-000000000005') $q$),
  '0', 'decisione A: lo storico dei consensi è eliminato con l''account');

select pg_temp.act_as('f3100000-0000-4000-8000-000000000004');
select is(
  pg_temp.val($q$ select public.admin_booking_stats('2025-01-15', '2025-01-15')::text $q$),
  current_setting('qa31.stats_before'),
  'SPEC §8: le statistiche dell''admin per le prenotazioni passate non cambiano');

-- ---------------------------------------------------------------------------
-- 7. Eliminazione diretta (trigger before delete su profiles) e cliente bloccato
-- ---------------------------------------------------------------------------
select pg_temp.postgres_on_behalf_of('f3100000-0000-4000-8000-000000000007');
select lives_ok(
  $q$ delete from auth.users where id = 'f3100000-0000-4000-8000-000000000007' $q$,
  'eliminazione di F senza delete_own_account');
select pg_temp.act_as_postgres();
select is(
  (select row(status, customer_id, notes)::text from public.bookings where id = 'f31d0000-0000-4000-8000-000000000021'),
  row('cancelled_by_customer'::public.booking_status, null::uuid, null::text)::text,
  'decisione D: qualunque eliminazione cancella la futura e la anonimizza (nota azzerata)');
select is(
  (select count(*) from public.booking_staff_notes where booking_id = 'f31d0000-0000-4000-8000-000000000021'),
  0::bigint, 'decisione D: anche con l''eliminazione diretta le note dello staff vanno via');

-- G è bloccato per no-show: si elimina comunque (decisione MVP, SPEC §13.10)
select pg_temp.act_as('f3100000-0000-4000-8000-000000000008');
select is(pg_temp.outcome($q$ select public.delete_own_account() $q$), 'rows:1',
  'decisione D: il cliente bloccato può eliminare il proprio account');
select pg_temp.act_as_postgres();
select is(
  (select row(status, notes)::text from public.bookings where id = 'f31d0000-0000-4000-8000-000000000031'),
  row('cancelled_by_customer'::public.booking_status, null::text)::text,
  'decisione D: la futura del cliente bloccato è cancellata e anonimizzata');

select * from finish();
rollback;
