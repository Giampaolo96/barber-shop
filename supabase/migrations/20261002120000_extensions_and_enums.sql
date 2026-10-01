-- Estensione per i vincoli di esclusione (SPEC §3.7.1) ed enum di dominio.
create extension if not exists btree_gist with schema extensions;

create type public.user_role as enum ('customer', 'barber', 'admin');

create type public.booking_status as enum (
  'confirmed',
  'completed',
  'cancelled_by_customer',
  'cancelled_by_shop',
  'no_show'
);

create type public.booking_source as enum ('online', 'manual');
