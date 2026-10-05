-- Regressioni della review fetta 8a (scritte durante l'implementazione, non da spec-qa).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- Miglioria 6 (opzione B): una fascia che finisce alle 24:00 resta 24:00 negli orari del negozio --
update public.barbers set is_active = false;
insert into public.barbers (id, display_name) values ('eb000000-0000-4000-8000-0000000008a1', 'F8aR Notte');
insert into public.working_hours (barber_id, weekday, start_time, end_time) values
  ('eb000000-0000-4000-8000-0000000008a1', 5, '18:00', '20:00'),
  ('eb000000-0000-4000-8000-0000000008a1', 5, '20:00', '24:00'),
  ('eb000000-0000-4000-8000-0000000008a1', 6, '00:00', '24:00');

select is(
  (select string_agg(weekday || ' ' || to_char(start_time, 'HH24:MI') || '-' || to_char(end_time, 'HH24:MI'), '; '
                     order by weekday, start_time)
     from public.shop_opening_hours()),
  '5 18:00-24:00; 6 00:00-24:00',
  'fasce fino a mezzanotte: fine 24:00 (non 00:00), contigue unite fino a 24:00');
select is(
  (select end_time::text from public.shop_opening_hours() where weekday = 6),
  '24:00:00',
  'il giorno intero 00:00–24:00 finisce alle 24:00');

-- Miglioria 7: chiusure del giorno locale nei giorni del cambio d'ora ---------------------------
select has_function('public', 'shop_closures_on_local_day', array['timestamp with time zone'],
  'esiste la funzione interna shop_closures_on_local_day(timestamptz)');
select ok(not has_function_privilege('anon', 'public.shop_closures_on_local_day(timestamp with time zone)', 'execute')
          and not has_function_privilege('authenticated', 'public.shop_closures_on_local_day(timestamp with time zone)', 'execute'),
  'shop_closures_on_local_day è interna: né anon né authenticated la eseguono');

update public.shop_settings set timezone = 'Europe/Rome';
delete from public.shop_closures;
insert into public.shop_closures (starts_at, ends_at, reason) values
  -- 25/10/2026 (ora solare, 25 ore): il giorno locale va da 22:00Z del 24 a 23:00Z del 25
  ('2026-10-24 21:00Z', '2026-10-24 22:00Z', 'fine del giorno prima'),
  ('2026-10-25 22:30Z', '2026-10-25 23:00Z', 'ultima mezz''ora del 25 (23:30–24:00 +01)'),
  ('2026-10-25 23:00Z', '2026-10-25 23:30Z', 'mezzanotte del 26'),
  -- 28/03/2027 (ora legale, 23 ore): il giorno locale va da 23:00Z del 27 a 22:00Z del 28
  ('2027-03-27 22:30Z', '2027-03-27 23:00Z', 'fine del 27'),
  ('2027-03-28 21:30Z', '2027-03-28 22:00Z', 'ultima mezz''ora del 28 (23:30–24:00 +02)'),
  ('2027-03-28 22:00Z', '2027-03-28 22:30Z', 'mezzanotte del 29');

select is(
  (select array_agg(starts_at order by starts_at) from public.shop_closures_on_local_day('2026-10-25 12:00Z')),
  array['2026-10-25 22:30Z'::timestamptz],
  'cambio all''ora solare: conta solo la chiusura dentro le 25 ore del 25 ottobre');
select is(
  (select array_agg(starts_at order by starts_at) from public.shop_closures_on_local_day('2026-10-24 22:00Z')),
  array['2026-10-25 22:30Z'::timestamptz],
  'cambio all''ora solare: la mezzanotte locale (22:00Z) apre già il 25 ottobre');
select is(
  (select array_agg(starts_at order by starts_at) from public.shop_closures_on_local_day('2027-03-28 12:00Z')),
  array['2027-03-28 21:30Z'::timestamptz],
  'cambio all''ora legale: conta solo la chiusura dentro le 23 ore del 28 marzo');
select is(
  (select array_agg(starts_at order by starts_at) from public.shop_closures_on_local_day('2027-03-28 21:59Z')),
  array['2027-03-28 21:30Z'::timestamptz],
  'cambio all''ora legale: alle 23:59 locali (21:59Z) è ancora il 28 marzo');
select is(
  (select array_agg(starts_at order by starts_at) from public.shop_closures_on_local_day('2027-03-28 22:00Z')),
  array['2027-03-28 22:00Z'::timestamptz],
  'cambio all''ora legale: alle 22:00Z è già il 29 marzo');

select * from finish();
rollback;
