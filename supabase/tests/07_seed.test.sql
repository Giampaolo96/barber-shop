-- Test di accettazione – FETTA 1 (SPEC §11: "Schema DB + RLS + seed dati demo").
-- 07 – Dati demo: unico file che dipende da supabase/seed.sql. Va eseguito dopo `npx supabase db reset`.
-- Sola lettura. Non modificare durante l'implementazione.
begin;
create extension if not exists pgtap with schema extensions;

select plan(23);

-- Esito di un comando: 'rows:N' se riesce, altrimenti lo SQLSTATE (qui serve a fallire in chiaro
-- quando lo schema non esiste ancora).
create function pg_temp.scalar(q text) returns text language plpgsql as $f$
declare v text;
begin
  execute q into v;
  return v;
exception when others then
  return 'SQLSTATE ' || sqlstate;
end $f$;

-- ---------------------------------------------------------------------------
-- SPEC §3.1: impostazioni con i default
-- ---------------------------------------------------------------------------
select is(pg_temp.scalar($q$ select count(*) from public.shop_settings $q$), '1',
  'seed – SPEC §3.1: shop_settings ha una riga');
select is(
  pg_temp.scalar($q$ select row(timezone, slot_granularity_min, min_advance_min, max_horizon_days,
                                 cancel_limit_min, buffer_min, no_show_block_threshold)::text
                       from public.shop_settings $q$),
  '(Europe/Rome,15,60,30,120,0,3)',
  'seed – SPEC §3.1: shop_settings con i valori di default');
select is(pg_temp.scalar($q$ select count(*) from public.shop_settings where coalesce(name, '') <> '' $q$), '1',
  'seed – SPEC §3.1: il negozio ha un nome');

-- ---------------------------------------------------------------------------
-- SPEC §3.2: i 4 servizi di esempio
-- ---------------------------------------------------------------------------
select is(pg_temp.scalar($q$ select duration_min from public.services where name = 'Taglio' $q$), '30',
  'seed – SPEC §3.2: servizio "Taglio" da 30 minuti');
select is(pg_temp.scalar($q$ select duration_min from public.services where name = 'Barba' $q$), '20',
  'seed – SPEC §3.2: servizio "Barba" da 20 minuti');
select is(pg_temp.scalar($q$ select duration_min from public.services where name = 'Taglio + Barba' $q$), '45',
  'seed – SPEC §3.2: servizio "Taglio + Barba" da 45 minuti');
select is(pg_temp.scalar($q$ select duration_min from public.services where name = 'Taglio bambino' $q$), '20',
  'seed – SPEC §3.2: servizio "Taglio bambino" da 20 minuti');
select is(
  pg_temp.scalar($q$ select count(*) from public.services
                      where name in ('Taglio', 'Barba', 'Taglio + Barba', 'Taglio bambino')
                        and is_active and price_cents > 0 $q$),
  '4', 'seed – SPEC §3.2: i 4 servizi sono attivi e hanno un prezzo in centesimi > 0');

-- ---------------------------------------------------------------------------
-- SPEC §3.3 / §3.4: barbieri, servizi abilitati, orari a più fasce
-- ---------------------------------------------------------------------------
select is(pg_temp.scalar($q$ select (count(*) >= 2)::text from public.barbers where is_active $q$), 'true',
  'seed – SPEC §3.3: almeno 2 barbieri attivi');
select is(
  pg_temp.scalar($q$ select count(*) from public.barbers b
                      where b.is_active
                        and not exists (select 1 from public.barber_services bs where bs.barber_id = b.id) $q$),
  '0', 'seed – SPEC §3.3: ogni barbiere attivo è abilitato ad almeno un servizio');
select is(
  pg_temp.scalar($q$ select (count(*) >= 2)::text from public.barbers b
                      where b.is_active
                        and exists (select 1 from public.working_hours w
                                     where w.barber_id = b.id
                                     group by w.weekday having count(*) >= 2) $q$),
  'true', 'seed – SPEC §3.4: almeno 2 barbieri attivi hanno un giorno con più fasce di lavoro');

-- ---------------------------------------------------------------------------
-- SPEC §3.5: assenze e chiusure
-- ---------------------------------------------------------------------------
select is(pg_temp.scalar($q$ select (count(*) >= 1)::text from public.time_off $q$), 'true',
  'seed – SPEC §3.5: almeno un''assenza');
select is(pg_temp.scalar($q$ select (count(*) >= 1)::text from public.shop_closures $q$), 'true',
  'seed – SPEC §3.5: almeno una chiusura del negozio');

-- ---------------------------------------------------------------------------
-- SPEC §2: utenti demo, uno per ruolo
-- ---------------------------------------------------------------------------
select is(pg_temp.scalar($q$ select count(*) from auth.users where email = 'admin@demo.local' $q$), '1',
  'seed – SPEC §2: utente admin@demo.local');
select is(pg_temp.scalar($q$ select count(*) from auth.users where email = 'barber@demo.local' $q$), '1',
  'seed – SPEC §2: utente barber@demo.local');
select is(pg_temp.scalar($q$ select count(*) from auth.users where email = 'cliente@demo.local' $q$), '1',
  'seed – SPEC §2: utente cliente@demo.local');
select is(
  pg_temp.scalar($q$ select p.role::text from public.profiles p join auth.users u on u.id = p.id
                      where u.email = 'admin@demo.local' $q$),
  'admin', 'seed – SPEC §2: admin@demo.local ha un profilo admin');
select is(
  pg_temp.scalar($q$ select p.role::text from public.profiles p join auth.users u on u.id = p.id
                      where u.email = 'barber@demo.local' $q$),
  'barber', 'seed – SPEC §2: barber@demo.local ha un profilo barber');
select is(
  pg_temp.scalar($q$ select p.role::text from public.profiles p join auth.users u on u.id = p.id
                      where u.email = 'cliente@demo.local' $q$),
  'customer', 'seed – SPEC §2: cliente@demo.local ha un profilo customer');
select is(
  pg_temp.scalar($q$ select count(*) from public.barbers b join auth.users u on u.id = b.profile_id
                      where u.email = 'barber@demo.local' and b.is_active $q$),
  '1', 'seed – SPEC §3.3: barber@demo.local è collegato a un barbiere attivo');

-- ---------------------------------------------------------------------------
-- SPEC §3.6: qualche prenotazione
-- ---------------------------------------------------------------------------
select is(pg_temp.scalar($q$ select (count(*) >= 2)::text from public.bookings $q$), 'true',
  'seed – SPEC §3.6: almeno 2 prenotazioni demo');
select is(
  pg_temp.scalar($q$ select (count(*) >= 1)::text from public.bookings k join auth.users u on u.id = k.customer_id
                      where u.email = 'cliente@demo.local' $q$),
  'true', 'seed – SPEC §5.3: cliente@demo.local ha almeno una prenotazione');
select is(
  pg_temp.scalar($q$ select count(*) from public.bookings k join public.services s on s.id = k.service_id
                      where k.ends_at <> k.starts_at + make_interval(mins => k.duration_min)
                         or k.blocked_until <> k.ends_at + make_interval(mins => k.buffer_min) $q$),
  '0', 'seed – SPEC §3.6: le prenotazioni demo hanno ends_at e blocked_until coerenti');

select * from finish();
rollback;
