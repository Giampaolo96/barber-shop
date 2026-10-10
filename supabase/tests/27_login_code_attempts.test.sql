-- Test di accettazione – FETTA 8 (SPEC §11: "PWA (manifest, icone, installazione)").
-- 27 – Limite dei tentativi del login con codice a 6 cifre (SPEC §5.5 login via email, §8 sicurezza,
-- decisioni approvate per la fetta 8, "Login con codice a 6 cifre").
-- Interfaccia attesa (migrazione `login_code_attempts`):
--   tabella public.login_code_attempts: hash dell'email normalizzata (mai l'email in chiaro),
--     conteggi degli errori, inizio della finestra oraria; RLS attiva, nessuna policy, nessun grant
--     ad anon/authenticated.
--   public.login_code_check(p_email text)
--     returns table (blocked boolean, remaining integer)  -- una riga
--     remaining = tentativi ancora ammessi = min(5 - errori sul codice attuale, 10 - errori nell'ora),
--     mai negativo; blocked = (remaining = 0).
--   public.login_code_register_failure(p_email text)
--     returns table (blocked boolean, remaining integer)  -- stato DOPO aver contato l'errore
--   public.login_code_reset(p_email text) returns void
--     azzera solo il contatore del codice (nuovo codice richiesto), non il tetto orario.
--   public.login_code_clear(p_email text) returns void
--     login riuscito: azzera entrambi i contatori (codice e finestra oraria).
--   Finestra oraria fissa: dura un'ora dal primo errore; scaduta, riparte dal primo errore successivo.
--   Colonne proposte (questo test usa solo window_started_at, per retrodatare la finestra):
--     email_hash text primary key, code_failures integer, hour_failures integer,
--     window_started_at timestamptz (inizio della finestra oraria).
--   Tutte security definer con search_path fissato; revoke all da public, anon, authenticated;
--   execute solo a service_role. L'email si normalizza dentro le funzioni (trim + minuscole).
-- I dati sono annullati dal rollback. Non modificare durante l'implementazione.
begin;
create extension if not exists pgtap with schema extensions;

select plan(60);

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

create function pg_temp.act_as_service_role() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
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

create function pg_temp.can_exec(r text, sig text) returns boolean language plpgsql as $f$
begin
  return has_function_privilege(r, sig, 'execute');
exception when others then
  return null;
end $f$;

create function pg_temp.public_can_exec(fname text) returns boolean language sql as $f$
  select bool_or(exists (
           select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = fname
$f$;

create function pg_temp.definer_with_search_path(fname text) returns boolean language sql as $f$
  select bool_and(p.prosecdef and exists (
           select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = fname
$f$;

-- Esito come testo "blocked/remaining" (es. 'false/5'), per confronti leggibili
-- Un errore (es. funzione mancante) diventa 'ERR:<sqlstate>' e fa fallire solo l'asserzione
create function pg_temp.check_state(p_email text) returns text language plpgsql as $f$
declare r record;
begin
  execute 'select * from public.login_code_check($1)' into r using p_email;
  return r.blocked::text || '/' || r.remaining::text;
exception when others then
  return 'ERR:' || sqlstate;
end $f$;

create function pg_temp.fail(p_email text) returns text language plpgsql as $f$
declare r record;
begin
  execute 'select * from public.login_code_register_failure($1)' into r using p_email;
  return r.blocked::text || '/' || r.remaining::text;
exception when others then
  return 'ERR:' || sqlstate;
end $f$;

create function pg_temp.reset(p_email text) returns text language plpgsql as $f$
begin
  execute 'select public.login_code_reset($1)' using p_email;
  return 'ok';
exception when others then
  return 'ERR:' || sqlstate;
end $f$;

create function pg_temp.clear(p_email text) returns text language plpgsql as $f$
begin
  execute 'select public.login_code_clear($1)' using p_email;
  return 'ok';
exception when others then
  return 'ERR:' || sqlstate;
end $f$;

-- Un privilegio qualsiasi di r sulla tabella (null se la tabella non esiste)
create function pg_temp.any_table_priv(r text) returns boolean language plpgsql as $f$
begin
  return has_table_privilege(r, 'public.login_code_attempts', 'select, insert, update, delete');
exception when others then
  return null;
end $f$;

-- Righe della tabella che contengono il testo (null se la tabella non esiste)
create function pg_temp.rows_containing(needle text) returns bigint language plpgsql as $f$
declare n bigint;
begin
  execute 'select count(*) from public.login_code_attempts t where row_to_json(t)::text ilike $1'
    into n using '%' || needle || '%';
  return n;
exception when others then
  return null;
end $f$;

create function pg_temp.fail_times(p_email text, n int) returns text language plpgsql as $f$
declare last text;
begin
  for i in 1..n loop
    last := pg_temp.fail(p_email);
  end loop;
  return last;
end $f$;

-- ---------------------------------------------------------------------------
-- Struttura: tabella senza accesso diretto (SPEC §8: RLS su tutte le tabelle)
-- ---------------------------------------------------------------------------
select has_table('public', 'login_code_attempts',
  'decisione fetta 8: esiste public.login_code_attempts');
select is((select c.relrowsecurity from pg_class c
            where c.oid = to_regclass('public.login_code_attempts')), true,
  'SPEC §8: RLS attiva su login_code_attempts');
select is((select count(*) from pg_policies
            where schemaname = 'public' and tablename = 'login_code_attempts'), 0::bigint,
  'decisione fetta 8: nessuna policy su login_code_attempts (accesso solo dalle funzioni)');

select is(pg_temp.any_table_priv('anon'), false, 'anon: nessun privilegio su login_code_attempts');
select is(pg_temp.any_table_priv('authenticated'), false, 'authenticated: nessun privilegio su login_code_attempts');

-- Nessuna colonna si chiama "email": si salva solo l'hash
select is((select count(*) from information_schema.columns
            where table_schema = 'public' and table_name = 'login_code_attempts'
              and column_name = 'email'), 0::bigint,
  'decisione fetta 8: login_code_attempts non ha una colonna email in chiaro');

-- ---------------------------------------------------------------------------
-- Funzioni: esistenza, security definer, grant solo a service_role
-- ---------------------------------------------------------------------------
select has_function('public', 'login_code_check', array['text'],
  'decisione fetta 8: esiste public.login_code_check(text)');
select has_function('public', 'login_code_register_failure', array['text'],
  'decisione fetta 8: esiste public.login_code_register_failure(text)');
select has_function('public', 'login_code_reset', array['text'],
  'decisione fetta 8: esiste public.login_code_reset(text)');
select has_function('public', 'login_code_clear', array['text'],
  'decisione fetta 8: esiste public.login_code_clear(text)');
select has_column('public', 'login_code_attempts', 'window_started_at',
  'decisione fetta 8: login_code_attempts.window_started_at (inizio della finestra oraria)');

select is(pg_temp.definer_with_search_path('login_code_check'), true,
  'login_code_check è security definer con search_path fissato');
select is(pg_temp.definer_with_search_path('login_code_register_failure'), true,
  'login_code_register_failure è security definer con search_path fissato');
select is(pg_temp.definer_with_search_path('login_code_reset'), true,
  'login_code_reset è security definer con search_path fissato');
select is(pg_temp.definer_with_search_path('login_code_clear'), true,
  'login_code_clear è security definer con search_path fissato');

select is(pg_temp.public_can_exec('login_code_check'), false, 'login_code_check: niente execute a PUBLIC');
select is(pg_temp.public_can_exec('login_code_register_failure'), false, 'login_code_register_failure: niente execute a PUBLIC');
select is(pg_temp.public_can_exec('login_code_reset'), false, 'login_code_reset: niente execute a PUBLIC');
select is(pg_temp.public_can_exec('login_code_clear'), false, 'login_code_clear: niente execute a PUBLIC');

select is(pg_temp.can_exec('anon', 'public.login_code_check(text)'), false, 'login_code_check: niente execute ad anon');
select is(pg_temp.can_exec('anon', 'public.login_code_register_failure(text)'), false, 'login_code_register_failure: niente execute ad anon');
select is(pg_temp.can_exec('anon', 'public.login_code_reset(text)'), false, 'login_code_reset: niente execute ad anon');
select is(pg_temp.can_exec('anon', 'public.login_code_clear(text)'), false, 'login_code_clear: niente execute ad anon');

select is(pg_temp.can_exec('authenticated', 'public.login_code_check(text)'), false, 'login_code_check: niente execute ad authenticated');
select is(pg_temp.can_exec('authenticated', 'public.login_code_register_failure(text)'), false, 'login_code_register_failure: niente execute ad authenticated');
select is(pg_temp.can_exec('authenticated', 'public.login_code_reset(text)'), false, 'login_code_reset: niente execute ad authenticated');
select is(pg_temp.can_exec('authenticated', 'public.login_code_clear(text)'), false, 'login_code_clear: niente execute ad authenticated');

select is(pg_temp.can_exec('service_role', 'public.login_code_check(text)'), true, 'login_code_check: execute a service_role');
select is(pg_temp.can_exec('service_role', 'public.login_code_register_failure(text)'), true, 'login_code_register_failure: execute a service_role');
select is(pg_temp.can_exec('service_role', 'public.login_code_reset(text)'), true, 'login_code_reset: execute a service_role');
select is(pg_temp.can_exec('service_role', 'public.login_code_clear(text)'), true, 'login_code_clear: execute a service_role');

-- Chiamate reali da anon e da un utente autenticato: rifiutate
select pg_temp.act_as_anon();
select is(pg_temp.outcome($q$ select * from public.login_code_reset('f8-anon@qa.test') $q$), '42501',
  'anon: login_code_reset rifiutata (42501)');
select is(pg_temp.outcome($q$ select * from public.login_code_attempts $q$), '42501',
  'anon: lettura diretta di login_code_attempts rifiutata (42501)');

select pg_temp.act_as('a0000000-0000-4000-8000-000000000003');
select is(pg_temp.outcome($q$ select * from public.login_code_register_failure('f8-auth@qa.test') $q$), '42501',
  'cliente autenticato: login_code_register_failure rifiutata (42501)');
select is(pg_temp.outcome($q$ select * from public.login_code_clear('f8-auth@qa.test') $q$), '42501',
  'cliente autenticato: login_code_clear rifiutata (42501)');
select is(pg_temp.outcome($q$ select * from public.login_code_attempts $q$), '42501',
  'cliente autenticato: lettura diretta di login_code_attempts rifiutata (42501)');

-- ---------------------------------------------------------------------------
-- Comportamento (come service_role)
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service_role();

-- Email mai vista: nessun blocco, 5 tentativi
select is(pg_temp.check_state('f8-fresh@qa.test'), 'false/5',
  'email senza errori: non bloccata, 5 tentativi');

-- 5 errori per codice: al 4° ne resta uno, al 5° blocco
select is(pg_temp.fail_times('f8-limit@qa.test', 4), 'false/1',
  'dopo 4 errori: non bloccata, resta 1 tentativo');
select is(pg_temp.fail('f8-limit@qa.test'), 'true/0',
  'decisione fetta 8: il 5° errore blocca il codice');
select is(pg_temp.check_state('f8-limit@qa.test'), 'true/0',
  'check dopo 5 errori: bloccata, 0 tentativi');

-- Nuovo codice: si riparte (il tetto orario ne ha ancora 5)
select is(pg_temp.reset('f8-limit@qa.test'), 'ok', 'login_code_reset eseguita dal service_role');
select is(pg_temp.check_state('f8-limit@qa.test'), 'false/5',
  'decisione fetta 8: dopo il reset (nuovo codice) di nuovo 5 tentativi');

-- Tetto di 10 errori all'ora, che il reset non azzera
select is(pg_temp.fail_times('f8-limit@qa.test', 5), 'true/0',
  'decisione fetta 8: 10 errori nell''ora → bloccata');
select is(pg_temp.reset('f8-limit@qa.test'), 'ok', 'reset dopo 10 errori nell''ora');
select is(pg_temp.check_state('f8-limit@qa.test'), 'true/0',
  'decisione fetta 8: il reset non supera il tetto di 10 errori all''ora (resta solo il link)');

-- Reset dopo 7 errori nell'ora: restano 3 tentativi, non 5
do $d$ begin
  perform pg_temp.fail_times('f8-cap@qa.test', 5);
  perform pg_temp.reset('f8-cap@qa.test');
  perform pg_temp.fail_times('f8-cap@qa.test', 2);
  perform pg_temp.reset('f8-cap@qa.test');
end $d$;
select is(pg_temp.check_state('f8-cap@qa.test'), 'false/3',
  'decisione fetta 8: dopo 7 errori nell''ora un nuovo codice concede solo 3 tentativi');

-- Normalizzazione dell'email dentro le funzioni (trim + minuscole)
do $d$ begin perform pg_temp.fail('  F8-Norm@QA.Test '); end $d$;
select is(pg_temp.check_state('f8-norm@qa.test'), 'false/4',
  'decisione fetta 8: maiuscole e spazi contano sullo stesso contatore');
do $d$ begin perform pg_temp.reset('F8-NORM@qa.test  '); end $d$;
select is(pg_temp.check_state(' f8-norm@QA.TEST'), 'false/5',
  'decisione fetta 8: anche il reset normalizza l''email');

-- Login riuscito: login_code_clear azzera codice e finestra oraria
do $d$ begin
  perform pg_temp.fail_times('f8-clear@qa.test', 5);
  perform pg_temp.reset('f8-clear@qa.test');
end $d$;
select is(pg_temp.fail_times('f8-clear@qa.test', 5), 'true/0',
  'preparazione: 10 errori nell''ora → bloccata');
select is(pg_temp.clear('f8-clear@qa.test'), 'ok', 'login_code_clear eseguita dal service_role');
select is(pg_temp.check_state('f8-clear@qa.test'), 'false/5',
  'decisione fetta 8: dopo il login riuscito (clear) di nuovo 5 tentativi, anche oltre il tetto orario');

do $d$ begin perform pg_temp.fail_times('f8-clear2@qa.test', 3); end $d$;
do $d$ begin perform pg_temp.clear(' F8-Clear2@QA.TEST '); end $d$;
select is(pg_temp.check_state('f8-clear2@qa.test'), 'false/5',
  'decisione fetta 8: anche clear normalizza l''email');

-- Contatori separati per email
select is(pg_temp.check_state('f8-other@qa.test'), 'false/5',
  'gli errori di un''email non toccano le altre');

-- Finestra oraria fissa: un'ora dal primo errore; scaduta, riparte
do $d$ begin
  perform pg_temp.fail_times('f8-window@qa.test', 5);
  perform pg_temp.reset('f8-window@qa.test');
end $d$;
select is(pg_temp.fail_times('f8-window@qa.test', 5), 'true/0',
  'preparazione: 10 errori nell''ora → bloccata');
do $d$ begin perform pg_temp.reset('f8-window@qa.test'); end $d$;

-- Si retrodatano tutte le finestre (le asserzioni precedenti sono già fatte)
select pg_temp.act_as_postgres();
select matches(
  pg_temp.outcome($q$ update public.login_code_attempts set window_started_at = window_started_at - interval '59 minutes' $q$),
  '^rows:[1-9]', 'finestra retrodatata di 59 minuti');
select pg_temp.act_as_service_role();
select is(pg_temp.check_state('f8-window@qa.test'), 'true/0',
  'decisione fetta 8: dopo 59 minuti la finestra è ancora aperta (bloccata)');

select pg_temp.act_as_postgres();
select matches(
  pg_temp.outcome($q$ update public.login_code_attempts set window_started_at = window_started_at - interval '2 minutes' $q$),
  '^rows:[1-9]', 'finestra retrodatata di altri 2 minuti (61 in tutto)');
select pg_temp.act_as_service_role();
select is(pg_temp.check_state('f8-window@qa.test'), 'false/5',
  'decisione fetta 8: scaduta l''ora dal primo errore il tetto orario riparte');
select is(pg_temp.fail('f8-window@qa.test'), 'false/4',
  'decisione fetta 8: il primo errore dopo la scadenza apre una nuova finestra');

-- Mai l'email in chiaro nella tabella
select pg_temp.act_as_postgres();
select is(pg_temp.rows_containing('qa.test'), 0::bigint,
  'decisione fetta 8: nessuna riga contiene l''email in chiaro');

select * from finish();
rollback;
