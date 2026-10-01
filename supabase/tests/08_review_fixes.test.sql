-- Test di regressione aggiunti dopo la review della FETTA 1 (non fanno parte dei test di
-- accettazione scritti prima dell'implementazione). Creano i propri dati.
begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $f$;

insert into auth.users (id, email) values
  ('d0000000-0000-4000-8000-000000000801', 'rev-admin@qa.test'),
  ('d0000000-0000-4000-8000-000000000802', 'rev-barber@qa.test'),
  ('d0000000-0000-4000-8000-000000000803', 'rev-customer@qa.test');
update public.profiles set role = 'admin' where id = 'd0000000-0000-4000-8000-000000000801';
update public.profiles set role = 'barber' where id = 'd0000000-0000-4000-8000-000000000802';

insert into public.services (id, name, duration_min, price_cents) values
  ('d5000000-0000-4000-8000-000000000801', 'Rev Taglio', 30, 2000);
insert into public.barbers (id, display_name, profile_id) values
  ('db000000-0000-4000-8000-000000000801', 'Rev Barber', 'd0000000-0000-4000-8000-000000000802');
insert into public.barber_services (barber_id, service_id) values
  ('db000000-0000-4000-8000-000000000801', 'd5000000-0000-4000-8000-000000000801');

-- ---------------------------------------------------------------------------
-- B1 – ADR 001: il SET NULL di status_changed_by non deve essere annullato dal trigger
-- ---------------------------------------------------------------------------
select pg_temp.act_as('d0000000-0000-4000-8000-000000000801');
insert into public.bookings (id, guest_name, guest_phone, barber_id, service_id, starts_at, source)
values ('dd000000-0000-4000-8000-000000000801', 'Rev Ospite', '+390300000801',
        'db000000-0000-4000-8000-000000000801', 'd5000000-0000-4000-8000-000000000801',
        '2040-03-06 10:00:00+01', 'manual');
select is(
  (select status_changed_by from public.bookings where id = 'dd000000-0000-4000-8000-000000000801'),
  'd0000000-0000-4000-8000-000000000801'::uuid,
  'review B1: la prenotazione creata dall''admin ha status_changed_by = admin');
reset role;
select set_config('request.jwt.claims', '', true);

select lives_ok(
  $q$ delete from auth.users where id = 'd0000000-0000-4000-8000-000000000801' $q$,
  'review B1 – SPEC §8: un account presente in status_changed_by è eliminabile');
select is(
  (select status_changed_by from public.bookings where id = 'dd000000-0000-4000-8000-000000000801'),
  null,
  'review B1: dopo l''eliminazione status_changed_by è NULL');

-- ---------------------------------------------------------------------------
-- B2 – ADR 001: le regole di stato valgono anche in INSERT
-- ---------------------------------------------------------------------------
select pg_temp.act_as('d0000000-0000-4000-8000-000000000802');
select throws_ok(
  $q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source, status)
      values ('d0000000-0000-4000-8000-000000000803', 'db000000-0000-4000-8000-000000000801',
              'd5000000-0000-4000-8000-000000000801', '2024-01-08 10:00:00+01', 'manual', 'no_show') $q$,
  '42501', null, 'review B2: il barbiere non inserisce una prenotazione già no_show');
select throws_ok(
  $q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source, status)
      values ('d0000000-0000-4000-8000-000000000803', 'db000000-0000-4000-8000-000000000801',
              'd5000000-0000-4000-8000-000000000801', '2024-01-08 11:00:00+01', 'manual', 'cancelled_by_customer') $q$,
  '42501', null, 'review B2: il barbiere non inserisce una prenotazione già cancelled_by_customer');
reset role;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $q$ insert into public.bookings (customer_id, barber_id, service_id, starts_at, source, status)
      values ('d0000000-0000-4000-8000-000000000803', 'db000000-0000-4000-8000-000000000801',
              'd5000000-0000-4000-8000-000000000801', '2040-03-06 12:00:00+01', 'manual', 'completed') $q$,
  '23514', null, 'review B2: nessuno inserisce una completed nel futuro');

insert into public.bookings (id, customer_id, barber_id, service_id, starts_at, source, status)
values ('dd000000-0000-4000-8000-000000000802', 'd0000000-0000-4000-8000-000000000803',
        'db000000-0000-4000-8000-000000000801', 'd5000000-0000-4000-8000-000000000801',
        '2024-01-08 12:00:00+01', 'manual', 'no_show');
select is(
  (select no_show_count from public.profiles where id = 'd0000000-0000-4000-8000-000000000803'),
  1, 'review B2: una prenotazione inserita già no_show incrementa il contatore');

update public.bookings set status = 'cancelled_by_shop' where id = 'dd000000-0000-4000-8000-000000000802';
select is(
  (select no_show_count from public.profiles where id = 'd0000000-0000-4000-8000-000000000803'),
  0, 'review B2: uscendo da no_show il contatore torna a 0 (simmetrico)');

update public.bookings set status = 'completed' where id = 'dd000000-0000-4000-8000-000000000802';
select throws_ok(
  $q$ update public.bookings set starts_at = '2040-03-07 10:00:00+01'
       where id = 'dd000000-0000-4000-8000-000000000802' $q$,
  '23514', null, 'review B2: una completed non si sposta nel futuro');
select is(
  (select starts_at from public.bookings where id = 'dd000000-0000-4000-8000-000000000802'),
  '2024-01-08 12:00:00+01'::timestamptz, 'review B2: orario invariato dopo il rifiuto');

select * from finish();
rollback;
