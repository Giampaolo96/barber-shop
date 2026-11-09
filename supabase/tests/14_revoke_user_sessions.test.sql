-- Fetta 8h: modifica approvata dall'utente il 2026-11-08 (amr password nei claim staff / nome della RPC), nessuna asserzione cambiata.
-- Test di accettazione – FETTA 3 (SPEC §11: "Admin: servizi, barbieri, orari, assenze, chiusure").
-- 14 – revoke_user_sessions: quando l'admin blocca un account staff le sue sessioni vanno
-- revocate anche lato server (PROGRESS fetta 2, "Da fare": ADR 002 lasciava valido il refresh
-- token). SPEC §8 + decisioni approvate per la fetta 3 (punti C e D).
-- Interfaccia attesa:
--   public.revoke_user_sessions(p_user_id uuid)
--     cancella sessioni e refresh token di auth per quell'utente;
--     eseguibile SOLO dal service_role (né PUBLIC, né anon, né authenticated).
-- I dati sono creati dal test e annullati dal rollback. Non modificare durante l'implementazione.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

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

-- Sessioni ancora utilizzabili: righe di auth.sessions e refresh token non revocati
create function pg_temp.live_sessions(uid uuid) returns bigint language sql security definer as $f$
  select (select count(*) from auth.sessions s where s.user_id = uid)
       + (select count(*) from auth.refresh_tokens t
           where t.user_id = uid::text and not coalesce(t.revoked, false))
$f$;

-- ---------------------------------------------------------------------------
-- Dati: un admin, due barbieri con sessioni aperte (come postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('d3000000-0000-4000-8000-000000001401', 'f3-sess-admin@qa.test'),
  ('d3000000-0000-4000-8000-000000001402', 'f3-sess-barber@qa.test'),
  ('d3000000-0000-4000-8000-000000001403', 'f3-sess-other@qa.test');
update public.profiles set role = 'admin' where id = 'd3000000-0000-4000-8000-000000001401';
update public.profiles set role = 'barber'
 where id in ('d3000000-0000-4000-8000-000000001402', 'd3000000-0000-4000-8000-000000001403');

insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  ('5e550000-0000-4000-8000-000000001401', 'd3000000-0000-4000-8000-000000001402', now(), now(), 'aal1'),
  ('5e550000-0000-4000-8000-000000001402', 'd3000000-0000-4000-8000-000000001402', now(), now(), 'aal1'),
  ('5e550000-0000-4000-8000-000000001403', 'd3000000-0000-4000-8000-000000001403', now(), now(), 'aal1');
insert into auth.refresh_tokens (instance_id, token, user_id, revoked, created_at, updated_at, session_id) values
  ('00000000-0000-0000-0000-000000000000', 'f3-token-1401', 'd3000000-0000-4000-8000-000000001402', false, now(), now(), '5e550000-0000-4000-8000-000000001401'),
  ('00000000-0000-0000-0000-000000000000', 'f3-token-1402', 'd3000000-0000-4000-8000-000000001402', false, now(), now(), '5e550000-0000-4000-8000-000000001402'),
  ('00000000-0000-0000-0000-000000000000', 'f3-token-1403', 'd3000000-0000-4000-8000-000000001403', false, now(), now(), '5e550000-0000-4000-8000-000000001403');

select is(pg_temp.live_sessions('d3000000-0000-4000-8000-000000001402'), 4::bigint,
  'preparazione: il barbiere ha due sessioni aperte, ciascuna con un refresh token');

-- ---------------------------------------------------------------------------
-- Struttura e privilegi
-- ---------------------------------------------------------------------------
select has_function('public', 'revoke_user_sessions', array['uuid'],
  'decisione fetta 3: esiste public.revoke_user_sessions(p_user_id uuid)');
select is(pg_temp.public_can_exec('revoke_user_sessions'), false,
  'SPEC §8: revoke_user_sessions non è eseguibile da PUBLIC');
select is(pg_temp.can_exec('anon', 'public.revoke_user_sessions(uuid)'), false,
  'SPEC §8: revoke_user_sessions non è eseguibile da anon');
select is(pg_temp.can_exec('authenticated', 'public.revoke_user_sessions(uuid)'), false,
  'SPEC §8: revoke_user_sessions non è eseguibile da authenticated (nemmeno dall''admin)');
select is(pg_temp.can_exec('service_role', 'public.revoke_user_sessions(uuid)'), true,
  'decisione fetta 3: revoke_user_sessions è eseguibile dal service_role');

-- ---------------------------------------------------------------------------
-- anon e authenticated (anche admin) non possono chiamarla
-- ---------------------------------------------------------------------------
select pg_temp.act_as_anon();
select is(
  pg_temp.outcome($q$ select public.revoke_user_sessions('d3000000-0000-4000-8000-000000001402') $q$),
  '42501', 'anon: revoke_user_sessions rifiutata (42501)');

select pg_temp.act_as('d3000000-0000-4000-8000-000000001401');
select is(
  pg_temp.outcome($q$ select public.revoke_user_sessions('d3000000-0000-4000-8000-000000001402') $q$),
  '42501', 'admin autenticato: revoke_user_sessions rifiutata (solo service_role, 42501)');

select pg_temp.act_as('d3000000-0000-4000-8000-000000001402');
select is(
  pg_temp.outcome($q$ select public.revoke_user_sessions('d3000000-0000-4000-8000-000000001403') $q$),
  '42501', 'barber: revoke_user_sessions rifiutata (42501)');

select pg_temp.act_as_postgres();
select is(pg_temp.live_sessions('d3000000-0000-4000-8000-000000001402'), 4::bigint,
  'dopo i tentativi negati le sessioni del barbiere sono intatte');

-- ---------------------------------------------------------------------------
-- service_role: revoca tutte le sessioni dell'utente, solo le sue
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service_role();
select matches(
  pg_temp.outcome($q$ select public.revoke_user_sessions('d3000000-0000-4000-8000-000000001402') $q$),
  '^rows:\d+$', 'service_role: revoke_user_sessions eseguita');

select pg_temp.act_as_postgres();
select is(pg_temp.live_sessions('d3000000-0000-4000-8000-000000001402'), 0::bigint,
  'decisione fetta 3: nessuna sessione né refresh token utilizzabile per l''utente bloccato');
select is(pg_temp.live_sessions('d3000000-0000-4000-8000-000000001403'), 2::bigint,
  'decisione fetta 3: le sessioni degli altri utenti restano');

-- Utente senza sessioni: nessun errore
select pg_temp.act_as_service_role();
select matches(
  pg_temp.outcome($q$ select public.revoke_user_sessions('d3000000-0000-4000-8000-000000001401') $q$),
  '^rows:\d+$', 'service_role: revoke_user_sessions su un utente senza sessioni non dà errore');

select pg_temp.act_as_postgres();
select * from finish();
rollback;
