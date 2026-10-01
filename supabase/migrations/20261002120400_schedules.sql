-- Orari di lavoro, assenze e chiusure (SPEC §3.4, §3.5).
create type public.timerange as range (subtype = time);

create table public.working_hours (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id) on delete cascade,
  -- Giorno ISO: 1 = lunedì ... 7 = domenica. Orari in ora locale del negozio.
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  constraint working_hours_start_before_end check (start_time < end_time),
  constraint working_hours_no_overlap exclude using gist (
    barber_id with =,
    weekday with =,
    public.timerange(start_time, end_time) with &&
  )
);

alter table public.working_hours enable row level security;

create index working_hours_barber_id_weekday_idx on public.working_hours (barber_id, weekday);

create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  constraint time_off_start_before_end check (starts_at < ends_at)
);

alter table public.time_off enable row level security;

create index time_off_barber_id_starts_at_idx on public.time_off (barber_id, starts_at);

create table public.shop_closures (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  constraint shop_closures_start_before_end check (starts_at < ends_at)
);

alter table public.shop_closures enable row level security;

create index shop_closures_starts_at_idx on public.shop_closures (starts_at);
