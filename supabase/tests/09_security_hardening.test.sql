-- Test del rafforzamento di sicurezza dopo la review della FETTA 1 (non fanno parte dei
-- test di accettazione scritti prima dell'implementazione). Creano i propri dati, tranne
-- la riga di shop_settings (seed): vanno eseguiti dopo `npx supabase db reset`.
begin;
create extension if not exists pgtap with schema extensions;

select plan(87);

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

-- ruolo postgres ma con un utente identificato nel JWT (es. eliminazione di un account)
create function pg_temp.postgres_on_behalf_of(uid uuid) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
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

insert into auth.users (id, email) values
  ('e0000000-0000-4000-8000-000000000901', 'hard-admin@qa.test'),
  ('e0000000-0000-4000-8000-000000000902', 'hard-barber@qa.test'),
  ('e0000000-0000-4000-8000-000000000903', 'hard-customer1@qa.test'),
  ('e0000000-0000-4000-8000-000000000904', 'hard-customer2@qa.test'),
  ('e0000000-0000-4000-8000-000000000905', 'hard-customer3@qa.test'),
  ('e0000000-0000-4000-8000-000000000906', 'hard-barber2@qa.test'),
  ('e0000000-0000-4000-8000-000000000907', 'hard-customer4@qa.test');
update public.profiles set role = 'admin', full_name = 'Hard Admin', phone = '+390300000901'
 where id = 'e0000000-0000-4000-8000-000000000901';
update public.profiles set role = 'barber'
 where id in ('e0000000-0000-4000-8000-000000000902', 'e0000000-0000-4000-8000-000000000906');

insert into public.services (id, name, duration_min, price_cents, is_active) values
  ('e5000000-0000-4000-8000-000000000901', 'Hard Taglio', 30, 2000, true),
  ('e5000000-0000-4000-8000-000000000902', 'Hard Disattivato', 30, 2000, false);
insert into public.barbers (id, display_name, is_active, profile_id) values
  ('eb000000-0000-4000-8000-000000000901', 'Hard Barber', true, 'e0000000-0000-4000-8000-000000000902'),
  ('eb000000-0000-4000-8000-000000000902', 'Hard Inattivo', false, null),
  ('eb000000-0000-4000-8000-000000000903', 'Hard Altro Barbiere', true, 'e0000000-0000-4000-8000-000000000906');
insert into public.barber_services (barber_id, service_id) values
  ('eb000000-0000-4000-8000-000000000901', 'e5000000-0000-4000-8000-000000000901'),
  ('eb000000-0000-4000-8000-000000000901', 'e5000000-0000-4000-8000-000000000902'),
  ('eb000000-0000-4000-8000-000000000902', 'e5000000-0000-4000-8000-000000000901'),
  ('eb000000-0000-4000-8000-000000000903', 'e5000000-0000-4000-8000-000000000901');

insert into public.bookings (id, customer_id, guest_name, guest_phone, barber_id, service_id, starts_at, source) values
  -- 901: passata, cliente 1
  ('ed000000-0000-4000-8000-000000000901', 'e0000000-0000-4000-8000-000000000903', null, null,
   'eb000000-0000-4000-8000-000000000901', 'e5000000-0000-4000-8000-000000000901', '2024-01-08 10:00:00+01', 'manual'),
  -- 902: futura, ospite
  ('ed000000-0000-4000-8000-000000000902', null, 'Hard Ospite', '+390300000902',
   'eb000000-0000-4000-8000-000000000901', 'e5000000-0000-4000-8000-000000000901', '2040-03-06 10:00:00+01', 'manual'),
  -- 903 e 904: futura e passata del cliente 3, che eliminerà il proprio account
  ('ed000000-0000-4000-8000-000000000903', 'e0000000-0000-4000-8000-000000000905', null, null,
   'eb000000-0000-4000-8000-000000000901', 'e5000000-0000-4000-8000-000000000901', '2040-03-06 11:00:00+01', 'online'),
  ('ed000000-0000-4000-8000-000000000904', 'e0000000-0000-4000-8000-000000000905', null, null,
   'eb000000-0000-4000-8000-000000000901', 'e5000000-0000-4000-8000-000000000901', '2024-01-08 11:00:00+01', 'online'),
  -- 906: cliente 1 con l'altro barbiere; 907: cliente 1 con il barbiere di prova.
  -- Fetta 6 (regola 6, SPEC §3.7.6): 906 alle 11:00, non più alla stessa ora di 907.
  ('ed000000-0000-4000-8000-000000000906', 'e0000000-0000-4000-8000-000000000903', null, null,
   'eb000000-0000-4000-8000-000000000903', 'e5000000-0000-4000-8000-000000000901', '2040-03-07 11:00:00+01', 'online'),
  ('ed000000-0000-4000-8000-000000000907', 'e0000000-0000-4000-8000-000000000903', null, null,
   'eb000000-0000-4000-8000-000000000901', 'e5000000-0000-4000-8000-000000000901', '2040-03-07 10:00:00+01', 'online'),
  -- 908: futura del cliente 4, il cui account verrà eliminato dall'admin
  ('ed000000-0000-4000-8000-000000000908', 'e0000000-0000-4000-8000-000000000907', null, null,
   'eb000000-0000-4000-8000-000000000901', 'e5000000-0000-4000-8000-000000000901', '2040-03-08 10:00:00+01', 'online'),
  -- 909: passata del cliente 1, diventerà no_show e poi verrà intestata a un ospite
  ('ed000000-0000-4000-8000-000000000909', 'e0000000-0000-4000-8000-000000000903', null, null,
   'eb000000-0000-4000-8000-000000000901', 'e5000000-0000-4000-8000-000000000901', '2024-01-08 13:00:00+01', 'manual');

-- ---------------------------------------------------------------------------
-- 1. id e created_at immutabili per tutti; il barbiere modifica il nominativo ospite
-- ---------------------------------------------------------------------------
select is(
  pg_temp.outcome($q$ update public.bookings set id = 'ed000000-0000-4000-8000-0000000009ff'
                       where id = 'ed000000-0000-4000-8000-000000000902' $q$),
  '42501', 'postgres: id di una prenotazione non modificabile');
select is(
  pg_temp.outcome($q$ update public.bookings set created_at = '1999-01-01 00:00:00+00'
                       where id = 'ed000000-0000-4000-8000-000000000902' $q$),
  '42501', 'postgres: created_at di una prenotazione non modificabile');

select pg_temp.act_as('e0000000-0000-4000-8000-000000000901');
select is(
  pg_temp.outcome($q$ update public.bookings set created_at = '1999-01-01 00:00:00+00'
                       where id = 'ed000000-0000-4000-8000-000000000902' $q$),
  '42501', 'admin: created_at di una prenotazione non modificabile');

select pg_temp.act_as('e0000000-0000-4000-8000-000000000902');
select is(
  pg_temp.outcome($q$ update public.bookings set id = 'ed000000-0000-4000-8000-0000000009ff'
                       where id = 'ed000000-0000-4000-8000-000000000902' $q$),
  '42501', 'barber: id di una prenotazione non modificabile');
select is(
  pg_temp.outcome($q$ update public.bookings set guest_name = 'Hard Ospite Corretto', guest_phone = '+390300000999'
                       where id = 'ed000000-0000-4000-8000-000000000902' $q$),
  'rows:1', 'barber: modifica nominativo e telefono dell''ospite');
insert into public.bookings (id, guest_name, guest_phone, barber_id, service_id, starts_at, source, created_at)
values ('ed000000-0000-4000-8000-000000000905', 'Hard Ospite 2', '+390300000905',
        'eb000000-0000-4000-8000-000000000901', 'e5000000-0000-4000-8000-000000000901',
        '2040-03-06 12:00:00+01', 'manual', '1999-01-01 00:00:00+00');
select is(
  (select created_at = now() from public.bookings where id = 'ed000000-0000-4000-8000-000000000905'),
  true, 'barber: created_at passato in insert viene sovrascritto');

-- ---------------------------------------------------------------------------
-- 2. customer_id deve puntare a un profilo customer; il barbiere legge solo profili customer
-- ---------------------------------------------------------------------------
select is(
  pg_temp.outcome($q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
                      values ('e0000000-0000-4000-8000-000000000901', 'eb000000-0000-4000-8000-000000000901',
                              'e5000000-0000-4000-8000-000000000901', '2040-03-06 13:00:00+01', 'manual') $q$),
  '23514', 'barber: non intesta una prenotazione a un profilo admin');
select is(
  (select count(*) from public.profiles where id = 'e0000000-0000-4000-8000-000000000901'),
  0::bigint, 'barber: il profilo dell''admin resta non leggibile');
select is(
  pg_temp.outcome($q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source)
                      values ('e0000000-0000-4000-8000-000000000904', 'eb000000-0000-4000-8000-000000000901',
                              'e5000000-0000-4000-8000-000000000901', '2040-03-06 13:00:00+01', 'manual') $q$),
  'rows:1', 'barber: intesta una prenotazione a un profilo customer');
select is(
  (select count(*) from public.profiles where id = 'e0000000-0000-4000-8000-000000000903'),
  1::bigint, 'barber: legge il profilo di un proprio cliente');

-- un cliente con prenotazioni viene promosso a staff: il barbiere non lo legge più
select pg_temp.act_as_postgres();
update public.profiles set role = 'barber' where id = 'e0000000-0000-4000-8000-000000000903';
select pg_temp.act_as('e0000000-0000-4000-8000-000000000902');
select is(
  (select count(*) from public.profiles where id = 'e0000000-0000-4000-8000-000000000903'),
  0::bigint, 'barber: non legge il profilo di un cliente promosso a staff');
select pg_temp.act_as_postgres();
update public.profiles set role = 'customer' where id = 'e0000000-0000-4000-8000-000000000903';

select pg_temp.act_as('e0000000-0000-4000-8000-000000000901');
select is(
  pg_temp.outcome($q$ update public.bookings set customer_id = 'e0000000-0000-4000-8000-000000000902'
                       where id = 'ed000000-0000-4000-8000-000000000902' $q$),
  '23514', 'admin: non intesta una prenotazione a un profilo barber');

-- ---------------------------------------------------------------------------
-- 3. Admin: prezzo e durata modificabili, con ricalcolo degli orari
-- ---------------------------------------------------------------------------
select is(
  pg_temp.outcome($q$ update public.bookings set price_cents = 1500, duration_min = 50
                       where id = 'ed000000-0000-4000-8000-000000000902' $q$),
  'rows:1', 'admin: modifica prezzo e durata di una prenotazione');
select is(
  (select row(price_cents, duration_min, ends_at, blocked_until)::text
     from public.bookings where id = 'ed000000-0000-4000-8000-000000000902'),
  row(1500, 50, '2040-03-06 10:50:00+01'::timestamptz, '2040-03-06 10:50:00+01'::timestamptz)::text,
  'admin: la nuova durata ricalcola ends_at e blocked_until');
select is(
  pg_temp.outcome($q$ update public.bookings set duration_min = 90
                       where id = 'ed000000-0000-4000-8000-000000000902' $q$),
  '23P01', 'admin: una durata che sovrappone la prenotazione successiva è rifiutata');

-- ---------------------------------------------------------------------------
-- 4. Visibilità del catalogo: barbers.profile_id solo per lo staff
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select is(
  pg_temp.outcome($q$ select profile_id from public.barbers $q$),
  '42501', 'anon: barbers.profile_id non leggibile');
select is(
  (select display_name from public.barbers where id = 'eb000000-0000-4000-8000-000000000901'),
  'Hard Barber', 'anon: legge le colonne pubbliche dei barbieri attivi');
select is(
  (select count(*) from public.barber_services
    where barber_id in ('eb000000-0000-4000-8000-000000000901', 'eb000000-0000-4000-8000-000000000902')),
  1::bigint, 'anon: vede solo le coppie con servizio e barbiere attivi');
select is(
  pg_temp.outcome($q$ select * from public.barber_accounts() $q$),
  '42501', 'anon: non esegue barber_accounts()');

select pg_temp.act_as('e0000000-0000-4000-8000-000000000903');
select is(
  (select count(*) from public.barber_services
    where barber_id in ('eb000000-0000-4000-8000-000000000901', 'eb000000-0000-4000-8000-000000000902')),
  1::bigint, 'customer: vede solo le coppie con servizio e barbiere attivi');
select is(
  pg_temp.outcome($q$ select profile_id from public.barbers $q$),
  '42501', 'customer: barbers.profile_id non leggibile');
select is(
  (select count(*) from public.barber_accounts()),
  0::bigint, 'customer: barber_accounts() non restituisce righe');

select pg_temp.act_as('e0000000-0000-4000-8000-000000000902');
select is(
  (select count(*) from public.barber_services
    where barber_id in ('eb000000-0000-4000-8000-000000000901', 'eb000000-0000-4000-8000-000000000902')),
  3::bigint, 'barber: vede anche le coppie con elementi disattivati');
select is(
  (select profile_id from public.barber_accounts() where barber_id = 'eb000000-0000-4000-8000-000000000901'),
  'e0000000-0000-4000-8000-000000000902'::uuid,
  'barber: legge il collegamento barbiere → account con barber_accounts()');
select pg_temp.act_as_postgres();

-- ---------------------------------------------------------------------------
-- 5. Privilegi di default chiusi su tabelle e sequenze; funzioni con revoke esplicito
-- ---------------------------------------------------------------------------
create table public.zz_probe (id integer);
create sequence public.zz_probe_seq;
create function public.zz_probe_fn() returns integer language sql as $f$ select 1 $f$;

select is(has_table_privilege('anon', 'public.zz_probe', 'select'), false,
  'default privileges: una tabella nuova non è leggibile da anon');
select is(has_table_privilege('authenticated', 'public.zz_probe', 'select, insert, update, delete'), false,
  'default privileges: una tabella nuova non è accessibile ad authenticated');
select is(
  has_sequence_privilege('anon', 'public.zz_probe_seq', 'usage, select, update')
    or has_sequence_privilege('authenticated', 'public.zz_probe_seq', 'usage, select, update'),
  false, 'default privileges: una sequenza nuova non è accessibile ad anon e authenticated');
-- Per le funzioni resta solo il default globale di Postgres (EXECUTE a PUBLIC): nessun
-- grant esplicito ad anon o authenticated. Il revoke da PUBLIC spetta alla migrazione.
select is_empty(
  $q$ select a.grantee::regrole::text
        from pg_proc p,
             aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.oid = 'public.zz_probe_fn()'::regprocedure
         and a.grantee in ('anon'::regrole, 'authenticated'::regrole) $q$,
  'default privileges: una funzione nuova non riceve grant espliciti per anon e authenticated');

set local role anon;
select is(pg_temp.outcome($q$ select * from public.zz_probe $q$), '42501',
  'anon: select sulla tabella di prova negato');
reset role;

drop function public.zz_probe_fn();
drop sequence public.zz_probe_seq;
drop table public.zz_probe;

-- Nessuna funzione dello schema public è eseguibile da PUBLIC o da anon, salvo gli helper
-- delle policy che anon deve poter chiamare per leggere il catalogo. Una funzione nuova
-- senza revoke esplicito fa fallire questo test.
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
         -- costruttori del tipo range public.timerange: funzioni di sistema create con il
         -- tipo, di proprietà del superutente, non revocabili da una migrazione; non leggono dati
         and p.proname not in ('timerange', 'timemultirange') $q$,
  'nessuna funzione di public eseguibile da PUBLIC o anon, salvo gli helper delle policy');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('current_user_role', 'is_admin', 'is_staff', 'current_barber_id')
      and has_function_privilege('anon', p.oid, 'execute')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  4::bigint, 'gli helper delle policy sono eseguibili da anon e authenticated');

select is(has_function_privilege('anon', 'public.search_customers(text)', 'execute'), false,
  'search_customers non è eseguibile da anon');
select is(has_function_privilege('service_role', 'public.search_customers(text)', 'execute'), false,
  'search_customers non è eseguibile da service_role');
select is(has_function_privilege('authenticated', 'public.search_customers(text)', 'execute'), true,
  'search_customers è eseguibile da authenticated (il controllo staff è nella funzione)');
select is(has_function_privilege('anon', 'public.bookings_sync_no_show_count()', 'execute'), false,
  'le funzioni dei trigger non sono eseguibili da anon');

-- ---------------------------------------------------------------------------
-- 6. Guardia dei profili senza pg_trigger_depth; il contatore funziona comunque
-- ---------------------------------------------------------------------------
select is(
  (select p.prosrc ~ 'pg_trigger_depth' from pg_proc p
    where p.oid = 'public.profiles_guard_reserved_columns()'::regprocedure),
  false, 'la guardia dei profili non usa pg_trigger_depth()');

select pg_temp.act_as('e0000000-0000-4000-8000-000000000902');
select is(
  pg_temp.outcome($q$ update public.bookings set status = 'no_show'
                       where id = 'ed000000-0000-4000-8000-000000000901' $q$),
  'rows:1', 'barber: segna no_show una propria prenotazione passata');
select pg_temp.act_as_postgres();
select is(
  (select no_show_count from public.profiles where id = 'e0000000-0000-4000-8000-000000000903'),
  1, 'il no_show segnato dal barbiere incrementa il contatore del cliente');

-- ---------------------------------------------------------------------------
-- 7. Cambio di customer_id su una prenotazione no_show: il conteggio si sposta
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e0000000-0000-4000-8000-000000000901');
select is(
  pg_temp.outcome($q$ update public.bookings set customer_id = 'e0000000-0000-4000-8000-000000000904'
                       where id = 'ed000000-0000-4000-8000-000000000901' $q$),
  'rows:1', 'admin: cambia il cliente di una prenotazione no_show');
select pg_temp.act_as_postgres();
select is(
  (select no_show_count from public.profiles where id = 'e0000000-0000-4000-8000-000000000903'),
  0, 'il vecchio cliente perde il no-show');
select is(
  (select no_show_count from public.profiles where id = 'e0000000-0000-4000-8000-000000000904'),
  1, 'il nuovo cliente riceve il no-show');

-- verso un ospite (customer_id NULL): il conteggio scende e basta
update public.bookings set status = 'no_show' where id = 'ed000000-0000-4000-8000-000000000909';
select is(
  (select no_show_count from public.profiles where id = 'e0000000-0000-4000-8000-000000000903'),
  1, 'una seconda prenotazione no_show del cliente 1 porta il contatore a 1');
select pg_temp.act_as('e0000000-0000-4000-8000-000000000901');
select is(
  pg_temp.outcome($q$ update public.bookings
                         set customer_id = null, guest_name = 'Hard Ospite 4', guest_phone = '+390300000909'
                       where id = 'ed000000-0000-4000-8000-000000000909' $q$),
  'rows:1', 'admin: intesta una prenotazione no_show a un ospite');
select pg_temp.act_as_postgres();
select is(
  (select no_show_count from public.profiles where id = 'e0000000-0000-4000-8000-000000000903'),
  0, 'passando a un ospite il cliente perde il no-show');

-- ---------------------------------------------------------------------------
-- 8. DELETE su bookings: solo l'admin; eliminare una no_show decrementa il contatore
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e0000000-0000-4000-8000-000000000902');
select matches(
  pg_temp.outcome($q$ delete from public.bookings where id = 'ed000000-0000-4000-8000-000000000901' $q$),
  '^(rows:0|42501)$', 'barber: non elimina una propria prenotazione');
select pg_temp.act_as('e0000000-0000-4000-8000-000000000904');
select matches(
  pg_temp.outcome($q$ delete from public.bookings where id = 'ed000000-0000-4000-8000-000000000901' $q$),
  '^(rows:0|42501)$', 'customer: non elimina una propria prenotazione');
select pg_temp.act_as('e0000000-0000-4000-8000-000000000901');
select is(
  pg_temp.outcome($q$ delete from public.bookings where id = 'ed000000-0000-4000-8000-000000000901' $q$),
  'rows:1', 'admin: elimina una prenotazione no_show');
select pg_temp.act_as_postgres();
select is(
  (select no_show_count from public.profiles where id = 'e0000000-0000-4000-8000-000000000904'),
  0, 'eliminare una prenotazione no_show decrementa il contatore del cliente');
select pg_temp.act_as('e0000000-0000-4000-8000-000000000901');
select is(
  pg_temp.outcome($q$ delete from public.bookings where id = 'ed000000-0000-4000-8000-000000000905' $q$),
  'rows:1', 'admin: elimina una prenotazione confirmed');
select pg_temp.act_as_postgres();
select is(
  (select no_show_count from public.profiles where id = 'e0000000-0000-4000-8000-000000000904'),
  0, 'eliminare una prenotazione non no_show non tocca il contatore');

-- ---------------------------------------------------------------------------
-- 9. Note staff: tabella separata, mai visibile al cliente
-- ---------------------------------------------------------------------------
select is(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.booking_staff_notes'::regclass),
  true, 'booking_staff_notes: RLS attiva');

select pg_temp.act_as('e0000000-0000-4000-8000-000000000902');
select is(
  pg_temp.outcome($q$ insert into public.booking_staff_notes (booking_id, note, updated_by, updated_at)
                      values ('ed000000-0000-4000-8000-000000000907', 'Cliente difficile',
                              'e0000000-0000-4000-8000-000000000901', '1999-01-01 00:00:00+00') $q$),
  'rows:1', 'barber: scrive una nota staff su una propria prenotazione');
select is(
  (select row(updated_by, updated_at = now())::text from public.booking_staff_notes
    where booking_id = 'ed000000-0000-4000-8000-000000000907'),
  row('e0000000-0000-4000-8000-000000000902'::uuid, true)::text,
  'booking_staff_notes: updated_by e updated_at valorizzati dal database');
select is(
  pg_temp.outcome($q$ insert into public.booking_staff_notes (booking_id, note)
                      values ('ed000000-0000-4000-8000-000000000906', 'non mia') $q$),
  '42501', 'barber: non scrive note sulle prenotazioni di un altro barbiere');
select is(
  pg_temp.outcome($q$ update public.booking_staff_notes set note = 'Cliente puntuale'
                       where booking_id = 'ed000000-0000-4000-8000-000000000907' $q$),
  'rows:1', 'barber: aggiorna la propria nota staff');
select is(
  pg_temp.outcome($q$ update public.booking_staff_notes set booking_id = 'ed000000-0000-4000-8000-000000000906'
                       where booking_id = 'ed000000-0000-4000-8000-000000000907' $q$),
  '42501', 'barber: non sposta una nota su una prenotazione di un altro barbiere');

select pg_temp.act_as('e0000000-0000-4000-8000-000000000901');
select is(
  pg_temp.outcome($q$ insert into public.booking_staff_notes (booking_id, note)
                      values ('ed000000-0000-4000-8000-000000000906', 'Nota admin') $q$),
  'rows:1', 'admin: scrive una nota staff su qualunque prenotazione');
select is((select count(*) from public.booking_staff_notes
            where booking_id in ('ed000000-0000-4000-8000-000000000906', 'ed000000-0000-4000-8000-000000000907')),
  2::bigint, 'admin: legge tutte le note staff');

select pg_temp.act_as('e0000000-0000-4000-8000-000000000902');
select is(
  pg_temp.outcome($q$ insert into public.booking_staff_notes (booking_id, note)
                      values ('ed000000-0000-4000-8000-000000000906', 'sovrascritta')
                      on conflict (booking_id) do update set note = excluded.note $q$),
  '42501', 'barber: non sovrascrive con un upsert la nota di una prenotazione altrui');
select is((select count(*) from public.booking_staff_notes
            where booking_id in ('ed000000-0000-4000-8000-000000000906', 'ed000000-0000-4000-8000-000000000907')),
  1::bigint, 'barber: legge solo le note delle proprie prenotazioni');

-- barbiere estraneo alla prenotazione 907
select pg_temp.act_as('e0000000-0000-4000-8000-000000000906');
select is(
  pg_temp.outcome($q$ delete from public.booking_staff_notes
                       where booking_id = 'ed000000-0000-4000-8000-000000000907' $q$),
  'rows:0', 'barber: non elimina la nota di una prenotazione altrui');

-- il cliente 1 è intestatario di entrambe le prenotazioni
select pg_temp.act_as('e0000000-0000-4000-8000-000000000903');
select is((select count(*) from public.bookings
            where id in ('ed000000-0000-4000-8000-000000000906', 'ed000000-0000-4000-8000-000000000907')),
  2::bigint, 'customer: vede le proprie prenotazioni');
select is((select count(*) from public.booking_staff_notes), 0::bigint,
  'customer: non vede nessuna nota staff, nemmeno sulle proprie prenotazioni');
select is(
  pg_temp.outcome($q$ insert into public.booking_staff_notes (booking_id, note)
                      values ('ed000000-0000-4000-8000-000000000906', 'x') $q$),
  '42501', 'customer: non scrive note staff (nessun oracolo sull''esistenza della nota)');
select is(
  pg_temp.outcome($q$ update public.booking_staff_notes set note = 'hacked' $q$),
  'rows:0', 'customer: non modifica note staff');
select is(
  pg_temp.outcome($q$ delete from public.booking_staff_notes $q$),
  'rows:0', 'customer: non elimina note staff');

set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select is(pg_temp.outcome($q$ select * from public.booking_staff_notes $q$), '42501',
  'anon: nessun accesso a booking_staff_notes');
select pg_temp.act_as_postgres();

-- uno staff autore di note e collegato a un barbiere resta eliminabile
select lives_ok(
  $q$ delete from auth.users where id = 'e0000000-0000-4000-8000-000000000902' $q$,
  'un barbiere autore di una nota staff è eliminabile');
select is(
  (select updated_by from public.booking_staff_notes where booking_id = 'ed000000-0000-4000-8000-000000000907'),
  null, 'dopo l''eliminazione dell''autore updated_by è NULL');
select is(
  (select row(count(*), count(profile_id))::text from public.barbers
    where id = 'eb000000-0000-4000-8000-000000000901'),
  '(1,0)', 'il barbiere resta, senza account collegato (profile_id NULL)');

-- ---------------------------------------------------------------------------
-- 10. Eliminazione di un profilo: le prenotazioni future confirmed vengono cancellate
-- ---------------------------------------------------------------------------
update public.bookings set status = 'no_show' where id = 'ed000000-0000-4000-8000-000000000904';

-- il cliente 3 elimina il proprio account
select pg_temp.postgres_on_behalf_of('e0000000-0000-4000-8000-000000000905');
select lives_ok(
  $q$ delete from auth.users where id = 'e0000000-0000-4000-8000-000000000905' $q$,
  'un cliente con prenotazioni future e no_show elimina il proprio account');
select is(
  (select row(status, customer_id)::text from public.bookings where id = 'ed000000-0000-4000-8000-000000000903'),
  row('cancelled_by_customer'::public.booking_status, null::uuid)::text,
  'eliminazione da parte dell''utente: la futura confirmed passa a cancelled_by_customer');
select is(
  (select row(status, customer_id)::text from public.bookings where id = 'ed000000-0000-4000-8000-000000000904'),
  row('no_show'::public.booking_status, null::uuid)::text,
  'la prenotazione passata no_show non cambia stato e perde il cliente');
select pg_temp.act_as_postgres();
select lives_ok(
  $q$ insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, source)
      values ('Hard Ospite 3', '+390300000906', 'eb000000-0000-4000-8000-000000000901',
              'e5000000-0000-4000-8000-000000000901', '2040-03-06 11:00:00+01', 'manual') $q$,
  'lo slot della prenotazione cancellata torna libero');

-- l'admin elimina l'account del cliente 4
select pg_temp.postgres_on_behalf_of('e0000000-0000-4000-8000-000000000901');
select lives_ok(
  $q$ delete from auth.users where id = 'e0000000-0000-4000-8000-000000000907' $q$,
  'l''admin elimina l''account di un cliente con una prenotazione futura');
select is(
  (select row(status, customer_id)::text from public.bookings where id = 'ed000000-0000-4000-8000-000000000908'),
  row('cancelled_by_shop'::public.booking_status, null::uuid)::text,
  'eliminazione da parte dell''admin: la futura confirmed passa a cancelled_by_shop');
select pg_temp.act_as_postgres();

-- ---------------------------------------------------------------------------
-- 11. Ultimo admin attivo
-- ---------------------------------------------------------------------------
update public.profiles set role = 'customer'
 where role = 'admin' and id <> 'e0000000-0000-4000-8000-000000000901';

select is(
  pg_temp.outcome($q$ update public.profiles set role = 'customer'
                       where id = 'e0000000-0000-4000-8000-000000000901' $q$),
  '23514', 'l''ultimo admin non può essere declassato');
select is(
  pg_temp.outcome($q$ delete from auth.users where id = 'e0000000-0000-4000-8000-000000000901' $q$),
  '23514', 'l''ultimo admin non può essere eliminato');
select is(
  pg_temp.outcome($q$ update public.profiles set is_blocked = true
                       where id = 'e0000000-0000-4000-8000-000000000901' $q$),
  '23514', 'l''ultimo admin non può essere bloccato');

update public.profiles set role = 'admin' where id = 'e0000000-0000-4000-8000-000000000904';
select is(
  pg_temp.outcome($q$ update public.profiles set role = 'customer' where role = 'admin' $q$),
  '23514', 'un update multi-riga non può declassare tutti gli admin');

-- un admin bloccato non conta
update public.profiles set is_blocked = true where id = 'e0000000-0000-4000-8000-000000000904';
select is(
  pg_temp.outcome($q$ update public.profiles set role = 'customer'
                       where id = 'e0000000-0000-4000-8000-000000000901' $q$),
  '23514', 'se l''unico altro admin è bloccato, il declassamento è rifiutato');
update public.profiles set is_blocked = false where id = 'e0000000-0000-4000-8000-000000000904';
select is(
  pg_temp.outcome($q$ update public.profiles set role = 'customer'
                       where id = 'e0000000-0000-4000-8000-000000000901' $q$),
  'rows:1', 'con un altro admin attivo il declassamento è ammesso');

-- ---------------------------------------------------------------------------
-- 12. Timezone del negozio
-- ---------------------------------------------------------------------------
select is(
  pg_temp.outcome($q$ update public.shop_settings set timezone = 'Europe/Atlantide' $q$),
  '23514', 'shop_settings: timezone sconosciuto rifiutato');
select is(
  pg_temp.outcome($q$ update public.shop_settings set timezone = 'Europe/Paris' $q$),
  'rows:1', 'shop_settings: timezone valido accettato');
select is(
  pg_temp.outcome($q$ update public.shop_settings set timezone = '' $q$),
  '23514', 'shop_settings: timezone vuoto rifiutato');
select is(
  pg_temp.outcome($q$ update public.shop_settings set timezone = '  europe/rome ' $q$),
  'rows:1', 'shop_settings: timezone accettato senza distinguere maiuscole e spazi');
select is((select timezone from public.shop_settings), 'Europe/Rome',
  'shop_settings: timezone salvato in forma canonica');

select * from finish();
rollback;
