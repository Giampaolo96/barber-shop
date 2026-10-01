-- Impostazioni del negozio (SPEC §3.1): riga singola forzata dalla chiave primaria.
create table public.shop_settings (
  id boolean primary key default true check (id),
  name text not null,
  address text,
  phone text,
  logo_url text,
  timezone text not null default 'Europe/Rome',
  slot_granularity_min integer not null default 15 check (slot_granularity_min > 0),
  min_advance_min integer not null default 60 check (min_advance_min >= 0),
  max_horizon_days integer not null default 30 check (max_horizon_days >= 0),
  cancel_limit_min integer not null default 120 check (cancel_limit_min >= 0),
  buffer_min integer not null default 0 check (buffer_min >= 0),
  no_show_block_threshold integer not null default 3 check (no_show_block_threshold >= 0)
);

alter table public.shop_settings enable row level security;
