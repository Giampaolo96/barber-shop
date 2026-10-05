-- Fetta 8a: orari del negozio e chiusure di oggi per la home pubblica (SPEC §5.1).
-- working_hours e shop_closures sono leggibili solo dallo staff: queste funzioni definer espongono
-- ad anon e authenticated solo l'unione delle fasce dei barbieri attivi e gli intervalli delle
-- chiusure di oggi, senza dati sul singolo barbiere né il motivo della chiusura.

-- Per ogni giorno ISO (1 = lunedì ... 7 = domenica) le fasce dei barbieri attivi, con quelle
-- sovrapposte o contigue unite. Le fasce sono in ora locale: si uniscono come intervalli di un
-- giorno qualsiasi, senza conversioni di timezone.
create function public.shop_opening_hours()
returns table (weekday smallint, start_time time, end_time time)
language sql
stable
security definer
set search_path = ''
as $$
  select merged.weekday, lower(r)::time, upper(r)::time
    from (
      select wh.weekday,
             range_agg(tsrange(date '2000-01-03' + wh.start_time, date '2000-01-03' + wh.end_time, '[)')) as bands
        from public.working_hours wh
        join public.barbers b on b.id = wh.barber_id
       where b.is_active
       group by wh.weekday
    ) merged
    cross join lateral unnest(merged.bands) as r
   order by 1, 2
$$;

-- Chiusure del negozio che toccano il giorno locale di oggi (timezone del negozio), intervalli
-- [inizio, fine): una chiusura che finisce alla mezzanotte di oggi non conta.
create function public.shop_closures_today()
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with day as (
    select (date_trunc('day', now() at time zone s.timezone)) at time zone s.timezone as day_start,
           (date_trunc('day', now() at time zone s.timezone) + interval '1 day') at time zone s.timezone as day_end
      from public.shop_settings s
     limit 1
  )
  select c.starts_at, c.ends_at
    from public.shop_closures c
    cross join day
   where c.starts_at < day.day_end
     and c.ends_at > day.day_start
   order by c.starts_at
$$;

revoke all on function public.shop_opening_hours() from public, anon, authenticated;
revoke all on function public.shop_closures_today() from public, anon, authenticated;
grant execute on function public.shop_opening_hours() to anon, authenticated;
grant execute on function public.shop_closures_today() to anon, authenticated;
