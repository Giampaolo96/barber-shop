-- Dati demo per lo sviluppo locale e la CI. Viene eseguito da `npx supabase db reset`,
-- mai sul database cloud. Tutti gli utenti demo hanno password "demo1234".
--
-- ATTENZIONE: non usare `supabase db push --include-seed` verso il progetto cloud:
-- creerebbe in produzione un admin con password nota.

-- Impostazioni negozio (SPEC §3.1): la riga con i default la crea la migrazione
-- 20261003090000_shop_settings_default_row; qui nome e recapiti demo. -----------
update public.shop_settings
   set name = 'Mosca Barber Shop', address = 'Via Roma 1, 00100 Roma', phone = '+39 06 1234567';

-- Utenti demo, uno per ruolo (SPEC §2) -----------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('demo1234', extensions.gen_salt('bf')), now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', ''
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'admin@demo.local'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'barber@demo.local'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'cliente@demo.local')
) as u (id, email);

insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.email like '%@demo.local';

-- I profili sono creati dal trigger di registrazione come customer: qui si assegnano
-- nomi e ruoli. Telefoni in E.164, come li salva l'app.
update public.profiles set role = 'admin', full_name = 'Mario Rossi', phone = '+393331000001'
 where id = 'a0000000-0000-4000-8000-000000000001';
update public.profiles set role = 'barber', full_name = 'Luca Bianchi', phone = '+393331000002'
 where id = 'a0000000-0000-4000-8000-000000000002';
-- Il cliente demo ha il profilo completo: telefono e consenso privacy alla versione corrente.
update public.profiles
   set full_name = 'Giulia Verdi', phone = '+393331000003',
       privacy_policy_version = (select ss.privacy_policy_version from public.shop_settings ss),
       privacy_consent_at = now()
 where id = 'a0000000-0000-4000-8000-000000000003';

-- Servizi (SPEC §3.2), prezzi in centesimi --------------------------------------
insert into public.services (id, name, description, duration_min, price_cents, sort_order) values
  ('50000000-0000-4000-8000-000000000001', 'Taglio', 'Taglio classico o moderno, shampoo incluso', 30, 2000, 1),
  ('50000000-0000-4000-8000-000000000002', 'Barba', 'Regolazione e rifinitura della barba', 20, 1200, 2),
  ('50000000-0000-4000-8000-000000000003', 'Taglio + Barba', 'Taglio e barba nello stesso appuntamento', 45, 3000, 3),
  ('50000000-0000-4000-8000-000000000004', 'Taglio bambino', 'Taglio fino a 12 anni', 20, 1500, 4);

-- Barbieri (SPEC §3.3): il titolare è admin e anche barbiere ---------------------
insert into public.barbers (id, display_name, bio, profile_id) values
  ('b0000000-0000-4000-8000-000000000001', 'Mario', 'Titolare, in negozio dal 2005', 'a0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', 'Luca', 'Specialista in sfumature e barba', 'a0000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-000000000003', 'Sara', 'Tagli classici e bambini', null);

-- Mario e Luca fanno tutto; Sara non fa la barba.
insert into public.barber_services (barber_id, service_id)
select b.id, s.id
  from public.barbers b
 cross join public.services s
 where b.display_name in ('Mario', 'Luca')
    or s.name in ('Taglio', 'Taglio bambino');

-- Orari (SPEC §3.4): martedì–sabato, due fasce con pausa pranzo -------------------
insert into public.working_hours (barber_id, weekday, start_time, end_time)
select b.id, d.weekday, f.start_time, f.end_time
  from public.barbers b
 cross join generate_series(2, 6) as d (weekday)
 cross join (values ('09:00'::time, '13:00'::time), ('15:00'::time, '19:30'::time)) as f (start_time, end_time)
 -- Sara non lavora il sabato pomeriggio
 where not (b.display_name = 'Sara' and d.weekday = 6 and f.start_time = '15:00');

-- Assenze e chiusure (SPEC §3.5) -------------------------------------------------
-- Luca: permesso il giovedì mattina della prossima settimana, dalle 10:00 alle 12:00.
insert into public.time_off (barber_id, starts_at, ends_at, reason)
select 'b0000000-0000-4000-8000-000000000002',
       (w.next_monday + interval '3 days 10 hours') at time zone 'Europe/Rome',
       (w.next_monday + interval '3 days 12 hours') at time zone 'Europe/Rome',
       'Permesso'
  from (select date_trunc('week', now() at time zone 'Europe/Rome') + interval '7 days' as next_monday) w;

insert into public.shop_closures (starts_at, ends_at, reason) values
  ('2026-12-25 00:00:00+01', '2026-12-27 00:00:00+01', 'Natale e Santo Stefano');

-- Prenotazioni (SPEC §3.6): durata, prezzo, ends_at e blocked_until li calcola il trigger
insert into public.bookings (customer_id, guest_name, guest_phone, barber_id, service_id, starts_at, status, source, notes)
select v.customer_id, v.guest_name, v.guest_phone, v.barber_id, v.service_id,
       (w.this_monday + v.local_offset) at time zone 'Europe/Rome',
       v.status, v.source, v.notes
  from (select date_trunc('week', now() at time zone 'Europe/Rome') as this_monday) w
 cross join (values
   -- martedì della settimana scorsa: appuntamento già completato
   ('a0000000-0000-4000-8000-000000000003'::uuid, null, null,
    'b0000000-0000-4000-8000-000000000002'::uuid, '50000000-0000-4000-8000-000000000001'::uuid,
    interval '-6 days 10 hours', 'completed'::public.booking_status, 'online'::public.booking_source, null),
   -- martedì della prossima settimana
   ('a0000000-0000-4000-8000-000000000003'::uuid, null, null,
    'b0000000-0000-4000-8000-000000000002'::uuid, '50000000-0000-4000-8000-000000000003'::uuid,
    interval '8 days 10 hours', 'confirmed'::public.booking_status, 'online'::public.booking_source, 'Sfumatura bassa'),
   -- stesso giorno, subito dopo: cliente non registrato inserito dallo staff
   (null::uuid, 'Paolo Neri', '+39 333 2000001',
    'b0000000-0000-4000-8000-000000000002'::uuid, '50000000-0000-4000-8000-000000000002'::uuid,
    interval '8 days 10 hours 45 minutes', 'confirmed'::public.booking_status, 'manual'::public.booking_source, null),
   (null::uuid, 'Anna Gialli', '+39 333 2000002',
    'b0000000-0000-4000-8000-000000000003'::uuid, '50000000-0000-4000-8000-000000000004'::uuid,
    interval '9 days 16 hours', 'confirmed'::public.booking_status, 'manual'::public.booking_source, 'Primo taglio')
 ) as v (customer_id, guest_name, guest_phone, barber_id, service_id, local_offset, status, source, notes);
