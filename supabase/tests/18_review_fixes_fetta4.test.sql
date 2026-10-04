-- Regressioni della review della fetta 4 (miglioria 2, ADR 004).
-- availability_inputs legge le prenotazioni confirmed fino a p_to + 60 minuti (buffer massimo):
-- uno slot a ridosso della fine del periodo deve vedere la prenotazione che il suo buffer toccherebbe.
-- Le fasce di lavoro, le assenze e le chiusure restano tagliate a p_to.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

create function pg_temp.loc(d date, t text) returns timestamptz language sql stable as $f$
  select (d + t::time) at time zone 'Europe/Rome'
$f$;
create function pg_temp.d() returns date language sql stable as $f$
  select (now() at time zone 'Europe/Rome')::date + 3
$f$;

update public.shop_settings set timezone = 'Europe/Rome', max_horizon_days = 365, buffer_min = 0;
delete from public.shop_closures;

insert into public.services (id, name, duration_min, price_cents) values
  ('e5000000-0000-4000-8000-000000001801', 'F4R Taglio', 30, 2000);
insert into public.barbers (id, display_name) values
  ('eb000000-0000-4000-8000-000000001801', 'F4R Uno');
insert into public.barber_services (barber_id, service_id) values
  ('eb000000-0000-4000-8000-000000001801', 'e5000000-0000-4000-8000-000000001801');
-- Fascia fino alle 24:00 (ammessa dal tipo time), tutti i giorni
insert into public.working_hours (barber_id, weekday, start_time, end_time)
select 'eb000000-0000-4000-8000-000000001801', wd, '20:00', '24:00' from generate_series(1, 7) wd;

-- Prenotazioni manuali dopo la mezzanotte: 00:05 (entro 60') e 01:30 (oltre)
insert into public.bookings (guest_name, guest_phone, barber_id, service_id, starts_at, status, source) values
  ('F4R Ospite', '+390300001801', 'eb000000-0000-4000-8000-000000001801', 'e5000000-0000-4000-8000-000000001801',
   pg_temp.loc(pg_temp.d() + 1, '00:05'), 'confirmed', 'manual'),
  ('F4R Ospite', '+390300001801', 'eb000000-0000-4000-8000-000000001801', 'e5000000-0000-4000-8000-000000001801',
   pg_temp.loc(pg_temp.d() + 1, '01:30'), 'confirmed', 'manual');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

create temp table r on commit drop as
select * from public.availability_inputs('e5000000-0000-4000-8000-000000001801', null,
  pg_temp.loc(pg_temp.d(), '00:00'), pg_temp.loc(pg_temp.d() + 1, '00:00'));

select results_eq(
  $q$ select starts_at, ends_at from r where kind = 'busy' $q$,
  $q$ values (pg_temp.loc(pg_temp.d() + 1, '00:05'), pg_temp.loc(pg_temp.d() + 1, '00:35')) $q$,
  'review fetta 4: la prenotazione entro 60'' dalla fine del periodo esce come busy');
select is_empty(
  $q$ select 1 from r where kind = 'busy' and starts_at >= pg_temp.loc(pg_temp.d() + 1, '01:00') $q$,
  'review fetta 4: nessuna prenotazione oltre p_to + 60''');
select results_eq(
  $q$ select starts_at, ends_at from r where kind = 'work' $q$,
  $q$ values (pg_temp.loc(pg_temp.d(), '20:00'), pg_temp.loc(pg_temp.d() + 1, '00:00')) $q$,
  'review fetta 4: le fasce di lavoro restano tagliate a p_to');
select is(pg_typeof((select kind from r limit 1))::text, 'availability_kind',
  'review fetta 4: kind è l''enum availability_kind');

reset role;
select * from finish();
rollback;
