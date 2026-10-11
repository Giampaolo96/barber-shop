-- Statistiche dell'admin (SPEC §6.9, ADR 010). Restituisce le prenotazioni del periodo raggruppate
-- per giorno locale (timezone del negozio), barbiere, servizio, stato e "già iniziata": le formule
-- (prenotazioni, incasso stimato, no-show) le applica src/lib/stats, che resta logica pura.
-- Un jsonb al posto di una tabella per non incappare nel limite di righe di PostgREST.

-- Le statistiche cercano per periodo su tutti i barbieri: l'indice (barber_id, starts_at) non basta.
create index bookings_starts_at_idx on public.bookings (starts_at);

create function public.admin_booking_stats(p_from date, p_to date, p_exclude_demo boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := coalesce((select s.timezone from public.shop_settings s limit 1), 'Europe/Rome');
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin_booking_stats is reserved to admin'
      using errcode = '42501';
  end if;

  if p_from is null or p_to is null or p_from > p_to or p_to - p_from + 1 > 366 then
    raise exception 'admin_booking_stats: invalid period'
      using errcode = '22023';
  end if;

  -- Il filtro sull'intervallo di starts_at (un giorno di margine per lato) usa
  -- bookings_starts_at_idx; quello sul giorno locale decide.
  select coalesce(jsonb_agg(jsonb_build_object(
           'day', to_char(g.day, 'YYYY-MM-DD'),
           'barber_id', g.barber_id,
           'service_id', g.service_id,
           'status', g.status,
           'started', g.started,
           'bookings', g.bookings,
           'revenue_cents', g.revenue_cents
         ) order by g.day, g.barber_id, g.service_id, g.status, g.started), '[]'::jsonb)
    into v_result
    from (
      select (b.starts_at at time zone v_tz)::date as day,
             b.barber_id,
             b.service_id,
             b.status,
             b.starts_at <= now() as started,
             count(*)::integer as bookings,
             sum(b.price_cents)::bigint as revenue_cents
        from public.bookings b
       where b.starts_at >= (p_from - 1)::timestamp at time zone 'UTC'
         and b.starts_at < (p_to + 2)::timestamp at time zone 'UTC'
         and (b.starts_at at time zone v_tz)::date between p_from and p_to
         and not (coalesce(p_exclude_demo, false)
                  and lower(btrim(coalesce(b.notes, ''), E' \t\r\n')) = 'prenotazione demo')
       group by 1, 2, 3, 4, 5
    ) g;

  return v_result;
end;
$$;

revoke all on function public.admin_booking_stats(date, date, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_booking_stats(date, date, boolean) to authenticated;
