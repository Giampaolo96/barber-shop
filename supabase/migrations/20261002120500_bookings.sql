-- Prenotazioni (SPEC §3.6) e invarianti garantiti dal database (SPEC §3.7).
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles (id) on delete set null,
  guest_name text,
  guest_phone text,
  barber_id uuid not null references public.barbers (id) on delete restrict,
  service_id uuid not null references public.services (id) on delete restrict,
  starts_at timestamptz not null,
  -- Calcolati dal trigger, mai dal client: ends_at = starts_at + durata copiata,
  -- blocked_until = ends_at + buffer copiato.
  ends_at timestamptz not null,
  duration_min integer not null check (duration_min > 0),
  price_cents integer not null check (price_cents >= 0),
  buffer_min integer not null check (buffer_min >= 0),
  blocked_until timestamptz not null,
  status public.booking_status not null default 'confirmed',
  source public.booking_source not null,
  notes text,
  created_at timestamptz not null default now(),
  status_changed_at timestamptz not null,
  status_changed_by uuid references public.profiles (id) on delete set null,
  -- SPEC §3.7.1: nessuna sovrapposizione fra confirmed dello stesso barbiere, buffer incluso.
  constraint bookings_no_overlap exclude using gist (
    barber_id with =,
    tstzrange(starts_at, blocked_until, '[)') with &&
  ) where (status = 'confirmed')
);

alter table public.bookings enable row level security;

create index bookings_barber_id_starts_at_idx on public.bookings (barber_id, starts_at);
create index bookings_customer_id_starts_at_idx on public.bookings (customer_id, starts_at);
create index bookings_service_id_idx on public.bookings (service_id);
create index bookings_status_changed_by_idx on public.bookings (status_changed_by);

-- Cliente registrato oppure nominativo + telefono. Non scatta sugli update di customer_id,
-- così il SET NULL della FK passa quando un cliente elimina l'account.
create function public.bookings_require_customer_or_guest()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.customer_id is null
     and (nullif(btrim(new.guest_name), '') is null or nullif(btrim(new.guest_phone), '') is null) then
    raise exception 'a booking needs a customer or a guest name and phone'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger bookings_require_customer_or_guest
  before insert or update of guest_name, guest_phone on public.bookings
  for each row execute function public.bookings_require_customer_or_guest();

-- Copia dei valori dal servizio, calcolo degli orari, transizioni di stato e audit.
create function public.bookings_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Staff non admin (barbiere): può cambiare solo stato e note. Il confronto avviene
  -- prima dei ricalcoli, così un valore falsificato viene rifiutato e non sovrascritto.
  if tg_op = 'UPDATE' and current_user = 'authenticated' and not public.is_admin() then
    if (new.barber_id, new.service_id, new.customer_id, new.starts_at, new.ends_at,
        new.duration_min, new.price_cents, new.buffer_min, new.source)
       is distinct from
       (old.barber_id, old.service_id, old.customer_id, old.starts_at, old.ends_at,
        old.duration_min, old.price_cents, old.buffer_min, old.source) then
      raise exception 'only an admin can change barber, service, customer, time or price of a booking'
        using errcode = '42501';
    end if;

    if new.status is distinct from old.status
       and (old.status <> 'confirmed'
            or new.status not in ('completed', 'no_show', 'cancelled_by_shop')) then
      raise exception 'status transition % -> % not allowed', old.status, new.status
        using errcode = '42501';
    end if;
  end if;

  -- In creazione lo staff non admin può inserire solo prenotazioni confirmed: gli altri
  -- stati si raggiungono con le transizioni ammesse.
  if tg_op = 'INSERT' and current_user = 'authenticated' and not public.is_admin()
     and new.status <> 'confirmed' then
    raise exception 'a new booking must be confirmed'
      using errcode = '42501';
  end if;

  -- SPEC §3.7.3: il barbiere deve essere abilitato al servizio (anche per le manuali).
  if tg_op = 'INSERT'
     or new.barber_id is distinct from old.barber_id
     or new.service_id is distinct from old.service_id then
    if not exists (
      select 1 from public.barber_services bs
       where bs.barber_id = new.barber_id and bs.service_id = new.service_id
    ) then
      raise exception 'barber is not enabled for this service'
        using errcode = '23514';
    end if;
  end if;

  -- Durata e prezzo copiati dal servizio alla creazione e al cambio di servizio;
  -- il buffer resta quello in vigore alla creazione.
  if tg_op = 'INSERT' or new.service_id is distinct from old.service_id then
    select s.duration_min, s.price_cents
      into new.duration_min, new.price_cents
      from public.services s
     where s.id = new.service_id;
  else
    new.duration_min := old.duration_min;
    new.price_cents := old.price_cents;
  end if;

  if tg_op = 'INSERT' then
    new.buffer_min := coalesce((select ss.buffer_min from public.shop_settings ss), 0);
  else
    new.buffer_min := old.buffer_min;
  end if;

  new.ends_at := new.starts_at + make_interval(mins => new.duration_min);
  new.blocked_until := new.ends_at + make_interval(mins => new.buffer_min);

  -- completed e no_show solo per appuntamenti già iniziati: vale in creazione, al cambio
  -- di stato e quando si sposta l'orario.
  if new.status in ('completed', 'no_show') and new.starts_at > now()
     and (tg_op = 'INSERT'
          or new.status is distinct from old.status
          or new.starts_at is distinct from old.starts_at) then
    raise exception 'a booking can be % only after it has started', new.status
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.status_changed_at := new.created_at;
    new.status_changed_by := (select auth.uid());
  elsif new.status is distinct from old.status then
    new.status_changed_at := clock_timestamp();
    new.status_changed_by := (select auth.uid());
  else
    new.status_changed_at := old.status_changed_at;
    -- Il client non può falsificare l'autore; resta ammesso l'azzeramento fatto dalla FK
    -- (on delete set null), che gira come proprietario della tabella.
    if not (new.status_changed_by is null and current_user <> 'authenticated') then
      new.status_changed_by := old.status_changed_by;
    end if;
  end if;

  return new;
end;
$$;

create trigger bookings_before_write
  before insert or update on public.bookings
  for each row execute function public.bookings_before_write();

-- Contatore no-show simmetrico: +1 entrando in no_show, -1 uscendo, mai sotto zero.
create function public.bookings_sync_no_show_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'no_show' and new.customer_id is not null then
      update public.profiles
         set no_show_count = no_show_count + 1
       where id = new.customer_id;
    end if;
    return null;
  end if;

  if new.status = 'no_show' and old.status <> 'no_show' and new.customer_id is not null then
    update public.profiles
       set no_show_count = no_show_count + 1
     where id = new.customer_id;
  elsif old.status = 'no_show' and new.status <> 'no_show' and old.customer_id is not null then
    update public.profiles
       set no_show_count = greatest(no_show_count - 1, 0)
     where id = old.customer_id;
  end if;
  return null;
end;
$$;

create trigger bookings_sync_no_show_count
  after insert or update of status on public.bookings
  for each row execute function public.bookings_sync_no_show_count();
