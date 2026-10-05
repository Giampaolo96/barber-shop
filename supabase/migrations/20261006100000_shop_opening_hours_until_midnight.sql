-- Review fetta 8a (miglioria 6, opzione B): una fascia che finisce alle 24:00 (ammessa dal tipo
-- time e gestita dal motore) usciva da shop_opening_hours come 00:00, e la home la scartava. Ora
-- la fine a mezzanotte resta 24:00. Stessa firma, sicurezza e grant della fetta 8a.
create or replace function public.shop_opening_hours()
returns table (weekday smallint, start_time time, end_time time)
language sql
stable
security definer
set search_path = ''
as $$
  select merged.weekday,
         lower(r)::time,
         -- Le fasce stanno su un giorno fisso: fine al giorno dopo = 24:00, non 00:00.
         case when upper(r) = timestamp '2000-01-04 00:00' then time '24:00' else upper(r)::time end
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

revoke all on function public.shop_opening_hours() from public, anon, authenticated;
grant execute on function public.shop_opening_hours() to anon, authenticated;
