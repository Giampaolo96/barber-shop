-- Profili applicativi (SPEC §2): una riga per utente di auth.users, con ruolo unico.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'customer',
  full_name text,
  phone text,
  no_show_count integer not null default 0 check (no_show_count >= 0),
  is_blocked boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Helper per le policy: security definer per leggere profiles senza ricorsione RLS.
-- Nelle policy vanno usati come (select public.is_admin()) per valutarli una volta per query.
create function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid())
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() = 'admin', false)
$$;

create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() in ('barber', 'admin'), false)
$$;

-- Registrazione: il profilo nasce sempre customer, i metadati del signup sono ignorati.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Guardia sui campi riservati. I trigger sono "update of <colonne>": scattano quando la
-- colonna compare nel SET, anche se il valore non cambia.
-- - role e is_blocked (e id): solo l'admin;
-- - no_show_count: nessun utente, cambia solo dai trigger sulle transizioni di stato
--   delle prenotazioni.
create function public.profiles_guard_reserved_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Passano gli update che arrivano da altri trigger (es. contatore no-show)
  -- e quelli dei ruoli di servizio (migrazioni, seed, service_role).
  if pg_trigger_depth() > 1 or current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_argv[0] = 'admin' and public.is_admin() then
    return new;
  end if;

  raise exception 'reserved profile columns cannot be changed by this user'
    using errcode = '42501';
end;
$$;

create trigger profiles_guard_admin_columns
  before update of id, role, is_blocked on public.profiles
  for each row execute function public.profiles_guard_reserved_columns('admin');

create trigger profiles_guard_no_show_count
  before update of no_show_count on public.profiles
  for each row execute function public.profiles_guard_reserved_columns('nobody');
