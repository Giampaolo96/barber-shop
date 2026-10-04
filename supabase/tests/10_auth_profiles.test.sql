-- Test di accettazione – FETTA 2 (SPEC §11: "Auth e ruoli").
-- 10 – Profili e autenticazione: nome dai metadati di registrazione (il ruolo resta customer),
-- consensi privacy e marketing con timestamp valorizzati dal database, grant di colonna,
-- scrittura solo sul proprio profilo (nemmeno l'admin tocca i consensi altrui), versione corrente
-- dell'informativa in shop_settings. SPEC §2, §3.1, §5.4, §5.5, §8, §3.7.4.
-- Crea i propri dati; va eseguito dopo `npx supabase db reset`.
-- Non modificare durante l'implementazione.
begin;
create extension if not exists pgtap with schema extensions;

select plan(114);

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

-- Esegue un comando ignorandone l'esito: conta solo lo stato che lascia nel database.
create function pg_temp.attempt(q text) returns void language plpgsql as $f$
begin
  execute q;
exception when others then
  null;
end $f$;

-- Primo valore (come testo) restituito da una query, oppure 'ERR:<sqlstate>'. Le colonne nuove
-- sono citate solo dentro stringhe: se mancano fallisce la singola asserzione, non il file.
create function pg_temp.val(q text) returns text language plpgsql as $f$
declare r text;
begin
  execute q into r;
  return r;
exception when others then
  return 'ERR:' || sqlstate;
end $f$;

-- Porta nel passato un timestamp di consenso, a trigger utente disattivati: serve a distinguere
-- "il timestamp è stato aggiornato a now()" da "non è stato toccato" dentro una sola transazione
-- (now() è costante). Va chiamata con il ruolo proprietario. Restituisce 'ok' o lo SQLSTATE.
create function pg_temp.backdate(uid uuid, col text) returns text language plpgsql as $f$
begin
  alter table public.profiles disable trigger user;
  execute format('update public.profiles set %I = %L where id = %L',
    col, '2020-01-01 00:00:00+00', uid);
  alter table public.profiles enable trigger user;
  return 'ok';
exception when others then
  return sqlstate;
end $f$;

-- ---------------------------------------------------------------------------
-- 1. SPEC §8: colonne dei consensi su profiles
-- ---------------------------------------------------------------------------
select col_type_is('public', 'profiles', 'privacy_consent_at', 'timestamp with time zone',
  'SPEC §8: profiles.privacy_consent_at è timestamptz');
select col_type_is('public', 'profiles', 'privacy_policy_version', 'text',
  'SPEC §8: profiles.privacy_policy_version è text');
select col_type_is('public', 'profiles', 'marketing_consent', 'boolean',
  'SPEC §8: profiles.marketing_consent è boolean');
select col_type_is('public', 'profiles', 'marketing_consent_at', 'timestamp with time zone',
  'SPEC §8: profiles.marketing_consent_at è timestamptz');
select col_not_null('public', 'profiles', 'marketing_consent',
  'SPEC §8: profiles.marketing_consent NOT NULL');
select col_default_is('public', 'profiles', 'marketing_consent', 'false',
  'SPEC §8: profiles.marketing_consent default false (consenso facoltativo, mai preselezionato)');
select col_is_null('public', 'profiles', 'privacy_consent_at',
  'SPEC §8: profiles.privacy_consent_at è nullable (NULL = consenso non ancora dato)');
select col_is_null('public', 'profiles', 'privacy_policy_version',
  'SPEC §8: profiles.privacy_policy_version è nullable');
select col_is_null('public', 'profiles', 'marketing_consent_at',
  'SPEC §8: profiles.marketing_consent_at è nullable');
select col_hasnt_default('public', 'profiles', 'privacy_consent_at',
  'SPEC §8: privacy_consent_at senza default (un profilo nuovo non ha consenso)');
select col_hasnt_default('public', 'profiles', 'marketing_consent_at',
  'SPEC §8: marketing_consent_at senza default');
select is(
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'phone'),
  'YES', 'SPEC §5.5: profiles.phone resta nullable nel DB (decisione fetta 2)');

-- ---------------------------------------------------------------------------
-- 2. SPEC §8: grant di colonna espliciti
-- ---------------------------------------------------------------------------
select is(
  pg_temp.val($q$ select has_column_privilege('authenticated', 'public.profiles', 'privacy_policy_version', 'update')
                     and has_column_privilege('authenticated', 'public.profiles', 'marketing_consent', 'update') $q$),
  'true', 'SPEC §8: authenticated ha update su privacy_policy_version e marketing_consent');
select is(
  pg_temp.val($q$ select has_column_privilege('authenticated', 'public.profiles', 'privacy_consent_at', 'select')
                     and has_column_privilege('authenticated', 'public.profiles', 'privacy_policy_version', 'select')
                     and has_column_privilege('authenticated', 'public.profiles', 'marketing_consent', 'select')
                     and has_column_privilege('authenticated', 'public.profiles', 'marketing_consent_at', 'select') $q$),
  'true', 'SPEC §5.4: authenticated può leggere le colonne dei consensi (del proprio profilo, via RLS)');
select is(
  pg_temp.val($q$ select has_column_privilege('anon', 'public.profiles', 'privacy_consent_at', 'select, update')
                      or has_column_privilege('anon', 'public.profiles', 'privacy_policy_version', 'select, update')
                      or has_column_privilege('anon', 'public.profiles', 'marketing_consent', 'select, update')
                      or has_column_privilege('anon', 'public.profiles', 'marketing_consent_at', 'select, update') $q$),
  'false', 'SPEC §8: anon non ha alcun privilegio sulle colonne dei consensi');
select is(has_table_privilege('authenticated', 'public.profiles', 'update'), false,
  'SPEC §8: authenticated non ha update a livello di tabella su profiles (solo grant di colonna)');
select is(has_table_privilege('authenticated', 'public.profiles', 'insert, delete, truncate'), false,
  'SPEC §8: authenticated non ha insert/delete/truncate su profiles');
select is(has_column_privilege('authenticated', 'public.profiles', 'no_show_count', 'update'), false,
  'SPEC §2: no_show_count resta senza grant di update');

-- ---------------------------------------------------------------------------
-- 2b. SPEC §3.1 / §8: versione corrente dell'informativa in shop_settings; seed demo
-- ---------------------------------------------------------------------------
select col_type_is('public', 'shop_settings', 'privacy_policy_version', 'text',
  'SPEC §8: shop_settings.privacy_policy_version è text');
select col_not_null('public', 'shop_settings', 'privacy_policy_version',
  'SPEC §8: shop_settings.privacy_policy_version NOT NULL');
select is(
  pg_temp.val($q$ select (btrim(privacy_policy_version) <> '')::text from public.shop_settings $q$),
  'true', 'seed – SPEC §8: la versione corrente dell''informativa è valorizzata');
select is(
  pg_temp.val($q$ select has_column_privilege('anon', 'public.shop_settings', 'privacy_policy_version', 'select')
                     and has_column_privilege('authenticated', 'public.shop_settings', 'privacy_policy_version', 'select') $q$),
  'true', 'SPEC §3.1: la versione dell''informativa si legge come le altre impostazioni pubbliche');
select is(
  pg_temp.val($q$ select row(coalesce(btrim(p.full_name), '') <> '', coalesce(btrim(p.phone), '') <> '',
                             p.privacy_consent_at is not null,
                             p.privacy_policy_version = (select s.privacy_policy_version from public.shop_settings s))::text
                    from public.profiles p
                    join auth.users u on u.id = p.id
                   where u.email = 'cliente@demo.local' $q$),
  '(t,t,t,t)',
  'seed – SPEC §8: cliente@demo.local ha il profilo completo (nome, telefono, consenso alla versione corrente)');

-- ---------------------------------------------------------------------------
-- 3. SPEC §2 / §5.4: handle_new_user copia il nome dai metadati, il ruolo resta customer
-- ---------------------------------------------------------------------------
select lives_ok(
  $q$ insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('f0000000-0000-4000-8000-000000001001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              'auth-fullname@qa.test', '{}'::jsonb, '{"full_name":"  Anna Neri  "}'::jsonb, now(), now()) $q$,
  'SPEC §5.4: registrazione con full_name nei metadati');
select is(
  (select full_name from public.profiles where id = 'f0000000-0000-4000-8000-000000001001'),
  'Anna Neri', 'SPEC §5.4: full_name copiato dai metadati senza spazi ai bordi');

select lives_ok(
  $q$ insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('f0000000-0000-4000-8000-000000001002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              'auth-name@qa.test', '{}'::jsonb, '{"name":"Bruno Gallo"}'::jsonb, now(), now()) $q$,
  'SPEC §5.4: registrazione con name nei metadati');
select is(
  (select full_name from public.profiles where id = 'f0000000-0000-4000-8000-000000001002'),
  'Bruno Gallo', 'SPEC §5.4: in assenza di full_name si copia name');

select lives_ok(
  $q$ insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('f0000000-0000-4000-8000-000000001003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              'auth-both@qa.test', '{}'::jsonb, '{"full_name":"Carla Completa","name":"Carla"}'::jsonb, now(), now()) $q$,
  'SPEC §5.4: registrazione con full_name e name nei metadati');
select is(
  (select full_name from public.profiles where id = 'f0000000-0000-4000-8000-000000001003'),
  'Carla Completa', 'SPEC §5.4: con entrambi vince full_name');

select lives_ok(
  $q$ insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('f0000000-0000-4000-8000-000000001004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              'auth-blank@qa.test', '{}'::jsonb, '{"full_name":"    "}'::jsonb, now(), now()) $q$,
  'SPEC §5.4: registrazione con full_name di soli spazi');
select is(
  (select full_name from public.profiles where id = 'f0000000-0000-4000-8000-000000001004'),
  null, 'SPEC §5.4: un nome di soli spazi non viene copiato (full_name NULL)');

-- Nome lunghissimo: la registrazione non deve fallire e il nome non supera la lunghezza massima
select lives_ok(
  format(
    $q$ insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        values ('f0000000-0000-4000-8000-000000001005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                'auth-long@qa.test', '{}'::jsonb, %L::jsonb, now(), now()) $q$,
    json_build_object('full_name', repeat('x', 5000))::text),
  'SPEC §5.4: registrazione con un nome di 5000 caratteri riesce');
select is((select count(*) from public.profiles where id = 'f0000000-0000-4000-8000-000000001005'),
  1::bigint, 'SPEC §2: il profilo è creato anche con un nome troppo lungo');
select ok(
  (select coalesce(char_length(full_name), 0) <= 100 from public.profiles
    where id = 'f0000000-0000-4000-8000-000000001005'),
  'SPEC §5.4: il nome copiato dai metadati non supera i 100 caratteri');

-- Metadati non testuali: la registrazione non deve fallire
select lives_ok(
  $q$ insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('f0000000-0000-4000-8000-000000001007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              'auth-odd@qa.test', '{}'::jsonb, '{"full_name":{"a":[1,2]},"name":null}'::jsonb, now(), now()) $q$,
  'SPEC §2: registrazione con metadati non testuali riesce');
select is((select role::text from public.profiles where id = 'f0000000-0000-4000-8000-000000001007'),
  'customer', 'SPEC §2: profilo customer creato anche con metadati non testuali');

-- Il nome è l'unico metadato copiato: ruolo, blocco, contatore, telefono e consensi sono ignorati
select lives_ok(
  $q$ insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('f0000000-0000-4000-8000-000000001006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              'auth-forged@qa.test', '{"role":"admin","provider":"email"}'::jsonb,
              '{"full_name":"Finto Admin","role":"admin","is_blocked":true,"no_show_count":5,"phone":"+39000000",
                "privacy_consent_at":"2001-01-01T00:00:00Z","privacy_policy_version":"forged",
                "marketing_consent":true,"marketing_consent_at":"2001-01-01T00:00:00Z"}'::jsonb, now(), now()) $q$,
  'SPEC §2: registrazione con role admin e altri campi riservati nei metadati riesce...');
select is(
  (select row(full_name, role, is_blocked, no_show_count, phone)::text from public.profiles
    where id = 'f0000000-0000-4000-8000-000000001006'),
  row('Finto Admin'::text, 'customer'::public.user_role, false, 0, null::text)::text,
  'SPEC §2: ...il nome è copiato, ma ruolo customer, non bloccato, 0 no-show, telefono NULL');
select is(
  pg_temp.val($q$ select row(privacy_consent_at, privacy_policy_version, marketing_consent, marketing_consent_at)::text
                    from public.profiles where id = 'f0000000-0000-4000-8000-000000001006' $q$),
  '(,,f,)', 'SPEC §8: i consensi nei metadati di registrazione sono ignorati');

-- Il ruolo effettivo resta customer anche con claim falsificati nel JWT
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object(
    'sub', 'f0000000-0000-4000-8000-000000001006',
    'role', 'authenticated',
    'app_metadata', json_build_object('role', 'admin'),
    'user_metadata', json_build_object('role', 'admin', 'full_name', 'Finto Admin'))::text, true);
select is(public.current_user_role()::text, 'customer',
  'SPEC §2: con role admin nei metadati del JWT current_user_role() resta customer');
select is(public.is_staff(), false,
  'SPEC §2: con role admin nei metadati del JWT is_staff() resta false');
select throws_ok(
  $q$ update public.profiles set role = 'admin' where id = 'f0000000-0000-4000-8000-000000001006' $q$,
  '42501', null, 'SPEC §2: chi ha role admin solo nei metadati non può promuoversi (42501)');
select pg_temp.act_as_postgres();

-- ---------------------------------------------------------------------------
-- 4. CLAUDE.md – Sicurezza: revoke esplicito sulle funzioni, anche su quelle nuove
-- ---------------------------------------------------------------------------
select is_empty(
  $q$ select p.oid::regprocedure::text
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and (has_function_privilege('anon', p.oid, 'execute')
              or exists (
                select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
         and p.oid::regprocedure::text not in (
           'current_user_role()', 'is_admin()', 'is_staff()', 'current_barber_id()',
           'public.current_user_role()', 'public.is_admin()', 'public.is_staff()',
           'public.current_barber_id()',
           -- fetta 4: input del motore di disponibilità, leggibile senza login (solo orari)
           'availability_inputs(uuid,uuid,timestamp with time zone,timestamp with time zone)',
           'public.availability_inputs(uuid,uuid,timestamp with time zone,timestamp with time zone)')
         and p.proname not in ('timerange', 'timemultirange') $q$,
  'nessuna funzione di public eseguibile da PUBLIC o anon, salvo gli helper delle policy');
select is(
  has_function_privilege('anon', 'public.handle_new_user()', 'execute')
    or has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'),
  false, 'handle_new_user() non è eseguibile da anon né da authenticated');
-- Le funzioni dei trigger di profiles (comprese quelle nuove dei consensi) non si chiamano a mano
select is_empty(
  $q$ select p.oid::regprocedure::text
        from pg_trigger t
        join pg_proc p on p.oid = t.tgfoid
       where t.tgrelid = 'public.profiles'::regclass
         and not t.tgisinternal
         and (has_function_privilege('anon', p.oid, 'execute')
              or has_function_privilege('authenticated', p.oid, 'execute')) $q$,
  'le funzioni dei trigger di profiles non sono eseguibili da anon né da authenticated');

-- ---------------------------------------------------------------------------
-- Dati per i consensi
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-000000001011', 'auth-forger@qa.test'),
  ('f0000000-0000-4000-8000-000000001012', 'auth-privacy@qa.test'),
  ('f0000000-0000-4000-8000-000000001013', 'auth-marketing@qa.test'),
  ('f0000000-0000-4000-8000-000000001014', 'auth-other@qa.test'),
  ('f0000000-0000-4000-8000-000000001015', 'auth-barber@qa.test'),
  ('f0000000-0000-4000-8000-000000001016', 'auth-admin@qa.test');
update public.profiles set role = 'barber', full_name = 'Auth Barbiere'
 where id = 'f0000000-0000-4000-8000-000000001015';
update public.profiles set role = 'admin', full_name = 'Auth Admin'
 where id = 'f0000000-0000-4000-8000-000000001016';

-- Il barbiere ha una prenotazione con i clienti 1012 e 1013: ne vede il profilo (fetta 1).
insert into public.services (id, name, duration_min, price_cents, is_active) values
  ('f5000000-0000-4000-8000-000000001001', 'Auth Taglio', 30, 2000, true);
insert into public.barbers (id, display_name, is_active, profile_id) values
  ('fb000000-0000-4000-8000-000000001001', 'Auth Barber', true, 'f0000000-0000-4000-8000-000000001015');
insert into public.barber_services (barber_id, service_id) values
  ('fb000000-0000-4000-8000-000000001001', 'f5000000-0000-4000-8000-000000001001');
insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, source) values
  ('fd000000-0000-4000-8000-000000001001', 'f0000000-0000-4000-8000-000000001012',
   'fb000000-0000-4000-8000-000000001001', 'f5000000-0000-4000-8000-000000001001', '2024-01-08 10:00:00+01', 'manual'),
  ('fd000000-0000-4000-8000-000000001002', 'f0000000-0000-4000-8000-000000001013',
   'fb000000-0000-4000-8000-000000001001', 'f5000000-0000-4000-8000-000000001001', '2024-01-08 11:00:00+01', 'manual');

select is(
  pg_temp.val($q$ select row(privacy_consent_at, privacy_policy_version, marketing_consent, marketing_consent_at)::text
                    from public.profiles where id = 'f0000000-0000-4000-8000-000000001011' $q$),
  '(,,f,)', 'SPEC §8: un profilo nuovo non ha consensi (privacy NULL, marketing false)');

-- ---------------------------------------------------------------------------
-- 4b. SPEC §3.1 / §8: la versione corrente dell'informativa la scrive solo l'admin
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select is(
  pg_temp.val($q$ select (btrim(privacy_policy_version) <> '')::text from public.shop_settings $q$),
  'true', 'SPEC §3.1: anon legge la versione corrente dell''informativa');
select is(
  pg_temp.outcome($q$ update public.shop_settings set privacy_policy_version = 'anon-v' $q$),
  '42501', 'SPEC §3.1: anon non modifica la versione dell''informativa (42501)');
reset role;

select pg_temp.act_as('f0000000-0000-4000-8000-000000001014');
select is(
  pg_temp.val($q$ select (btrim(privacy_policy_version) <> '')::text from public.shop_settings $q$),
  'true', 'SPEC §3.1: il cliente legge la versione corrente dell''informativa');
select matches(
  pg_temp.outcome($q$ update public.shop_settings set privacy_policy_version = 'cliente-v' $q$),
  '^(rows:0|42501)$', 'SPEC §3.1: il cliente non modifica la versione dell''informativa');

select pg_temp.act_as('f0000000-0000-4000-8000-000000001015');
select matches(
  pg_temp.outcome($q$ update public.shop_settings set privacy_policy_version = 'barbiere-v' $q$),
  '^(rows:0|42501)$', 'SPEC §3.1: il barbiere non modifica la versione dell''informativa');

select pg_temp.act_as('f0000000-0000-4000-8000-000000001016');
select is(
  pg_temp.outcome($q$ update public.shop_settings set privacy_policy_version = null $q$),
  '23502', 'SPEC §8: la versione dell''informativa non può essere NULL (23502)');
select is(
  pg_temp.outcome($q$ update public.shop_settings set privacy_policy_version = 'qa-v1' $q$),
  'rows:1', 'SPEC §3.1: l''admin aggiorna la versione corrente dell''informativa');
select pg_temp.act_as_postgres();
select is(
  pg_temp.val($q$ select privacy_policy_version from public.shop_settings $q$),
  'qa-v1', 'SPEC §3.1: dopo i tentativi la versione corrente è quella impostata dall''admin');

-- ---------------------------------------------------------------------------
-- 5. SPEC §8: i timestamp dei consensi li valorizza il database, mai il client
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f0000000-0000-4000-8000-000000001011');

select matches(
  pg_temp.outcome($q$ update public.profiles set privacy_consent_at = '2001-01-01 00:00:00+00'
                       where id = 'f0000000-0000-4000-8000-000000001011' $q$),
  '^(rows:1|42501)$', 'SPEC §8: privacy_consent_at inviato dal client è rifiutato (42501) o ignorato');
select is(
  pg_temp.val($q$ select (privacy_consent_at is null or privacy_consent_at = now())::text
                    from public.profiles where id = 'f0000000-0000-4000-8000-000000001011' $q$),
  'true', 'SPEC §8: il valore di privacy_consent_at scelto dal client non viene mai salvato');

select matches(
  pg_temp.outcome($q$ update public.profiles
                         set privacy_policy_version = 'qa-v1', privacy_consent_at = '2001-01-01 00:00:00+00'
                       where id = 'f0000000-0000-4000-8000-000000001011' $q$),
  '^(rows:1|42501)$',
  'SPEC §8: versione + privacy_consent_at inviati insieme: rifiutato (42501) o timestamp sovrascritto');
select is(
  pg_temp.val($q$ select (privacy_consent_at is null or privacy_consent_at = now())::text
                    from public.profiles where id = 'f0000000-0000-4000-8000-000000001011' $q$),
  'true', 'SPEC §8: anche insieme alla versione, il timestamp del client non viene salvato');

select matches(
  pg_temp.outcome($q$ update public.profiles set marketing_consent_at = '2001-01-01 00:00:00+00'
                       where id = 'f0000000-0000-4000-8000-000000001011' $q$),
  '^(rows:1|42501)$', 'SPEC §8: marketing_consent_at inviato dal client è rifiutato (42501) o ignorato');
select is(
  pg_temp.val($q$ select (marketing_consent_at is null or marketing_consent_at = now())::text
                    from public.profiles where id = 'f0000000-0000-4000-8000-000000001011' $q$),
  'true', 'SPEC §8: il valore di marketing_consent_at scelto dal client non viene mai salvato');

select matches(
  pg_temp.outcome($q$ update public.profiles
                         set marketing_consent = true, marketing_consent_at = '2001-01-01 00:00:00+00'
                       where id = 'f0000000-0000-4000-8000-000000001011' $q$),
  '^(rows:1|42501)$',
  'SPEC §8: consenso marketing + timestamp inviati insieme: rifiutato (42501) o timestamp sovrascritto');
select is(
  pg_temp.val($q$ select (marketing_consent_at is null or marketing_consent_at = now())::text
                    from public.profiles where id = 'f0000000-0000-4000-8000-000000001011' $q$),
  'true', 'SPEC §8: anche insieme al consenso, il timestamp del client non viene salvato');

-- ---------------------------------------------------------------------------
-- 6. SPEC §8 / §5.5: consenso privacy dato al completamento del profilo, non revocabile
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f0000000-0000-4000-8000-000000001012');

-- Decisione fetta 2: il consenso vale solo per la versione corrente dell'informativa
select matches(
  pg_temp.outcome($q$ update public.profiles set privacy_policy_version = 'versione-inesistente'
                       where id = 'f0000000-0000-4000-8000-000000001012' $q$),
  '^[0-9A-Z]{5}$', 'SPEC §8: una versione diversa da quella corrente è rifiutata');
select is(
  pg_temp.val($q$ select row(privacy_consent_at, privacy_policy_version)::text from public.profiles
                   where id = 'f0000000-0000-4000-8000-000000001012' $q$),
  '(,)', 'SPEC §8: con una versione non corrente nessun consenso viene registrato');
select matches(
  pg_temp.outcome($q$ update public.profiles set privacy_policy_version = ''
                       where id = 'f0000000-0000-4000-8000-000000001012' $q$),
  '^[0-9A-Z]{5}$', 'SPEC §8: una versione vuota è rifiutata');
select matches(
  pg_temp.outcome($q$ update public.profiles
                         set full_name = 'Paola Privacy', phone = '+393330001012',
                             privacy_policy_version = 'QA-V1 '
                       where id = 'f0000000-0000-4000-8000-000000001012' $q$),
  '^[0-9A-Z]{5}$', 'SPEC §8: una versione simile ma non identica a quella corrente è rifiutata');
select is(
  pg_temp.val($q$ select row(full_name, privacy_consent_at, privacy_policy_version)::text from public.profiles
                   where id = 'f0000000-0000-4000-8000-000000001012' $q$),
  '(,,)', 'SPEC §8: dopo i tentativi rifiutati il profilo non ha consenso né dati parziali');

-- Il completamento del profilo è un solo update sulla propria riga
select is(
  pg_temp.outcome($q$ update public.profiles
                         set full_name = 'Paola Privacy', phone = '+393330001012',
                             privacy_policy_version = 'qa-v1', marketing_consent = false
                       where id = 'f0000000-0000-4000-8000-000000001012' $q$),
  'rows:1', 'SPEC §5.5: il cliente completa il proprio profilo (nome, telefono, consenso privacy)');
select is(
  pg_temp.val($q$ select (privacy_consent_at = now())::text from public.profiles
                   where id = 'f0000000-0000-4000-8000-000000001012' $q$),
  'true', 'SPEC §8: dando il consenso privacy_consent_at è valorizzato dal database con now()');
select is(
  pg_temp.val($q$ select row(full_name, phone, privacy_policy_version)::text from public.profiles
                   where id = 'f0000000-0000-4000-8000-000000001012' $q$),
  row('Paola Privacy'::text, '+393330001012'::text, 'qa-v1'::text)::text,
  'SPEC §8: nome, telefono e versione dell''informativa accettata sono salvati');
select is(
  pg_temp.val($q$ select marketing_consent::text from public.profiles
                   where id = 'f0000000-0000-4000-8000-000000001012' $q$),
  'false', 'SPEC §8: il consenso privacy non implica quello marketing (separato e facoltativo)');

select pg_temp.act_as_postgres();
select is(pg_temp.backdate('f0000000-0000-4000-8000-000000001012', 'privacy_consent_at'), 'ok',
  'preparazione: privacy_consent_at portato al 2020-01-01');
select pg_temp.act_as('f0000000-0000-4000-8000-000000001012');

select pg_temp.attempt($q$ update public.profiles set privacy_policy_version = null
                            where id = 'f0000000-0000-4000-8000-000000001012' $q$);
select is(
  pg_temp.val($q$ select row(privacy_policy_version, privacy_consent_at = '2020-01-01 00:00:00+00')::text
                    from public.profiles where id = 'f0000000-0000-4000-8000-000000001012' $q$),
  '(qa-v1,t)', 'SPEC §8: il cliente non può azzerare la versione accettata (consenso non revocabile)');

select pg_temp.attempt($q$ update public.profiles set privacy_consent_at = null
                            where id = 'f0000000-0000-4000-8000-000000001012' $q$);
select is(
  pg_temp.val($q$ select row(privacy_policy_version, privacy_consent_at = '2020-01-01 00:00:00+00')::text
                    from public.profiles where id = 'f0000000-0000-4000-8000-000000001012' $q$),
  '(qa-v1,t)', 'SPEC §8: il cliente non può riportare privacy_consent_at a NULL');

select pg_temp.attempt($q$ update public.profiles set privacy_consent_at = '2001-01-01 00:00:00+00'
                            where id = 'f0000000-0000-4000-8000-000000001012' $q$);
select is(
  pg_temp.val($q$ select row(privacy_policy_version, privacy_consent_at = '2020-01-01 00:00:00+00')::text
                    from public.profiles where id = 'f0000000-0000-4000-8000-000000001012' $q$),
  '(qa-v1,t)', 'SPEC §8: il cliente non può cambiare la data del consenso già dato');

select pg_temp.attempt($q$ update public.profiles set privacy_policy_version = 'altra-versione'
                            where id = 'f0000000-0000-4000-8000-000000001012' $q$);
select is(
  pg_temp.val($q$ select row(privacy_policy_version, privacy_consent_at = '2020-01-01 00:00:00+00')::text
                    from public.profiles where id = 'f0000000-0000-4000-8000-000000001012' $q$),
  '(qa-v1,t)', 'SPEC §8: il cliente non può cambiare il consenso privacy una volta dato');

-- Un update che non riguarda i consensi non ne ritocca la data
select is(
  pg_temp.outcome($q$ update public.profiles set full_name = 'Paola Rinominata'
                       where id = 'f0000000-0000-4000-8000-000000001012' $q$),
  'rows:1', 'SPEC §5.4: dopo il consenso il cliente continua a modificare il proprio nome');
select is(
  pg_temp.val($q$ select row(full_name, privacy_policy_version, privacy_consent_at = '2020-01-01 00:00:00+00')::text
                    from public.profiles where id = 'f0000000-0000-4000-8000-000000001012' $q$),
  row('Paola Rinominata'::text, 'qa-v1'::text, true)::text,
  'SPEC §8: modificare il nome non tocca la data del consenso privacy');

-- ---------------------------------------------------------------------------
-- 7. SPEC §8: consenso marketing revocabile, ogni cambio aggiorna marketing_consent_at
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f0000000-0000-4000-8000-000000001013');

select is(
  pg_temp.outcome($q$ update public.profiles set marketing_consent = true
                       where id = 'f0000000-0000-4000-8000-000000001013' $q$),
  'rows:1', 'SPEC §8: il cliente dà il consenso marketing');
select is(
  pg_temp.val($q$ select row(marketing_consent, marketing_consent_at = now())::text from public.profiles
                   where id = 'f0000000-0000-4000-8000-000000001013' $q$),
  '(t,t)', 'SPEC §8: consenso dato → marketing_consent_at valorizzato dal database con now()');
select is(
  pg_temp.val($q$ select row(privacy_consent_at, privacy_policy_version)::text from public.profiles
                   where id = 'f0000000-0000-4000-8000-000000001013' $q$),
  '(,)', 'SPEC §8: il consenso marketing non implica quello privacy (separati)');

select pg_temp.act_as_postgres();
select is(pg_temp.backdate('f0000000-0000-4000-8000-000000001013', 'marketing_consent_at'), 'ok',
  'preparazione: marketing_consent_at portato al 2020-01-01');
select pg_temp.act_as('f0000000-0000-4000-8000-000000001013');

select is(
  pg_temp.outcome($q$ update public.profiles set full_name = 'Marta Marketing', phone = '+393330001013'
                       where id = 'f0000000-0000-4000-8000-000000001013' $q$),
  'rows:1', 'SPEC §5.4: il cliente modifica nome e telefono');
select is(
  pg_temp.val($q$ select row(marketing_consent, marketing_consent_at = '2020-01-01 00:00:00+00')::text
                    from public.profiles where id = 'f0000000-0000-4000-8000-000000001013' $q$),
  '(t,t)', 'SPEC §8: senza cambio di consenso marketing_consent_at non viene toccato');

select is(
  pg_temp.outcome($q$ update public.profiles set marketing_consent = false
                       where id = 'f0000000-0000-4000-8000-000000001013' $q$),
  'rows:1', 'SPEC §8: il cliente revoca il consenso marketing dal profilo');
select is(
  pg_temp.val($q$ select row(marketing_consent, marketing_consent_at = now())::text from public.profiles
                   where id = 'f0000000-0000-4000-8000-000000001013' $q$),
  '(f,t)', 'SPEC §8: la revoca aggiorna marketing_consent_at a now()');

select pg_temp.act_as_postgres();
select is(pg_temp.backdate('f0000000-0000-4000-8000-000000001013', 'marketing_consent_at'), 'ok',
  'preparazione: marketing_consent_at riportato al 2020-01-01');
select pg_temp.act_as('f0000000-0000-4000-8000-000000001013');

select is(
  pg_temp.outcome($q$ update public.profiles set marketing_consent = true
                       where id = 'f0000000-0000-4000-8000-000000001013' $q$),
  'rows:1', 'SPEC §8: il cliente ridà il consenso marketing');
select is(
  pg_temp.val($q$ select row(marketing_consent, marketing_consent_at = now())::text from public.profiles
                   where id = 'f0000000-0000-4000-8000-000000001013' $q$),
  '(t,t)', 'SPEC §8: ogni cambio del consenso marketing aggiorna marketing_consent_at');

-- Il cliente legge i propri consensi (SPEC §5.4: profilo con consensi)
select is(
  pg_temp.val($q$ select count(*)::text from public.profiles
                   where id = 'f0000000-0000-4000-8000-000000001013' and marketing_consent $q$),
  '1', 'SPEC §5.4: il cliente legge i propri consensi');

-- ---------------------------------------------------------------------------
-- 8. SPEC §3.7.4 / §8: si scrive solo sul proprio profilo
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f0000000-0000-4000-8000-000000001014');
select is(
  pg_temp.val($q$ select count(*)::text from public.profiles
                   where id <> 'f0000000-0000-4000-8000-000000001014' $q$),
  '0', 'SPEC §3.7.4: un cliente non vede i profili (e i consensi) degli altri');
select matches(
  pg_temp.outcome($q$ update public.profiles set marketing_consent = false
                       where id = 'f0000000-0000-4000-8000-000000001013' $q$),
  '^(rows:0|42501)$', 'SPEC §3.7.4: un cliente non modifica il consenso marketing di un altro');
select matches(
  pg_temp.outcome($q$ update public.profiles set privacy_policy_version = 'qa-v1'
                       where id = 'f0000000-0000-4000-8000-000000001013' $q$),
  '^(rows:0|42501)$', 'SPEC §3.7.4: un cliente non dà il consenso privacy al posto di un altro');
select matches(
  pg_temp.outcome($q$ update public.profiles set marketing_consent = true $q$),
  '^(rows:1|42501)$', 'SPEC §3.7.4: un update senza filtro tocca al massimo il proprio profilo');

-- Il barbiere vede il profilo dei propri clienti ma non ne modifica i consensi
select pg_temp.act_as('f0000000-0000-4000-8000-000000001015');
select is(
  (select count(*) from public.profiles
    where id in ('f0000000-0000-4000-8000-000000001012', 'f0000000-0000-4000-8000-000000001013')),
  2::bigint, 'precondizione: il barbiere vede i profili dei propri clienti');
select matches(
  pg_temp.outcome($q$ update public.profiles set marketing_consent = false
                       where id = 'f0000000-0000-4000-8000-000000001013' $q$),
  '^(rows:0|42501)$', 'SPEC §8: il barbiere non revoca il consenso marketing di un cliente');
select matches(
  pg_temp.outcome($q$ update public.profiles set privacy_policy_version = 'qa-v1'
                       where id = 'f0000000-0000-4000-8000-000000001013' $q$),
  '^(rows:0|42501)$', 'SPEC §8: il barbiere non dà il consenso privacy al posto di un cliente');
select matches(
  pg_temp.outcome($q$ update public.profiles set privacy_policy_version = null
                       where id = 'f0000000-0000-4000-8000-000000001012' $q$),
  '^(rows:0|42501)$', 'SPEC §8: il barbiere non revoca il consenso privacy di un cliente');
select matches(
  pg_temp.outcome($q$ update public.profiles set full_name = 'Rinominato dal barbiere'
                       where id = 'f0000000-0000-4000-8000-000000001013' $q$),
  '^(rows:0|42501)$', 'SPEC §2: il barbiere non modifica il profilo di un cliente');

-- Il barbiere gestisce i consensi del proprio profilo come chiunque
select is(
  pg_temp.outcome($q$ update public.profiles set marketing_consent = true
                       where id = 'f0000000-0000-4000-8000-000000001015' $q$),
  'rows:1', 'SPEC §8: il barbiere modifica il proprio consenso marketing');
select is(public.current_user_role()::text, 'barber',
  'SPEC §2: scrivere i propri consensi non cambia il ruolo');

-- L'admin non dà né revoca i consensi di un cliente (decisione fetta 2); conta lo stato finale
select pg_temp.act_as('f0000000-0000-4000-8000-000000001016');
select is(
  (select count(*) from public.profiles
    where id in ('f0000000-0000-4000-8000-000000001012', 'f0000000-0000-4000-8000-000000001013')),
  2::bigint, 'precondizione: l''admin vede i profili dei clienti');
-- cliente 1013: marketing dato, privacy non data
select pg_temp.attempt($q$ update public.profiles set marketing_consent = false
                            where id = 'f0000000-0000-4000-8000-000000001013' $q$);
select pg_temp.attempt($q$ update public.profiles set marketing_consent_at = '2001-01-01 00:00:00+00'
                            where id = 'f0000000-0000-4000-8000-000000001013' $q$);
select pg_temp.attempt($q$ update public.profiles set marketing_consent_at = null
                            where id = 'f0000000-0000-4000-8000-000000001013' $q$);
select pg_temp.attempt($q$ update public.profiles set privacy_policy_version = 'qa-v1'
                            where id = 'f0000000-0000-4000-8000-000000001013' $q$);
select pg_temp.attempt($q$ update public.profiles set privacy_consent_at = now()
                            where id = 'f0000000-0000-4000-8000-000000001013' $q$);
select pg_temp.attempt($q$ update public.profiles
                              set privacy_policy_version = 'qa-v1', privacy_consent_at = now()
                            where id = 'f0000000-0000-4000-8000-000000001013' $q$);
select is(
  pg_temp.val($q$ select row(marketing_consent, marketing_consent_at = now(),
                             privacy_consent_at, privacy_policy_version)::text
                    from public.profiles where id = 'f0000000-0000-4000-8000-000000001013' $q$),
  '(t,t,,)', 'SPEC §8: l''admin non revoca il marketing né dà il consenso privacy di un cliente');
-- cliente 1012: privacy data, marketing non dato
select pg_temp.attempt($q$ update public.profiles set privacy_policy_version = null
                            where id = 'f0000000-0000-4000-8000-000000001012' $q$);
select pg_temp.attempt($q$ update public.profiles set privacy_consent_at = null
                            where id = 'f0000000-0000-4000-8000-000000001012' $q$);
select pg_temp.attempt($q$ update public.profiles set privacy_consent_at = now()
                            where id = 'f0000000-0000-4000-8000-000000001012' $q$);
select pg_temp.attempt($q$ update public.profiles set marketing_consent = true
                            where id = 'f0000000-0000-4000-8000-000000001012' $q$);
select pg_temp.attempt($q$ update public.profiles
                              set marketing_consent = true, marketing_consent_at = now()
                            where id = 'f0000000-0000-4000-8000-000000001012' $q$);
select is(
  pg_temp.val($q$ select row(privacy_policy_version, privacy_consent_at = '2020-01-01 00:00:00+00',
                             marketing_consent, marketing_consent_at)::text
                    from public.profiles where id = 'f0000000-0000-4000-8000-000000001012' $q$),
  '(qa-v1,t,f,)', 'SPEC §8: l''admin non revoca il consenso privacy né dà il marketing di un cliente');

-- L'admin continua a fare ciò che già poteva: blocco e ruolo
select is(
  pg_temp.outcome($q$ update public.profiles set is_blocked = true
                       where id = 'f0000000-0000-4000-8000-000000001013' $q$),
  'rows:1', 'SPEC §6.7: l''admin blocca un cliente');
select is(
  pg_temp.outcome($q$ update public.profiles set is_blocked = false
                       where id = 'f0000000-0000-4000-8000-000000001013' $q$),
  'rows:1', 'SPEC §6.7: l''admin sblocca un cliente');
select is(
  pg_temp.outcome($q$ update public.profiles set role = 'barber'
                       where id = 'f0000000-0000-4000-8000-000000001014' $q$),
  'rows:1', 'SPEC §2: l''admin cambia il ruolo di un utente');
select is(
  pg_temp.val($q$ select row(role, privacy_consent_at, privacy_policy_version)::text
                    from public.profiles where id = 'f0000000-0000-4000-8000-000000001014' $q$),
  '(barber,,)', 'SPEC §8: cambiare ruolo non registra alcun consenso privacy dell''utente');
-- ...e gestisce i consensi del proprio profilo come chiunque
select is(
  pg_temp.outcome($q$ update public.profiles set marketing_consent = true
                       where id = 'f0000000-0000-4000-8000-000000001016' $q$),
  'rows:1', 'SPEC §8: l''admin modifica il proprio consenso marketing');

select pg_temp.act_as_postgres();
select is(
  pg_temp.val($q$ select row(full_name, marketing_consent, privacy_policy_version)::text from public.profiles
                   where id = 'f0000000-0000-4000-8000-000000001013' $q$),
  row('Marta Marketing'::text, true, null::text)::text,
  'SPEC §8: dopo i tentativi di cliente e barbiere il profilo del cliente è invariato');
select is(
  pg_temp.val($q$ select row(privacy_policy_version, privacy_consent_at = '2020-01-01 00:00:00+00')::text
                    from public.profiles where id = 'f0000000-0000-4000-8000-000000001012' $q$),
  '(qa-v1,t)', 'SPEC §8: dopo i tentativi il consenso privacy del cliente è invariato');

-- Anonimo: nessun accesso ai consensi
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select is(
  pg_temp.outcome($q$ select privacy_consent_at, marketing_consent from public.profiles $q$),
  '42501', 'SPEC §8: anon non legge i consensi (42501)');
select is(
  pg_temp.outcome($q$ update public.profiles set marketing_consent = true $q$),
  '42501', 'SPEC §8: anon non scrive i consensi (42501)');
select is(
  pg_temp.outcome($q$ update public.profiles set privacy_policy_version = 'anon' $q$),
  '42501', 'SPEC §8: anon non dà consensi privacy (42501)');
reset role;

select * from finish();
rollback;
