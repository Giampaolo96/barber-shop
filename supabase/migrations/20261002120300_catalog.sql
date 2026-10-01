-- Catalogo (SPEC §3.2, §3.3): servizi, barbieri e servizi abilitati per barbiere.
create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  duration_min integer not null check (duration_min > 0),
  price_cents integer not null check (price_cents >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0
);

alter table public.services enable row level security;

create table public.barbers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  photo_url text,
  bio text,
  is_active boolean not null default true,
  -- Account staff opzionale. Se l'account viene eliminato il barbiere resta (ADR 001).
  profile_id uuid unique references public.profiles (id) on delete set null
);

alter table public.barbers enable row level security;

create table public.barber_services (
  barber_id uuid not null references public.barbers (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  primary key (barber_id, service_id)
);

alter table public.barber_services enable row level security;

create index barber_services_service_id_idx on public.barber_services (service_id);

-- Barbiere collegato all'utente corrente, solo se il suo profilo è staff.
create function public.current_barber_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
    from public.barbers b
    join public.profiles p on p.id = b.profile_id
   where b.profile_id = (select auth.uid())
     and p.role in ('barber', 'admin')
$$;
